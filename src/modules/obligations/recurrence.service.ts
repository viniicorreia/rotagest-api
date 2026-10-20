import { Injectable } from '@nestjs/common';
import type { Prisma, RecurrenceRule } from '@prisma/client';
import { notFound } from '../../common/errors';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { formatMonth, fromCents, toCents } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { splitAmounts, type AllocationSplit } from './allocation';
import { AuditService } from '../audit/audit.service';
import type { UpdateRecurrenceDto } from './obligations.dto';
import { defaultHorizon, recurrenceDueDate, recurrenceOccurrences, type RecurrenceSpec } from './schedule';

/** Modelo gravado em RecurrenceRule.template (validado aqui, não pelo banco). */
export interface RecurrenceTemplate {
  description: string;
  categoryId: string;
  amount: string;
  vehicleId: string | null;
  /** Rateio entre veículos aplicado a cada ocorrência (ausente em regras antigas). */
  split?: AllocationSplit | null;
  supplierName: string | null;
  notes: string | null;
  dueDay: number;
  dueMonthOffset: number;
  createdById: string;
}

export function specOf(rule: Pick<RecurrenceRule, 'frequency' | 'startDate' | 'endDate' | 'maxOccurrences'>, t: RecurrenceTemplate): RecurrenceSpec {
  return {
    frequency: rule.frequency === 'YEARLY' ? 'YEARLY' : 'MONTHLY',
    start: rule.startDate,
    end: rule.endDate,
    maxOccurrences: rule.maxOccurrences,
    dueDay: t.dueDay,
    dueMonthOffset: t.dueMonthOffset,
  };
}

/**
 * Gerador de lançamentos recorrentes (ARCHITECTURE.md §6.9). Cria uma
 * obrigação por competência até o mês que vem; a unicidade
 * (recurrenceRuleId, competence) torna a geração idempotente e segura sob
 * concorrência. Alterar a regra afeta só competências ainda não geradas.
 */
@Injectable()
export class RecurrenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async generateDue(companyId: string, opts: { ruleId?: string; tx?: Tx } = {}): Promise<number> {
    const client = opts.tx ?? this.prisma;
    const rules = await client.recurrenceRule.findMany({ where: { companyId, status: 'ACTIVE', ...(opts.ruleId ? { id: opts.ruleId } : {}) } });
    if (rules.length === 0) return 0;
    const closed = await client.monthlyClosing.findMany({ where: { companyId, status: 'CLOSED' }, select: { year: true, month: true } });
    const closedSet = new Set(closed.map((c) => `${c.year}-${String(c.month).padStart(2, '0')}`));
    let created = 0;

    for (const rule of rules) {
      const t = rule.template as unknown as RecurrenceTemplate;
      const spec = specOf(rule, t);
      // Pelo menos a primeira ocorrência existe mesmo que comece depois do horizonte.
      const horizon = spec.start > defaultHorizon() ? spec.start : defaultHorizon();
      const competences = recurrenceOccurrences(spec, horizon).filter(
        (c) => (!rule.lastGeneratedDate || c > rule.lastGeneratedDate) && !closedSet.has(formatMonth(c)),
      );
      if (competences.length === 0) continue;
      const base = {
        companyId,
        description: t.description,
        categoryId: t.categoryId,
        amount: t.amount,
        kind: 'RECURRING' as const,
        recurrenceRuleId: rule.id,
        notes: t.notes,
        createdById: t.createdById,
      };
      if (rule.target === 'PAYABLE') {
        const rows = await client.payable.createManyAndReturn({
          data: competences.map((c) => ({ ...base, competence: c, dueDate: recurrenceDueDate(spec, c), vehicleId: t.vehicleId, supplierName: t.supplierName })),
          skipDuplicates: true,
          select: { id: true, amount: true },
        });
        if (t.split) {
          await client.expenseAllocation.createMany({
            data: rows.flatMap((r) => splitAmounts(t.split!, toCents(r.amount)).map((p) => ({ companyId, payableId: r.id, vehicleId: p.vehicleId, method: t.split!.method, percent: p.percent, amount: fromCents(p.cents) }))),
          });
        } else if (t.vehicleId) {
          await client.expenseAllocation.createMany({
            data: rows.map((r) => ({ companyId, payableId: r.id, vehicleId: t.vehicleId, method: 'DIRECT' as const, percent: 100, amount: r.amount })),
          });
        }
        created += rows.length;
      } else {
        const rows = await client.receivable.createManyAndReturn({
          data: competences.map((c) => ({ ...base, competence: c, dueDate: recurrenceDueDate(spec, c) })),
          skipDuplicates: true,
          select: { id: true, amount: true },
        });
        if (t.split) {
          await client.revenueAllocation.createMany({
            data: rows.flatMap((r) => splitAmounts(t.split!, toCents(r.amount)).map((p) => ({ companyId, receivableId: r.id, vehicleId: p.vehicleId, method: t.split!.method, percent: p.percent, amount: fromCents(p.cents) }))),
          });
        } else if (t.vehicleId) {
          await client.revenueAllocation.createMany({
            data: rows.map((r) => ({ companyId, receivableId: r.id, vehicleId: t.vehicleId, method: 'DIRECT' as const, percent: 100, amount: r.amount })),
          });
        }
        created += rows.length;
      }
      await client.recurrenceRule.update({ where: { id: rule.id }, data: { lastGeneratedDate: competences[competences.length - 1] } });
    }
    return created;
  }

  async list(ctx: TenantContext, target?: 'PAYABLE' | 'RECEIVABLE') {
    const rules = await this.prisma.recurrenceRule.findMany({
      where: { companyId: ctx.companyId, target },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    const categoryIds = [...new Set(rules.map((r) => (r.template as unknown as RecurrenceTemplate).categoryId))];
    const categories = await this.prisma.financialCategory.findMany({
      where: { companyId: ctx.companyId, id: { in: categoryIds } },
      select: { id: true, name: true, type: true, systemKey: true },
    });
    const byId = new Map(categories.map((c) => [c.id, c]));
    return rules.map((r) => this.toDto(r, byId.get((r.template as unknown as RecurrenceTemplate).categoryId)!));
  }

  async update(ctx: TenantContext, id: string, dto: UpdateRecurrenceDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const rule = await this.findOrThrow(tx, ctx.companyId, id);
      const before = rule.template as unknown as RecurrenceTemplate;
      const template: RecurrenceTemplate = {
        ...before,
        description: dto.description ?? before.description,
        amount: dto.amount ?? before.amount,
        dueDay: dto.dueDay ?? before.dueDay,
      };
      const updated = await tx.recurrenceRule.update({ where: { id }, data: { template: template as unknown as Prisma.InputJsonValue } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'recurrence.updated', entityType: 'RecurrenceRule', entityId: id, before, after: template, meta }, tx);
      return this.toDtoWithCategory(tx, ctx.companyId, updated);
    });
  }

  /** Encerra a recorrência: nada novo é gerado; o que já existe continua. */
  async stop(ctx: TenantContext, id: string, meta: RequestMeta, tx?: Tx) {
    const run = async (client: Tx) => {
      const rule = await this.findOrThrow(client, ctx.companyId, id);
      if (rule.status === 'INACTIVE') return this.toDtoWithCategory(client, ctx.companyId, rule);
      const updated = await client.recurrenceRule.update({ where: { id }, data: { status: 'INACTIVE', endDate: rule.lastGeneratedDate ?? rule.startDate } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'recurrence.stopped', entityType: 'RecurrenceRule', entityId: id, meta }, client);
      return this.toDtoWithCategory(client, ctx.companyId, updated);
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  private async findOrThrow(client: Tx, companyId: string, id: string) {
    const rule = await client.recurrenceRule.findFirst({ where: { id, companyId } });
    if (!rule) throw notFound('Recorrência não encontrada');
    return rule;
  }

  private async toDtoWithCategory(client: Tx, companyId: string, rule: RecurrenceRule) {
    const t = rule.template as unknown as RecurrenceTemplate;
    const category = await client.financialCategory.findFirstOrThrow({ where: { companyId, id: t.categoryId }, select: { id: true, name: true, type: true, systemKey: true } });
    return this.toDto(rule, category);
  }

  private toDto(rule: RecurrenceRule, category: { id: string; name: string; type: 'INCOME' | 'EXPENSE'; systemKey: string | null }) {
    const t = rule.template as unknown as RecurrenceTemplate;
    return {
      id: rule.id,
      target: rule.target,
      frequency: rule.frequency === 'YEARLY' ? ('YEARLY' as const) : ('MONTHLY' as const),
      description: t.description,
      amount: fromCents(toCents(t.amount)),
      startMonth: formatMonth(rule.startDate),
      endMonth: rule.endDate ? formatMonth(rule.endDate) : null,
      maxOccurrences: rule.maxOccurrences,
      dueDay: t.dueDay,
      lastGeneratedMonth: rule.lastGeneratedDate ? formatMonth(rule.lastGeneratedDate) : null,
      status: rule.status,
      category,
    };
  }
}


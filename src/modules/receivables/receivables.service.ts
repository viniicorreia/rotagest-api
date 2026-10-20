import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { badRequest, businessRule, notFound } from '../../common/errors';
import { dateOnly, money, month } from '../../common/serialize';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { fromCents, parseDate, parseMonth, toCents, today } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CategoriesService } from '../categories/categories.service';
import type { CancelObligationDto, SettleDto } from '../obligations/obligations.dto';
import { ContractBillingService } from '../contracts/contract-billing.service';
import { RecurrenceService, type RecurrenceTemplate } from '../obligations/recurrence.service';
import { assertVehiclesUsable, currentSplit, splitFromInput, writeAllocations, type AllocationSplit } from '../obligations/allocation';
import { installmentSchedule, isOverdue, monthDiff, type Occurrence } from '../obligations/schedule';
import { attachmentDto } from '../attachments/attachment-dto';
import { SettlementsService, SETTLEMENT_INCLUDE, statusFor } from '../settlements/settlements.service';
import { PeriodLockService } from '../transactions/period-lock.service';
import type { CreateReceivableDto, ListReceivablesQueryDto, UpdateReceivableDto } from './receivables.dto';

const LIST_INCLUDE = {
  category: { select: { id: true, name: true, type: true, systemKey: true } },
  allocations: { where: { method: 'DIRECT' }, take: 1, select: { vehicle: { select: { id: true, name: true, plate: true } } } },
  _count: { select: { attachments: { where: { deletedAt: null } }, allocations: { where: { method: { not: 'DIRECT' } } } } },
} satisfies Prisma.ReceivableInclude;
type ReceivableRow = Prisma.ReceivableGetPayload<{ include: typeof LIST_INCLUDE }>;

const DETAIL_INCLUDE = {
  category: LIST_INCLUDE.category,
  _count: LIST_INCLUDE._count,
  settlements: {
    include: { ...SETTLEMENT_INCLUDE, attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
    orderBy: [{ settledAt: 'asc' }, { createdAt: 'asc' }],
  },
  attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  allocations: { include: { vehicle: { select: { id: true, name: true, plate: true } } } },
} satisfies Prisma.ReceivableInclude;
type ReceivableDetailRow = Prisma.ReceivableGetPayload<{ include: typeof DETAIL_INCLUDE }>;

const OPEN_STATUSES = ['PENDING', 'PARTIALLY_RECEIVED'] as const;

/**
 * Contas a receber (obrigações). Receber não mexe aqui diretamente: passa pelo
 * SettlementsService, que mantém receivedAmount/status sob lock. Receita
 * prevista não altera saldo de conta. Vencida é derivada do vencimento.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
    private readonly recurrence: RecurrenceService,
    private readonly contractBilling: ContractBillingService,
    private readonly settlements: SettlementsService,
    private readonly periods: PeriodLockService,
  ) {}

  async list(ctx: TenantContext, q: ListReceivablesQueryDto) {
    await this.recurrence.generateDue(ctx.companyId);
    await this.contractBilling.generateDue(ctx.companyId, ctx.userId);
    const where = this.where(ctx, q);
    const now = today();
    const nonCanceled: Prisma.ReceivableWhereInput = { AND: [where, { status: { not: 'CANCELED' } }] };
    const overdueWhere: Prisma.ReceivableWhereInput = { AND: [where, { status: { in: [...OPEN_STATUSES] }, dueDate: { lt: now } }] };
    const [items, total, sums, overdue] = await Promise.all([
      this.prisma.receivable.findMany({
        where,
        include: LIST_INCLUDE,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.receivable.count({ where }),
      this.prisma.receivable.aggregate({ where: nonCanceled, _sum: { amount: true, receivedAmount: true } }),
      this.prisma.receivable.aggregate({ where: overdueWhere, _sum: { amount: true, receivedAmount: true }, _count: true }),
    ]);
    const amount = toCents(sums._sum.amount ?? '0');
    const paid = toCents(sums._sum.receivedAmount ?? '0');
    return {
      items: items.map((p) => this.toDto(p)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      summary: {
        amount: fromCents(amount),
        settled: fromCents(paid),
        open: fromCents(amount - paid),
        overdue: fromCents(toCents(overdue._sum.amount ?? '0') - toCents(overdue._sum.receivedAmount ?? '0')),
        overdueCount: overdue._count,
      },
    };
  }

  async get(ctx: TenantContext, id: string) {
    const p = await this.prisma.receivable.findFirst({ where: { id, companyId: ctx.companyId }, include: DETAIL_INCLUDE });
    if (!p) throw notFound('Conta a receber não encontrada');
    return this.toDetailDto(p);
  }

  async create(ctx: TenantContext, dto: CreateReceivableDto, meta: RequestMeta) {
    const kind = dto.kind ?? 'SINGLE';
    const competence = parseMonth(dto.competence);
    const dueDate = parseDate(dto.dueDate);
    const totalCents = toCents(dto.amount);
    if (kind === 'INSTALLMENT' && !dto.installmentCount) throw badRequest('Informe o número de parcelas');
    if (kind === 'RECURRING' && !dto.recurrence) throw badRequest('Informe a frequência da recorrência');
    if (kind !== 'INSTALLMENT' && dto.installmentCount) throw badRequest('Número de parcelas só vale para receita parcelada');
    if (kind !== 'RECURRING' && dto.recurrence) throw badRequest('Recorrência só vale para receita recorrente');
    if (dto.settleNow && kind !== 'SINGLE') throw badRequest('“Já recebido” só vale para receita avulsa');
    if (kind === 'INSTALLMENT' && totalCents < dto.installmentCount!) throw badRequest('Valor pequeno demais para o número de parcelas');

    // Repetição de um "lançar já recebido" que deu certo: devolve o que foi criado.
    if (dto.settleNow) {
      const replay = await this.prisma.settlement.findUnique({
        where: { companyId_idempotencyKey: { companyId: ctx.companyId, idempotencyKey: dto.settleNow.idempotencyKey } },
        select: { receivableId: true },
      });
      if (replay?.receivableId) {
        const p = await this.prisma.receivable.findUniqueOrThrow({ where: { id: replay.receivableId }, include: LIST_INCLUDE });
        return { items: [this.toDto(p)], recurrenceRuleId: null };
      }
    }

    const split = this.splitOf(dto, totalCents);

    const result = await this.prisma.$transaction(async (tx) => {
      await this.categories.assertUsable(tx, ctx.companyId, dto.categoryId, 'INCOME');
      if (dto.vehicleId) await this.assertVehicle(tx, ctx.companyId, dto.vehicleId);
      if (split) await assertVehiclesUsable(tx, ctx.companyId, split.items.map((i) => i.vehicleId));

      let occurrences: Occurrence[];
      let recurrenceRuleId: string | null = null;
      if (kind === 'INSTALLMENT') {
        occurrences = installmentSchedule(totalCents, dto.installmentCount!, competence, dueDate);
      } else {
        occurrences = [{ competence, dueDate, amountCents: totalCents }];
      }
      await this.periods.assertOpen(ctx.companyId, occurrences.map((o) => o.competence), tx);

      if (kind === 'RECURRING') {
        const r = dto.recurrence!;
        const endDate = r.endMonth ? parseMonth(r.endMonth) : null;
        if (endDate && endDate < competence) throw badRequest('A competência final deve ser depois da inicial');
        const template: RecurrenceTemplate = {
          description: dto.description,
          categoryId: dto.categoryId,
          amount: fromCents(totalCents),
          vehicleId: dto.vehicleId ?? null,
          split,
          supplierName: null,
          notes: dto.notes ?? null,
          dueDay: dueDate.getUTCDate(),
          dueMonthOffset: monthDiff(competence, new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), 1))),
          createdById: ctx.userId,
        };
        if (template.dueMonthOffset < 0 || template.dueMonthOffset > 12) throw badRequest('O vencimento deve ficar entre o mês da competência e 12 meses depois');
        const rule = await tx.recurrenceRule.create({
          data: {
            companyId: ctx.companyId,
            target: 'RECEIVABLE',
            frequency: r.frequency,
            dayOfMonth: template.dueDay,
            startDate: competence,
            endDate,
            maxOccurrences: r.maxOccurrences ?? null,
            template: template as unknown as Prisma.InputJsonValue,
          },
        });
        recurrenceRuleId = rule.id;
        await this.recurrence.generateDue(ctx.companyId, { ruleId: rule.id, tx });
        const rows = await tx.receivable.findMany({ where: { recurrenceRuleId: rule.id }, include: LIST_INCLUDE, orderBy: { competence: 'asc' } });
        await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'receivable.recurrence_created', entityType: 'RecurrenceRule', entityId: rule.id, after: template, meta }, tx);
        return { rows, recurrenceRuleId };
      }

      const groupId = kind === 'INSTALLMENT' ? randomUUID() : null;
      const ids: string[] = [];
      for (const o of occurrences) {
        const created = await tx.receivable.create({
          data: {
            companyId: ctx.companyId,
            description: o.count ? `${dto.description} (${o.number}/${o.count})` : dto.description,
            categoryId: dto.categoryId,
            notes: dto.notes ?? null,
            amount: fromCents(o.amountCents),
            competence: o.competence,
            dueDate: o.dueDate,
            kind,
            installmentGroupId: groupId,
            installmentNumber: o.number ?? null,
            installmentCount: o.count ?? null,
            createdById: ctx.userId,
          },
          select: { id: true },
        });
        await writeAllocations(tx, 'RECEIVABLE', ctx.companyId, created.id, dto.vehicleId ?? null, split, o.amountCents);
        ids.push(created.id);
      }
      if (dto.settleNow) {
        await this.settlements.settle(ctx, 'RECEIVABLE', ids[0], { ...dto.settleNow }, meta, tx);
      }
      const rows = await tx.receivable.findMany({ where: { id: { in: ids } }, include: LIST_INCLUDE, orderBy: { dueDate: 'asc' } });
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'receivable.created', entityType: 'Receivable', entityId: ids[0], after: { ...dto, ids }, meta },
        tx,
      );
      return { rows, recurrenceRuleId };
    });
    return { items: result.rows.map((p) => this.toDto(p)), recurrenceRuleId: result.recurrenceRuleId };
  }

  async update(ctx: TenantContext, id: string, dto: UpdateReceivableDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.lock(tx, ctx.companyId, id);
      if (before.status === 'CANCELED') throw businessRule('Lançamento cancelado não pode ser editado');
      const competence = dto.competence ? parseMonth(dto.competence) : before.competence;
      await this.periods.assertOpen(ctx.companyId, [before.competence, competence], tx);
      if (dto.categoryId && dto.categoryId !== before.categoryId) await this.categories.assertUsable(tx, ctx.companyId, dto.categoryId, 'INCOME');
      if (dto.vehicleId) await this.assertVehicle(tx, ctx.companyId, dto.vehicleId);

      const amountCents = dto.amount ? toCents(dto.amount) : toCents(before.amount);
      const paidCents = toCents(before.receivedAmount);
      if (amountCents < paidCents) throw businessRule(`O valor não pode ficar abaixo do já recebido (R$ ${fromCents(paidCents).replace('.', ',')})`);
      let split: AllocationSplit | null;
      if (dto.allocations !== undefined) split = dto.allocations.length ? this.splitOf(dto, amountCents) : null;
      else if (dto.vehicleId !== undefined) split = null;
      else split = await currentSplit(tx, 'RECEIVABLE', ctx.companyId, id);
      if (split && dto.allocations?.length) await assertVehiclesUsable(tx, ctx.companyId, split.items.map((i) => i.vehicleId));
      const vehicleId = split ? null : dto.vehicleId !== undefined ? dto.vehicleId : (before.allocations[0]?.vehicle?.id ?? null);

      await tx.receivable.update({
        where: { id },
        data: {
          description: dto.description,
          categoryId: dto.categoryId,
          amount: fromCents(amountCents),
          competence,
          dueDate: dto.dueDate ? parseDate(dto.dueDate) : undefined,
          notes: dto.notes,
          status: statusFor('RECEIVABLE', paidCents, amountCents) as 'PENDING' | 'PARTIALLY_RECEIVED' | 'RECEIVED',
        },
      });
      await writeAllocations(tx, 'RECEIVABLE', ctx.companyId, id, vehicleId, split, amountCents);
      const after = await tx.receivable.findUniqueOrThrow({ where: { id }, include: DETAIL_INCLUDE });
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'receivable.updated', entityType: 'Receivable', entityId: id, before: this.toDto({ ...before }), after: this.toDto(after), meta },
        tx,
      );
      return this.toDetailDto(after);
    });
  }

  /** Cancelar exige não ter recebimentos ativos (estorne antes). Nada é apagado. */
  async cancel(ctx: TenantContext, id: string, dto: CancelObligationDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const target = await this.lock(tx, ctx.companyId, id);
      const ids = [id];
      if (dto.scope === 'THIS_AND_FUTURE' && (target.installmentGroupId || target.recurrenceRuleId)) {
        const siblings = await tx.receivable.findMany({
          where: {
            companyId: ctx.companyId,
            id: { not: id },
            status: 'PENDING',
            competence: { gt: target.competence },
            ...(target.installmentGroupId ? { installmentGroupId: target.installmentGroupId } : { recurrenceRuleId: target.recurrenceRuleId }),
          },
          select: { id: true },
        });
        ids.push(...siblings.map((s) => s.id));
        if (target.recurrenceRuleId) await this.recurrence.stop(ctx, target.recurrenceRuleId, meta, tx);
      }
      for (const pid of ids) {
        const p = pid === id ? target : await this.lock(tx, ctx.companyId, pid);
        if (p.status === 'CANCELED') {
          if (pid === id) throw businessRule('Este lançamento já está cancelado');
          continue;
        }
        if (toCents(p.receivedAmount) > 0) throw businessRule('Estorne os recebimentos antes de cancelar este lançamento');
        await this.periods.assertOpen(ctx.companyId, p.competence, tx);
        await tx.receivable.update({ where: { id: pid }, data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: dto.reason } });
        // Km faturados nesta conta voltam a ficar disponíveis para um novo faturamento.
        await tx.vehicleDailyLog.updateMany({ where: { companyId: ctx.companyId, receivableId: pid }, data: { receivableId: null } });
      }
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'receivable.canceled', entityType: 'Receivable', entityId: id, after: { ids }, reason: dto.reason, meta }, tx);
      const after = await tx.receivable.findUniqueOrThrow({ where: { id }, include: DETAIL_INCLUDE });
      return this.toDetailDto(after);
    });
  }

  async receive(ctx: TenantContext, id: string, dto: SettleDto, meta: RequestMeta) {
    const settlement = await this.settlements.settle(ctx, 'RECEIVABLE', id, dto, meta);
    const p = await this.prisma.receivable.findUniqueOrThrow({ where: { id: settlement.receivableId! }, include: LIST_INCLUDE });
    return { settlement: this.settlements.toDto(settlement), receivable: this.toDto(p) };
  }

  // -------------------------------------------------------------------------

  private where(ctx: TenantContext, q: ListReceivablesQueryDto): Prisma.ReceivableWhereInput {
    const and: Prisma.ReceivableWhereInput[] = [{ companyId: ctx.companyId }];
    const now = today();
    switch (q.status) {
      case undefined:
        and.push({ status: { not: 'CANCELED' } });
        break;
      case 'OPEN':
        and.push({ status: { in: [...OPEN_STATUSES] } });
        break;
      case 'OVERDUE':
        and.push({ status: { in: [...OPEN_STATUSES] }, dueDate: { lt: now } });
        break;
      default:
        and.push({ status: q.status });
    }
    if (q.dueFrom || q.dueTo) and.push({ dueDate: { gte: q.dueFrom ? parseDate(q.dueFrom) : undefined, lte: q.dueTo ? parseDate(q.dueTo) : undefined } });
    if (q.competenceFrom || q.competenceTo) {
      and.push({ competence: { gte: q.competenceFrom ? parseMonth(q.competenceFrom) : undefined, lte: q.competenceTo ? parseMonth(q.competenceTo) : undefined } });
    }
    if (q.categoryId) and.push({ categoryId: q.categoryId });
    if (q.vehicleId) and.push({ allocations: { some: { vehicleId: q.vehicleId } } });
    if (q.search) and.push({ description: { contains: q.search, mode: 'insensitive' } });
    return { AND: and };
  }

  private async lock(tx: Tx, companyId: string, id: string): Promise<ReceivableRow> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM receivables WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound('Conta a receber não encontrada');
    return tx.receivable.findUniqueOrThrow({ where: { id }, include: LIST_INCLUDE });
  }

  private async assertVehicle(tx: Tx, companyId: string, vehicleId: string) {
    const v = await tx.vehicle.findFirst({ where: { id: vehicleId, companyId }, select: { archivedAt: true } });
    if (!v) throw notFound('Veículo não encontrado');
    if (v.archivedAt) throw businessRule('Este veículo está arquivado');
  }

  private splitOf(dto: { vehicleId?: string | null; allocationMethod?: AllocationSplit['method']; allocations?: { vehicleId: string; percent?: string; amount?: string }[] }, totalCents: number): AllocationSplit | null {
    if (!dto.allocations?.length) return null;
    if (dto.vehicleId) throw badRequest('Escolha um veículo ou um rateio entre veículos, não os dois');
    if (dto.allocationMethod === 'REVENUE_PROPORTIONAL') throw badRequest('Rateio proporcional à receita vale só para despesas');
    return splitFromInput(dto.allocationMethod ?? 'EQUAL', dto.allocations, totalCents);
  }

  toDto(p: ReceivableRow) {
    const amount = toCents(p.amount);
    const paid = toCents(p.receivedAmount);
    return {
      id: p.id,
      description: p.description,
      category: p.category,
      amount: money(p.amount),
      receivedAmount: money(p.receivedAmount),
      openAmount: fromCents(p.status === 'CANCELED' ? 0 : amount - paid),
      competence: month(p.competence),
      dueDate: dateOnly(p.dueDate),
      status: p.status,
      overdue: isOverdue(p.status, p.dueDate),
      kind: p.kind,
      installmentNumber: p.installmentNumber,
      installmentCount: p.installmentCount,
      installmentGroupId: p.installmentGroupId,
      recurrenceRuleId: p.recurrenceRuleId,
      vehicle: p.allocations.find((a) => a.vehicle && (!('method' in a) || a.method === 'DIRECT'))?.vehicle ?? null,
      notes: p.notes,
      canceledAt: p.canceledAt,
      cancelReason: p.cancelReason,
      attachmentsCount: p._count.attachments,
      splitVehicles: p._count.allocations,
      createdAt: p.createdAt,
    };
  }

  private toDetailDto(p: ReceivableDetailRow) {
    return {
      ...this.toDto(p),
      settlements: p.settlements.map((s) => this.settlements.toDto(s)),
      // Comprovantes do lançamento e dos seus recebimentos.
      attachments: [...p.attachments, ...p.settlements.flatMap((s) => s.attachments)].map(attachmentDto),
      allocations: p.allocations.map((a) => ({ vehicle: a.vehicle, method: a.method, percent: a.percent?.toFixed(6) ?? '100.000000', amount: money(a.amount) })),
    };
  }
}

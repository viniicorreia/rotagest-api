import { Injectable } from '@nestjs/common';
import { Prisma, type MonthlyClosing } from '@prisma/client';
import { ErrorCode, businessRule, conflict } from '../../common/errors';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { firstOfMonth, formatMonth, fromCents, lastOfMonth, parseMonth, toCents, today } from '../../domain';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { Report } from '../reports/report.types';
import { ReportsService } from '../reports/reports.service';
import type { ConfirmClosingDto, ReopenClosingDto } from './closings.dto';

export interface ClosingSnapshot {
  month: string;
  generatedAt: string;
  totals: { revenue: string; expense: string; result: string; received: string; paid: string; cashResult: string; balance: string };
  pending: {
    payablesOpenCount: number;
    payablesOpen: string;
    receivablesOpenCount: number;
    receivablesOpen: string;
    pendingApprovals: number;
    unbilledKmDays: number;
    unbilledKmAmount: string;
  };
  sections: Report['sections'];
  warnings: string[];
}

type Row = MonthlyClosing & { closedBy?: { id: string; name: string } | null; reopenedBy?: { id: string; name: string } | null };

/**
 * Fechamento mensal (ARCHITECTURE.md §6.10): prévia sem gravar, confirmação
 * com snapshot imutável, bloqueio do período (PeriodLockService) e reabertura
 * só com closing:reopen e justificativa, auditada com o snapshot anterior.
 * Fechar de novo depois de reabrir incrementa a versão.
 */
@Injectable()
export class ClosingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
  ) {}

  async list(ctx: TenantContext, year = today().getUTCFullYear()) {
    const rows = await this.prisma.monthlyClosing.findMany({ where: { companyId: ctx.companyId, year } });
    const users = await this.users(rows);
    const items = Array.from({ length: 12 }, (_, i) => {
      const m = `${year}-${String(i + 1).padStart(2, '0')}`;
      const row = rows.find((r) => r.month === i + 1);
      return this.dto(m, row ? { ...row, closedBy: users.get(row.closedById), reopenedBy: row.reopenedById ? users.get(row.reopenedById) : null } : null);
    });
    return { year, items };
  }

  async get(ctx: TenantContext, month: string) {
    const start = parseMonth(month);
    const row = await this.find(ctx.companyId, start);
    const users = row ? await this.users([row]) : new Map();
    return {
      ...this.dto(month, row ? { ...row, closedBy: users.get(row.closedById), reopenedBy: row.reopenedById ? users.get(row.reopenedById) : null } : null),
      snapshot: row ? (row.snapshot as unknown as ClosingSnapshot) : null,
    };
  }

  /** Prévia: os mesmos números que serão gravados, calculados agora. */
  async preview(ctx: TenantContext, month: string) {
    const start = parseMonth(month);
    return this.snapshot(ctx, start);
  }

  async close(ctx: TenantContext, month: string, dto: ConfirmClosingDto, meta: RequestMeta) {
    const start = parseMonth(month);
    if (!this.closable(start)) throw businessRule('Só é possível fechar um mês que já terminou');
    await this.prisma.$transaction(async (tx) => {
      // Lock exclusivo do mês: fechamentos simultâneos esperam um ao outro, e os
      // lançamentos do mês (lock compartilhado em PeriodLockService.assertOpen)
      // em andamento terminam antes; os novos esperam o fechamento e são recusados.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`closing:${ctx.companyId}:${month}`}))`;
      // O retrato é calculado depois do lock, já com tudo o que foi confirmado no mês.
      const snapshot = await this.snapshot(ctx, start);
      const current = await tx.monthlyClosing.findUnique({ where: { companyId_year_month: { companyId: ctx.companyId, year: start.getUTCFullYear(), month: start.getUTCMonth() + 1 } } });
      if (current?.status === 'CLOSED') throw conflict(`O mês ${label(month)} já está fechado`, ErrorCode.CONFLICT);
      const version = current?.version ?? 0;
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== version) throw conflict('O fechamento mudou desde a prévia. Atualize e confira de novo.', ErrorCode.CONFLICT);
      const data = { status: 'CLOSED' as const, snapshot: snapshot as unknown as Prisma.InputJsonValue, closedAt: new Date(), closedById: ctx.userId };
      const saved = current
        ? await tx.monthlyClosing.update({ where: { id: current.id }, data: { ...data, version: version + 1 } })
        : await tx.monthlyClosing.create({ data: { ...data, companyId: ctx.companyId, year: start.getUTCFullYear(), month: start.getUTCMonth() + 1, version: 1 } });
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'closing.closed', entityType: 'MonthlyClosing', entityId: saved.id, after: { month, version: saved.version, totals: snapshot.totals }, meta },
        tx,
      );
    }, { timeout: 30_000 });
    return this.get(ctx, month);
  }

  async reopen(ctx: TenantContext, month: string, dto: ReopenClosingDto, meta: RequestMeta) {
    const start = parseMonth(month);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`closing:${ctx.companyId}:${month}`}))`;
      const current = await tx.monthlyClosing.findUnique({ where: { companyId_year_month: { companyId: ctx.companyId, year: start.getUTCFullYear(), month: start.getUTCMonth() + 1 } } });
      if (!current || current.status !== 'CLOSED') throw businessRule(`O mês ${label(month)} não está fechado`);
      await tx.monthlyClosing.update({ where: { id: current.id }, data: { status: 'REOPENED', reopenedAt: new Date(), reopenedById: ctx.userId, reopenReason: dto.reason } });
      await this.audit.log(
        {
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'closing.reopened',
          entityType: 'MonthlyClosing',
          entityId: current.id,
          before: { month, version: current.version, closedAt: current.closedAt, closedById: current.closedById, snapshot: current.snapshot },
          reason: dto.reason,
          meta,
        },
        tx,
      );
    });
    return this.get(ctx, month);
  }

  /** Relatório (para exportar) a partir do snapshot gravado; sem fechamento, da prévia. */
  async exportable(ctx: TenantContext, month: string): Promise<{ report: Report; company: string }> {
    const detail = await this.get(ctx, month);
    const snap = detail.status === 'CLOSED' && detail.snapshot ? detail.snapshot : await this.preview(ctx, month);
    const t = snap.totals;
    const p = snap.pending;
    const headline: Report['sections'][number] = {
      title: 'Resumo do mês',
      columns: [
        { key: 'item', label: 'Item', type: 'text' },
        { key: 'value', label: 'Valor', type: 'money' },
      ],
      rows: [
        { item: 'Receitas (competência)', value: t.revenue },
        { item: 'Despesas (competência)', value: t.expense },
        { item: 'Resultado gerencial', value: t.result },
        { item: 'Recebido (caixa)', value: t.received },
        { item: 'Pago (caixa)', value: t.paid },
        { item: 'Resultado de caixa', value: t.cashResult },
        { item: 'Saldo das contas no fim do mês', value: t.balance },
        { item: `Contas a pagar em aberto (${p.payablesOpenCount})`, value: p.payablesOpen },
        { item: `Contas a receber em aberto (${p.receivablesOpenCount})`, value: p.receivablesOpen },
        { item: `Km não faturado (${p.unbilledKmDays} dia(s))`, value: p.unbilledKmAmount },
      ],
      totals: null,
    };
    const status = detail.status === 'CLOSED' ? `Fechado (versão ${detail.version})` : 'Prévia — mês não fechado';
    const report: Report = {
      key: 'result-by-period',
      title: `Fechamento ${label(month)}`,
      regime: 'ACCRUAL',
      from: month,
      to: month,
      filters: { Situação: status },
      sections: [headline, ...snap.sections],
      notes: [...snap.warnings, 'Resultado operacional/gerencial; não é lucro contábil definitivo.'],
      comparison: null,
    };
    return { report, company: await this.reports.companyName(ctx.companyId) };
  }

  // -------------------------------------------------------------------------

  private async snapshot(ctx: TenantContext, start: Date): Promise<ClosingSnapshot> {
    const month = formatMonth(start);
    const end = lastOfMonth(start);
    const q = { from: month, to: month };
    const [period, cash, vehicles, routes, contracts, pending] = await Promise.all([
      this.reports.build(ctx, 'result-by-period', q),
      this.reports.build(ctx, 'cash-flow', q),
      this.reports.build(ctx, 'result-by-vehicle', q),
      this.reports.build(ctx, 'result-by-route', q),
      this.reports.build(ctx, 'revenue-by-contract', q),
      this.pending(ctx.companyId, start, end),
    ]);
    const row = period.sections[0].rows[0] ?? {};
    const balances = cash.sections[1];
    const totals = {
      revenue: String(row.revenue ?? '0.00'),
      expense: String(row.expense ?? '0.00'),
      result: String(row.result ?? '0.00'),
      received: String(row.received ?? '0.00'),
      paid: String(row.paid ?? '0.00'),
      cashResult: String(row.cash ?? '0.00'),
      balance: String(balances.totals?.balance ?? '0.00'),
    };
    const warnings: string[] = [];
    if (pending.pendingApprovals) warnings.push(`${pending.pendingApprovals} despesa(s) de motorista deste mês aguardando aprovação ficam fora do fechamento.`);
    if (pending.unbilledKmDays) warnings.push(`${pending.unbilledKmDays} dia(s) de km rodado ainda não faturados (R$ ${pending.unbilledKmAmount.replace('.', ',')}).`);
    if (pending.missingRateDays) warnings.push(`${pending.missingRateDays} dia(s) de km em veículos sem valor por km.`);
    return {
      month,
      generatedAt: new Date().toISOString(),
      totals,
      pending: {
        payablesOpenCount: pending.payablesOpenCount,
        payablesOpen: pending.payablesOpen,
        receivablesOpenCount: pending.receivablesOpenCount,
        receivablesOpen: pending.receivablesOpen,
        pendingApprovals: pending.pendingApprovals,
        unbilledKmDays: pending.unbilledKmDays,
        unbilledKmAmount: pending.unbilledKmAmount,
      },
      sections: [...vehicles.sections, ...routes.sections, ...contracts.sections, balances],
      warnings,
    };
  }

  /** Pendências até o fim do mês: obrigações em aberto (competência ≤ mês), aprovações e km não faturado. */
  private async pending(companyId: string, start: Date, end: Date) {
    const [payables, receivables, approvals, km, missing] = await Promise.all([
      this.prisma.payable.aggregate({
        where: { companyId, approvalStatus: 'APPROVED', status: { in: ['PENDING', 'PARTIALLY_PAID'] }, competence: { lte: start } },
        _sum: { amount: true, paidAmount: true },
        _count: true,
      }),
      this.prisma.receivable.aggregate({
        where: { companyId, status: { in: ['PENDING', 'PARTIALLY_RECEIVED'] }, competence: { lte: start } },
        _sum: { amount: true, receivedAmount: true },
        _count: true,
      }),
      this.prisma.payable.count({ where: { companyId, approvalStatus: 'PENDING_APPROVAL', status: { not: 'CANCELED' }, competence: start } }),
      this.prisma.vehicleDailyLog.aggregate({ where: { companyId, date: { gte: start, lte: end }, receivableId: null, amount: { not: null } }, _sum: { amount: true }, _count: true }),
      this.prisma.vehicleDailyLog.count({ where: { companyId, date: { gte: start, lte: end }, amount: null } }),
    ]);
    return {
      payablesOpenCount: payables._count,
      payablesOpen: fromCents(toCents(payables._sum.amount ?? '0') - toCents(payables._sum.paidAmount ?? '0')),
      receivablesOpenCount: receivables._count,
      receivablesOpen: fromCents(toCents(receivables._sum.amount ?? '0') - toCents(receivables._sum.receivedAmount ?? '0')),
      pendingApprovals: approvals,
      unbilledKmDays: km._count,
      unbilledKmAmount: fromCents(toCents(km._sum.amount ?? '0')),
      missingRateDays: missing,
    };
  }

  private find(companyId: string, start: Date) {
    return this.prisma.monthlyClosing.findUnique({ where: { companyId_year_month: { companyId, year: start.getUTCFullYear(), month: start.getUTCMonth() + 1 } } });
  }

  private closable(start: Date) {
    return start < firstOfMonth(today());
  }

  private async users(rows: MonthlyClosing[]) {
    const ids = [...new Set(rows.flatMap((r) => [r.closedById, r.reopenedById]).filter((x): x is string => !!x))];
    const list = ids.length ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
    return new Map(list.map((u) => [u.id, u]));
  }

  private dto(month: string, row: Row | null) {
    if (!row) {
      return { month, status: 'OPEN' as const, version: 0, closedAt: null, closedBy: null, reopenedAt: null, reopenedBy: null, reopenReason: null, closable: this.closable(parseMonth(month)) };
    }
    return {
      month,
      status: row.status,
      version: row.version,
      closedAt: row.closedAt,
      closedBy: row.closedBy ?? null,
      reopenedAt: row.reopenedAt,
      reopenedBy: row.reopenedBy ?? null,
      reopenReason: row.reopenReason,
      closable: this.closable(parseMonth(month)),
    };
  }
}

function label(month: string) {
  const [y, m] = month.split('-');
  return `${m}/${y}`;
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { badRequest, notFound } from '../../common/errors';
import type { TenantContext } from '../../common/tenant/tenant-context';
import { addDays } from '../../common/utils/dates';
import { FUEL_CATEGORY_KEYS, MAINTENANCE_CATEGORY_KEYS, addMonths, firstOfMonth, formatMonth, fromCents, lastOfMonth, monthsBetween, parseMonth, toCents, today } from '../../domain';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../transactions/ledger.service';
import { RecurrenceService } from '../obligations/recurrence.service';
import type { DashboardQueryDto } from './dashboard.dto';
import { ResultsService } from './results.service';

type Side = 'payables' | 'receivables';

interface Scope {
  companyId: string;
  vehicleId?: string;
  categoryId?: string;
}

/**
 * Indicadores do dashboard, sempre de consultas reais. Cada bloco declara o
 * regime: CAIXA (liquidações efetivas por data) ou COMPETÊNCIA gerencial
 * (obrigações pelo mês a que pertencem). Transferências e ajustes de saldo
 * nunca entram em receita/despesa. Com filtro de veículo, os valores são a
 * parcela atribuída ao veículo (alocações), proporcional no caixa.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly results: ResultsService,
    private readonly recurrence: RecurrenceService,
  ) {}

  async get(ctx: TenantContext, q: DashboardQueryDto) {
    const current = firstOfMonth(today());
    const from = q.from ? parseMonth(q.from) : current;
    const to = q.to ? parseMonth(q.to) : from;
    if (from > to) throw badRequest('O mês inicial deve ser anterior ao final');
    const span = monthsBetween(from, to).length;
    if (span > 24) throw badRequest('Consulte no máximo 24 meses');
    const scope: Scope = { companyId: ctx.companyId, vehicleId: q.vehicleId, categoryId: q.categoryId };
    if (q.vehicleId && !(await this.prisma.vehicle.findFirst({ where: { id: q.vehicleId, companyId: ctx.companyId }, select: { id: true } }))) {
      throw notFound('Veículo não encontrado');
    }
    if (q.categoryId && !(await this.prisma.financialCategory.findFirst({ where: { id: q.categoryId, companyId: ctx.companyId }, select: { id: true } }))) {
      throw notFound('Categoria não encontrada');
    }
    await this.recurrence.generateDue(ctx.companyId);

    const chartFrom = span >= 6 ? (span > 12 ? addMonths(to, -11, 1) : from) : addMonths(to, -5, 1);
    const periodEnd = lastOfMonth(to);

    const [balances, accrualMonths, cashMonths, byCategory, payablesOpen, receivablesOpen, vehicles] = await Promise.all([
      this.balances(ctx.companyId),
      this.accrualByMonth(scope, chartFrom < from ? chartFrom : from, to),
      this.cashByMonth(scope, chartFrom < from ? chartFrom : from, periodEnd),
      this.expensesByCategory(scope, from, to),
      this.openObligations(scope, 'payables'),
      this.openObligations(scope, 'receivables'),
      this.vehicleResults(scope, from, to),
    ]);

    const inPeriod = (m: string) => m >= formatMonth(from) && m <= formatMonth(to);
    const sumMonths = <T extends Record<string, number>>(map: Map<string, T>, key: keyof T) =>
      [...map.entries()].filter(([m]) => inPeriod(m)).reduce((acc, [, v]) => acc + v[key], 0);

    const received = sumMonths(cashMonths, 'in');
    const paid = sumMonths(cashMonths, 'out');
    const revenue = sumMonths(accrualMonths, 'revenue');
    const expense = sumMonths(accrualMonths, 'expense');

    const monthly = monthsBetween(chartFrom, to).map((d) => {
      const m = formatMonth(d);
      const a = accrualMonths.get(m);
      const c = cashMonths.get(m);
      return {
        month: m,
        cashIn: fromCents(c?.in ?? 0),
        cashOut: fromCents(c?.out ?? 0),
        revenue: fromCents(a?.revenue ?? 0),
        expense: fromCents(a?.expense ?? 0),
        maintenance: fromCents(a?.maintenance ?? 0),
        fuel: fromCents(a?.fuel ?? 0),
      };
    });

    return {
      from: formatMonth(from),
      to: formatMonth(to),
      balances,
      cash: { regime: 'CASH' as const, received: fromCents(received), paid: fromCents(paid), result: fromCents(received - paid) },
      accrual: { regime: 'ACCRUAL' as const, revenue: fromCents(revenue), expense: fromCents(expense), result: fromCents(revenue - expense) },
      payables: payablesOpen,
      receivables: receivablesOpen,
      vehicles: this.vehiclesSummary(vehicles, revenue, expense, !!scope.vehicleId),
      monthly,
      expensesByCategory: byCategory,
    };
  }

  private async balances(companyId: string) {
    const accounts = await this.prisma.financialAccount.findMany({
      where: { companyId, status: 'ACTIVE' },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
    const map = await this.ledger.balances(companyId, { accountIds: accounts.map((a) => a.id) });
    const total = accounts.reduce((acc, a) => acc + (map.get(a.id) ?? 0), 0);
    return { total: fromCents(total), accounts: accounts.map((a) => ({ ...a, balance: fromCents(map.get(a.id) ?? 0) })) };
  }

  /**
   * Fragmentos SQL do escopo de uma obrigação (alias o): empresa, não
   * cancelada, aprovada (despesas), categoria e — com veículo — a parcela
   * alocada ao veículo (va.amount).
   */
  private scopeSql(side: Side, s: Scope) {
    const alloc = side === 'payables' ? Prisma.sql`expense_allocations` : Prisma.sql`revenue_allocations`;
    const fk = side === 'payables' ? Prisma.sql`"payableId"` : Prisma.sql`"receivableId"`;
    const join = s.vehicleId
      ? Prisma.sql`JOIN LATERAL (SELECT SUM(x.amount) AS amount FROM ${alloc} x WHERE x.${fk} = o.id AND x."vehicleId" = ${s.vehicleId}::uuid) va ON va.amount IS NOT NULL`
      : Prisma.empty;
    const where = Prisma.sql`o."companyId" = ${s.companyId}::uuid AND o.status <> 'CANCELED'
      ${side === 'payables' ? Prisma.sql`AND o."approvalStatus" = 'APPROVED'` : Prisma.empty}
      ${s.categoryId ? Prisma.sql`AND o."categoryId" = ${s.categoryId}::uuid` : Prisma.empty}`;
    /** Valor da obrigação no escopo (inteiro ou parcela do veículo). */
    const amount = s.vehicleId ? Prisma.sql`va.amount` : Prisma.sql`o.amount`;
    /** Converte um valor da obrigação para a parcela do veículo. */
    const share = (expr: Prisma.Sql) => (s.vehicleId ? Prisma.sql`ROUND(${expr} * va.amount / o.amount, 2)` : expr);
    const table = side === 'payables' ? Prisma.sql`payables` : Prisma.sql`receivables`;
    return { table, join, where, amount, share };
  }

  private async accrualByMonth(s: Scope, from: Date, to: Date) {
    const p = this.scopeSql('payables', s);
    const r = this.scopeSql('receivables', s);
    const maintenance = Prisma.join(MAINTENANCE_CATEGORY_KEYS.map((k) => Prisma.sql`${k}`));
    const fuel = Prisma.join(FUEL_CATEGORY_KEYS.map((k) => Prisma.sql`${k}`));
    const [exp, rev] = await Promise.all([
      this.prisma.$queryRaw<{ month: Date; total: string; maintenance: string; fuel: string }[]>`
        SELECT o.competence AS month, SUM(${p.amount})::text AS total,
               SUM(CASE WHEN c."systemKey" IN (${maintenance}) THEN ${p.amount} ELSE 0 END)::text AS maintenance,
               SUM(CASE WHEN c."systemKey" IN (${fuel}) THEN ${p.amount} ELSE 0 END)::text AS fuel
        FROM ${p.table} o JOIN financial_categories c ON c.id = o."categoryId" ${p.join}
        WHERE ${p.where} AND o.competence BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1`,
      this.prisma.$queryRaw<{ month: Date; total: string }[]>`
        SELECT o.competence AS month, SUM(${r.amount})::text AS total
        FROM ${r.table} o ${r.join}
        WHERE ${r.where} AND o.competence BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1`,
    ]);
    const map = new Map<string, { revenue: number; expense: number; maintenance: number; fuel: number }>();
    const get = (m: Date) => {
      const key = formatMonth(m);
      if (!map.has(key)) map.set(key, { revenue: 0, expense: 0, maintenance: 0, fuel: 0 });
      return map.get(key)!;
    };
    for (const row of exp) Object.assign(get(row.month), { expense: toCents(row.total), maintenance: toCents(row.maintenance), fuel: toCents(row.fuel) });
    for (const row of rev) get(row.month).revenue = toCents(row.total);
    return map;
  }

  /** Caixa: liquidações não estornadas pela data efetiva. */
  private async cashByMonth(s: Scope, from: Date, to: Date) {
    const end = to < today() ? to : today();
    const query = (side: Side) => {
      const o = this.scopeSql(side, s);
      const fk = side === 'payables' ? Prisma.sql`"payableId"` : Prisma.sql`"receivableId"`;
      return this.prisma.$queryRaw<{ month: Date; total: string }[]>`
        SELECT date_trunc('month', st."settledAt")::date AS month, SUM(${o.share(Prisma.sql`st.amount`)})::text AS total
        FROM settlements st JOIN ${o.table} o ON o.id = st.${fk} ${o.join}
        WHERE ${o.where} AND st."reversedAt" IS NULL AND st."settledAt" BETWEEN ${from}::date AND ${end}::date
        GROUP BY 1`;
    };
    const [out, inn] = await Promise.all([query('payables'), query('receivables')]);
    const map = new Map<string, { in: number; out: number }>();
    const get = (m: Date) => {
      const key = formatMonth(m);
      if (!map.has(key)) map.set(key, { in: 0, out: 0 });
      return map.get(key)!;
    };
    for (const row of out) get(row.month).out = toCents(row.total);
    for (const row of inn) get(row.month).in = toCents(row.total);
    return map;
  }

  private async expensesByCategory(s: Scope, from: Date, to: Date) {
    const p = this.scopeSql('payables', s);
    const rows = await this.prisma.$queryRaw<{ categoryId: string; name: string; systemKey: string | null; total: string }[]>`
      SELECT c.id AS "categoryId", c.name, c."systemKey", SUM(${p.amount})::text AS total
      FROM payables o JOIN financial_categories c ON c.id = o."categoryId" ${p.join}
      WHERE ${p.where} AND o.competence BETWEEN ${from}::date AND ${to}::date
      GROUP BY 1, 2, 3
      ORDER BY SUM(${p.amount}) DESC`;
    return rows.map((r) => ({ categoryId: r.categoryId, name: r.name, systemKey: r.systemKey, amount: fromCents(toCents(r.total)) }));
  }

  /** Em aberto (todas as datas): total, vencido e vencendo nos próximos 7 dias. */
  private async openObligations(s: Scope, side: Side) {
    const o = this.scopeSql(side, s);
    const settled = side === 'payables' ? Prisma.sql`o."paidAmount"` : Prisma.sql`o."receivedAmount"`;
    const now = today();
    const soon = addDays(now, 7);
    const open = o.share(Prisma.sql`(o.amount - ${settled})`);
    const [row] = await this.prisma.$queryRaw<{ open: string | null; openCount: number; overdue: string | null; overdueCount: number; soon: string | null; soonCount: number }[]>`
      SELECT SUM(${open})::text AS open, COUNT(*)::int AS "openCount",
             SUM(CASE WHEN o."dueDate" < ${now}::date THEN ${open} ELSE 0 END)::text AS overdue,
             COUNT(*) FILTER (WHERE o."dueDate" < ${now}::date)::int AS "overdueCount",
             SUM(CASE WHEN o."dueDate" BETWEEN ${now}::date AND ${soon}::date THEN ${open} ELSE 0 END)::text AS soon,
             COUNT(*) FILTER (WHERE o."dueDate" BETWEEN ${now}::date AND ${soon}::date)::int AS "soonCount"
      FROM ${o.table} o ${o.join}
      WHERE ${o.where} AND o.status::text IN ('PENDING', 'PARTIALLY_PAID', 'PARTIALLY_RECEIVED')`;
    return {
      open: fromCents(toCents(row.open ?? '0')),
      openCount: row.openCount,
      overdue: fromCents(toCents(row.overdue ?? '0')),
      overdueCount: row.overdueCount,
      dueSoon: fromCents(toCents(row.soon ?? '0')),
      dueSoonCount: row.soonCount,
    };
  }

  private async vehicleResults(s: Scope, from: Date, to: Date) {
    const [rows, vehicles] = await Promise.all([
      this.results.vehicleMonths(s.companyId, from, to, s.vehicleId, s.categoryId),
      this.prisma.vehicle.findMany({
        where: { companyId: s.companyId, ...(s.vehicleId ? { id: s.vehicleId } : { archivedAt: null }) },
        select: { id: true, name: true, plate: true, status: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const totals = new Map<string, { revenue: number; cost: number }>();
    for (const r of rows) {
      const t = totals.get(r.vehicleId) ?? { revenue: 0, cost: 0 };
      t.revenue += r.revenueCents;
      t.cost += r.directCostCents + r.sharedCostCents;
      totals.set(r.vehicleId, t);
    }
    // Veículos arquivados que tiveram movimento no período também aparecem.
    const missing = [...totals.keys()].filter((id) => !vehicles.some((v) => v.id === id));
    const archived = missing.length
      ? await this.prisma.vehicle.findMany({ where: { companyId: s.companyId, id: { in: missing } }, select: { id: true, name: true, plate: true, status: true } })
      : [];
    return { list: [...vehicles, ...archived], totals, activeCount: vehicles.filter((v) => v.status === 'ACTIVE').length };
  }

  private vehiclesSummary(v: Awaited<ReturnType<DashboardService['vehicleResults']>>, revenue: number, expense: number, filtered: boolean) {
    const results: { vehicleId: string | null; name: string; plate: string | null; revenue: string; cost: string; result: string }[] = v.list.map((veh) => {
      const t = v.totals.get(veh.id) ?? { revenue: 0, cost: 0 };
      return { vehicleId: veh.id, name: veh.name, plate: veh.plate, revenue: fromCents(t.revenue), cost: fromCents(t.cost), result: fromCents(t.revenue - t.cost) };
    });
    const allocatedRevenue = [...v.totals.values()].reduce((a, t) => a + t.revenue, 0);
    const allocatedCost = [...v.totals.values()].reduce((a, t) => a + t.cost, 0);
    // O que não foi atribuído a veículo continua no total da empresa: nunca some.
    const r = revenue - allocatedRevenue;
    const c = expense - allocatedCost;
    if (!filtered && (r !== 0 || c !== 0)) {
      results.push({ vehicleId: null, name: 'Não alocado', plate: null, revenue: fromCents(r), cost: fromCents(c), result: fromCents(r - c) });
    }
    return {
      active: v.activeCount,
      costPerVehicle: fromCents(v.activeCount > 0 ? Math.round(allocatedCost / v.activeCount) : 0),
      results,
    };
  }
}

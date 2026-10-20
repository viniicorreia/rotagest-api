import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { badRequest, notFound } from '../../common/errors';
import { dateOnly } from '../../common/serialize';
import type { TenantContext } from '../../common/tenant/tenant-context';
import {
  addMonths,
  allocateLargestRemainder,
  costPerKm,
  firstOfMonth,
  formatMonth,
  fromCents,
  fromKmTenths,
  fromMilliliters,
  kmPerLiter,
  lastOfMonth,
  monthsBetween,
  parseMonth,
  toCents,
  toKmTenths,
  toMilliliters,
  today,
} from '../../domain';
import { PrismaService } from '../../prisma/prisma.service';
import { ContractBillingService } from '../contracts/contract-billing.service';
import { ResultsService } from '../dashboard/results.service';
import { RecurrenceService } from '../obligations/recurrence.service';
import { LedgerService } from '../transactions/ledger.service';
import { MAINTENANCE_LABELS, REPORT_KEYS, REPORT_TITLES, type ReportKey, type ReportQueryDto } from './reports.dto';
import { section, share, type CellValue, type Report, type ReportSection } from './report.types';

interface Period {
  from: Date; // primeiro dia do mês inicial
  to: Date; // último dia do mês final
}

const MAX_MONTHS = 24;

/**
 * Os 10 relatórios (pedido §19). Cada um declara o regime: caixa (data efetiva
 * do pagamento/recebimento), competência gerencial ou vencimento. Valores em
 * centavos durante o cálculo; obrigações canceladas e despesas não aprovadas
 * ficam fora. O resultado é operacional/gerencial, não lucro contábil.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly results: ResultsService,
    private readonly recurrence: RecurrenceService,
    private readonly contractBilling: ContractBillingService,
  ) {}

  catalog() {
    return { items: REPORT_KEYS.map((key) => ({ key, title: REPORT_TITLES[key] })) };
  }

  async build(ctx: TenantContext, key: ReportKey, q: ReportQueryDto): Promise<Report> {
    const period = this.period(q);
    await this.assertFilters(ctx.companyId, q);
    await this.recurrence.generateDue(ctx.companyId);
    await this.contractBilling.generateDue(ctx.companyId, ctx.userId);
    const { regime, sections, notes } = await this.sections(ctx.companyId, key, q, period);
    let comparison: Report['comparison'] = null;
    if (q.compare && sections[0]?.totals) {
      const months = monthsBetween(period.from, firstOfMonth(period.to)).length;
      const prev: Period = { from: addMonths(period.from, -months, 1), to: lastOfMonth(addMonths(period.from, -1, 1)) };
      const before = await this.sections(ctx.companyId, key, q, prev);
      comparison = { from: formatMonth(prev.from), to: formatMonth(prev.to), totals: before.sections[0]?.totals ?? {} };
    }
    return {
      key,
      title: REPORT_TITLES[key],
      regime,
      from: formatMonth(period.from),
      to: formatMonth(period.to),
      filters: await this.filterLabels(ctx.companyId, q),
      sections,
      notes,
      comparison,
    };
  }

  async companyName(companyId: string) {
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { tradeName: true } });
    return c.tradeName;
  }

  // -------------------------------------------------------------------------

  private async sections(companyId: string, key: ReportKey, q: ReportQueryDto, p: Period): Promise<{ regime: Report['regime']; sections: ReportSection[]; notes: string[] }> {
    switch (key) {
      case 'cash-flow':
        return this.cashFlow(companyId, q, p);
      case 'revenue-by-contract':
        return this.revenueByContract(companyId, q, p);
      case 'expenses-by-category':
        return this.expensesByCategory(companyId, q, p);
      case 'result-by-vehicle':
        return this.resultByVehicle(companyId, q, p);
      case 'result-by-route':
        return this.resultByRoute(companyId, q, p);
      case 'result-by-period':
        return this.resultByPeriod(companyId, q, p);
      case 'payables':
        return this.obligations(companyId, 'payables', q, p);
      case 'receivables':
        return this.obligations(companyId, 'receivables', q, p);
      case 'fuel':
        return this.fuel(companyId, q, p);
      case 'maintenance':
        return this.maintenance(companyId, q, p);
    }
  }

  /** 1. Fluxo de caixa: razão das contas (transferências entre contas não contam). */
  private async cashFlow(companyId: string, q: ReportQueryDto, p: Period) {
    const accountFilter = q.accountId ? Prisma.sql`AND t."accountId" = ${q.accountId}::uuid` : Prisma.empty;
    const end = p.to < today() ? p.to : today();
    // Estorno conta como o tipo do lançamento original (pagamento, ajuste, transferência).
    const rows = await this.prisma.$queryRaw<{ month: Date; kind: string; direction: string; total: string }[]>`
      SELECT date_trunc('month', t."occurredAt")::date AS month, COALESCE(o.kind, t.kind)::text AS kind, t.direction::text, SUM(t.amount)::text AS total
      FROM account_transactions t
      LEFT JOIN account_transactions o ON o.id = t."reversesTransactionId"
      WHERE t."companyId" = ${companyId}::uuid AND t."occurredAt" BETWEEN ${p.from}::date AND ${end}::date ${accountFilter}
      GROUP BY 1, 2, 3`;
    const opening = await this.ledger.balances(companyId, { before: p.from, accountIds: q.accountId ? [q.accountId] : undefined });
    let balance = [...opening.values()].reduce((a, b) => a + b, 0);
    const byMonth = new Map<string, { in: number; out: number; adj: number; opening: number }>();
    for (const m of monthsBetween(p.from, firstOfMonth(p.to))) byMonth.set(formatMonth(m), { in: 0, out: 0, adj: 0, opening: 0 });
    for (const r of rows) {
      const m = byMonth.get(formatMonth(r.month));
      if (!m) continue;
      const cents = toCents(r.total);
      const signed = r.direction === 'IN' ? cents : -cents;
      if (r.kind === 'TRANSFER' && !q.accountId) continue; // entre contas da empresa: soma zero
      if (r.kind === 'SETTLEMENT') {
        if (signed > 0) m.in += signed;
        else m.out += -signed;
      } else m.adj += signed; // saldo inicial lançado no período, ajustes e (por conta) transferências
    }
    const out: Record<string, CellValue>[] = [];
    for (const [month, m] of byMonth) {
      const start = balance;
      balance += m.in - m.out + m.adj;
      out.push({ month, opening: fromCents(start), in: fromCents(m.in), out: fromCents(m.out), net: fromCents(m.in - m.out), adjustments: fromCents(m.adj), closing: fromCents(balance) });
    }
    const main = section(
      'Fluxo de caixa mensal',
      [
        { key: 'month', label: 'Mês', type: 'month' },
        { key: 'opening', label: 'Saldo inicial', type: 'money' },
        { key: 'in', label: 'Entradas', type: 'money', sum: true },
        { key: 'out', label: 'Saídas', type: 'money', sum: true },
        { key: 'net', label: 'Resultado de caixa', type: 'money', sum: true },
        { key: 'adjustments', label: 'Saldos iniciais, ajustes e transferências', type: 'money', sum: true },
        { key: 'closing', label: 'Saldo final', type: 'money' },
      ],
      out,
    );
    if (main.totals) {
      main.totals.opening = out[0]?.opening ?? '0.00';
      main.totals.closing = out[out.length - 1]?.closing ?? '0.00';
    }
    const accounts = await this.prisma.financialAccount.findMany({ where: { companyId, ...(q.accountId ? { id: q.accountId } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const closing = await this.ledger.balances(companyId, { asOf: end, accountIds: accounts.map((a) => a.id) });
    const perAccount = section(
      `Saldo por conta em ${dateOnly(end).split('-').reverse().join('/')}`,
      [
        { key: 'account', label: 'Conta', type: 'text' },
        { key: 'balance', label: 'Saldo', type: 'money', sum: true },
      ],
      accounts.map((a) => ({ account: a.name, balance: fromCents(closing.get(a.id) ?? 0) })),
    );
    return {
      regime: 'CASH' as const,
      sections: [main, perAccount],
      notes: ['Entradas e saídas são recebimentos e pagamentos pela data efetiva (estornos descontados). Transferências entre contas da empresa se anulam e não entram; com filtro de conta, aparecem na coluna de ajustes.'],
    };
  }

  /** 2. Receitas por contrato (competência). */
  private async revenueByContract(companyId: string, q: ReportQueryDto, p: Period) {
    const r = this.share('receivables', q);
    const rows = await this.prisma.$queryRaw<{ contractId: string | null; label: string | null; contractor: string | null; expected: string; received: string; count: number }[]>`
      SELECT o."contractId", COALESCE(ct.number, ct.description) AS label, cr.name AS contractor,
             SUM(${r.amount})::text AS expected, SUM(${r.settled})::text AS received, COUNT(DISTINCT o.id)::int AS count
      FROM receivables o ${r.join}
      LEFT JOIN contracts ct ON ct.id = o."contractId"
      LEFT JOIN contractors cr ON cr.id = ct."contractorId"
      WHERE o."companyId" = ${companyId}::uuid AND o.status <> 'CANCELED'
        AND o.competence BETWEEN ${p.from}::date AND ${p.to}::date ${r.filters}
      GROUP BY 1, 2, 3
      ORDER BY SUM(${r.amount}) DESC`;
    const total = rows.reduce((a, x) => a + toCents(x.expected), 0);
    const main = section(
      'Receitas por contrato',
      [
        { key: 'contract', label: 'Contrato', type: 'text' },
        { key: 'contractor', label: 'Contratante', type: 'text' },
        { key: 'count', label: 'Cobranças', type: 'number', sum: true },
        { key: 'expected', label: 'Previsto', type: 'money', sum: true },
        { key: 'received', label: 'Recebido', type: 'money', sum: true },
        { key: 'open', label: 'Em aberto', type: 'money', sum: true },
        { key: 'share', label: '% do total', type: 'percent' },
      ],
      rows.map((x) => ({
        contract: x.contractId ? (x.label ?? 'Contrato sem número') : 'Sem contrato',
        contractor: x.contractor ?? '—',
        count: x.count,
        expected: fromCents(toCents(x.expected)),
        received: fromCents(toCents(x.received)),
        open: fromCents(toCents(x.expected) - toCents(x.received)),
        share: share(toCents(x.expected), total),
      })),
    );
    return { regime: 'ACCRUAL' as const, sections: [main], notes: this.vehicleNote(q) };
  }

  /** 3. Despesas por categoria (competência). */
  private async expensesByCategory(companyId: string, q: ReportQueryDto, p: Period) {
    const e = this.share('payables', q);
    const rows = await this.prisma.$queryRaw<{ name: string; expected: string; paid: string; count: number }[]>`
      SELECT c.name, SUM(${e.amount})::text AS expected, SUM(${e.settled})::text AS paid, COUNT(DISTINCT o.id)::int AS count
      FROM payables o ${e.join}
      JOIN financial_categories c ON c.id = o."categoryId"
      WHERE o."companyId" = ${companyId}::uuid AND o.status <> 'CANCELED' AND o."approvalStatus" = 'APPROVED'
        AND o.competence BETWEEN ${p.from}::date AND ${p.to}::date ${e.filters}
      GROUP BY 1
      ORDER BY SUM(${e.amount}) DESC`;
    const total = rows.reduce((a, x) => a + toCents(x.expected), 0);
    const main = section(
      'Despesas por categoria',
      [
        { key: 'category', label: 'Categoria', type: 'text' },
        { key: 'count', label: 'Lançamentos', type: 'number', sum: true },
        { key: 'expected', label: 'Valor', type: 'money', sum: true },
        { key: 'paid', label: 'Pago', type: 'money', sum: true },
        { key: 'open', label: 'Em aberto', type: 'money', sum: true },
        { key: 'share', label: '% do total', type: 'percent' },
      ],
      rows.map((x) => ({
        category: x.name,
        count: x.count,
        expected: fromCents(toCents(x.expected)),
        paid: fromCents(toCents(x.paid)),
        open: fromCents(toCents(x.expected) - toCents(x.paid)),
        share: share(toCents(x.expected), total),
      })),
    );
    return { regime: 'ACCRUAL' as const, sections: [main], notes: this.vehicleNote(q) };
  }

  /** 4. Resultado por veículo (competência; rateios incluídos). */
  private async resultByVehicle(companyId: string, q: ReportQueryDto, p: Period) {
    const [rows, vehicles, totals] = await Promise.all([
      this.results.vehicleMonths(companyId, p.from, p.to, q.vehicleId, q.categoryId),
      this.prisma.vehicle.findMany({ where: { companyId, ...(q.vehicleId ? { id: q.vehicleId } : {}) }, select: { id: true, name: true, plate: true, archivedAt: true }, orderBy: { name: 'asc' } }),
      q.vehicleId ? null : this.accrualTotals(companyId, p, q.categoryId),
    ]);
    const acc = new Map<string, { revenue: number; direct: number; shared: number }>();
    for (const r of rows) {
      const t = acc.get(r.vehicleId) ?? { revenue: 0, direct: 0, shared: 0 };
      t.revenue += r.revenueCents;
      t.direct += r.directCostCents;
      t.shared += r.sharedCostCents;
      acc.set(r.vehicleId, t);
    }
    const out: Record<string, CellValue>[] = vehicles
      .filter((v) => !v.archivedAt || acc.has(v.id))
      .map((v) => {
        const t = acc.get(v.id) ?? { revenue: 0, direct: 0, shared: 0 };
        const result = t.revenue - t.direct - t.shared;
        return { vehicle: `${v.name} (${v.plate})`, revenue: fromCents(t.revenue), direct: fromCents(t.direct), shared: fromCents(t.shared), result: fromCents(result), margin: share(result, t.revenue) };
      });
    if (totals) {
      const allocated = [...acc.values()].reduce((a, t) => ({ revenue: a.revenue + t.revenue, cost: a.cost + t.direct + t.shared }), { revenue: 0, cost: 0 });
      const rev = totals.revenue - allocated.revenue;
      const cost = totals.expense - allocated.cost;
      if (rev !== 0 || cost !== 0) out.push({ vehicle: 'Não alocado a veículo', revenue: fromCents(rev), direct: fromCents(cost), shared: '0.00', result: fromCents(rev - cost), margin: share(rev - cost, rev) });
    }
    const main = section(
      'Resultado por veículo',
      [
        { key: 'vehicle', label: 'Veículo', type: 'text' },
        { key: 'revenue', label: 'Receita', type: 'money', sum: true },
        { key: 'direct', label: 'Custo direto', type: 'money', sum: true },
        { key: 'shared', label: 'Custo rateado', type: 'money', sum: true },
        { key: 'result', label: 'Resultado', type: 'money', sum: true },
        { key: 'margin', label: 'Margem', type: 'percent' },
      ],
      out,
    );
    return {
      regime: 'ACCRUAL' as const,
      sections: [main],
      notes: ['Resultado gerencial por competência: receitas e despesas atribuídas a cada veículo, diretamente ou por rateio. Não é lucro contábil.'],
    };
  }

  /** 5. Resultado por rota. Receita via contratos ligados à rota (dividida igualmente entre as rotas do contrato); despesa pela rota da despesa. */
  private async resultByRoute(companyId: string, q: ReportQueryDto, p: Period) {
    const [routes, revenueRows, expenseRows] = await Promise.all([
      this.prisma.route.findMany({ where: { companyId, ...(q.routeId ? { id: q.routeId } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.$queryRaw<{ id: string; amount: string; routeIds: string[] | null }[]>`
        SELECT o.id, o.amount::text AS amount,
               (SELECT array_agg(cr."routeId"::text ORDER BY cr."routeId") FROM contract_routes cr WHERE cr."contractId" = o."contractId") AS "routeIds"
        FROM receivables o
        WHERE o."companyId" = ${companyId}::uuid AND o.status <> 'CANCELED' AND o.competence BETWEEN ${p.from}::date AND ${p.to}::date`,
      this.prisma.$queryRaw<{ routeId: string | null; amount: string }[]>`
        SELECT o."routeId", SUM(o.amount)::text AS amount
        FROM payables o
        WHERE o."companyId" = ${companyId}::uuid AND o.status <> 'CANCELED' AND o."approvalStatus" = 'APPROVED'
          AND o.competence BETWEEN ${p.from}::date AND ${p.to}::date
        GROUP BY 1`,
    ]);
    const acc = new Map<string | null, { revenue: number; expense: number }>();
    const add = (id: string | null, field: 'revenue' | 'expense', cents: number) => {
      const t = acc.get(id) ?? { revenue: 0, expense: 0 };
      t[field] += cents;
      acc.set(id, t);
    };
    for (const r of revenueRows) {
      const ids = r.routeIds ?? [];
      if (ids.length === 0) add(null, 'revenue', toCents(r.amount));
      else allocateLargestRemainder(toCents(r.amount), ids.map(() => 1)).forEach((c, i) => add(ids[i], 'revenue', c));
    }
    for (const e of expenseRows) add(e.routeId, 'expense', toCents(e.amount));
    const out: Record<string, CellValue>[] = routes.map((r) => {
      const t = acc.get(r.id) ?? { revenue: 0, expense: 0 };
      return { route: r.name, revenue: fromCents(t.revenue), expense: fromCents(t.expense), result: fromCents(t.revenue - t.expense), margin: share(t.revenue - t.expense, t.revenue) };
    });
    if (!q.routeId) {
      const none = acc.get(null);
      if (none) out.push({ route: 'Sem rota', revenue: fromCents(none.revenue), expense: fromCents(none.expense), result: fromCents(none.revenue - none.expense), margin: share(none.revenue - none.expense, none.revenue) });
    }
    const main = section(
      'Resultado por rota',
      [
        { key: 'route', label: 'Rota', type: 'text' },
        { key: 'revenue', label: 'Receita', type: 'money', sum: true },
        { key: 'expense', label: 'Despesa', type: 'money', sum: true },
        { key: 'result', label: 'Resultado', type: 'money', sum: true },
        { key: 'margin', label: 'Margem', type: 'percent' },
      ],
      out,
    );
    return {
      regime: 'ACCRUAL' as const,
      sections: [main],
      notes: ['Receita: contas a receber de contratos ligados à rota (contrato com várias rotas é dividido igualmente). Despesa: lançamentos com a rota informada.'],
    };
  }

  /** 6. Resultado por período: competência e caixa lado a lado, mês a mês. */
  private async resultByPeriod(companyId: string, q: ReportQueryDto, p: Period) {
    const [accrual, cash] = await Promise.all([
      this.prisma.$queryRaw<{ month: Date; side: string; total: string }[]>`
        SELECT competence AS month, 'R' AS side, SUM(amount)::text AS total FROM receivables
        WHERE "companyId" = ${companyId}::uuid AND status <> 'CANCELED' AND competence BETWEEN ${p.from}::date AND ${p.to}::date
          ${q.categoryId ? Prisma.sql`AND "categoryId" = ${q.categoryId}::uuid` : Prisma.empty}
        GROUP BY 1
        UNION ALL
        SELECT competence, 'P', SUM(amount)::text FROM payables
        WHERE "companyId" = ${companyId}::uuid AND status <> 'CANCELED' AND "approvalStatus" = 'APPROVED' AND competence BETWEEN ${p.from}::date AND ${p.to}::date
          ${q.categoryId ? Prisma.sql`AND "categoryId" = ${q.categoryId}::uuid` : Prisma.empty}
        GROUP BY 1`,
      this.prisma.$queryRaw<{ month: Date; side: string; total: string }[]>`
        SELECT date_trunc('month', st."settledAt")::date AS month, CASE WHEN st."receivableId" IS NULL THEN 'P' ELSE 'R' END AS side, SUM(st.amount)::text AS total
        FROM settlements st
        LEFT JOIN payables pp ON pp.id = st."payableId"
        LEFT JOIN receivables rr ON rr.id = st."receivableId"
        WHERE st."companyId" = ${companyId}::uuid AND st."reversedAt" IS NULL AND st."settledAt" BETWEEN ${p.from}::date AND ${p.to}::date
          ${q.categoryId ? Prisma.sql`AND COALESCE(pp."categoryId", rr."categoryId") = ${q.categoryId}::uuid` : Prisma.empty}
        GROUP BY 1, 2`,
    ]);
    const months = new Map<string, { r: number; p: number; in: number; out: number }>();
    for (const m of monthsBetween(p.from, firstOfMonth(p.to))) months.set(formatMonth(m), { r: 0, p: 0, in: 0, out: 0 });
    for (const a of accrual) {
      const m = months.get(formatMonth(a.month));
      if (m) m[a.side === 'R' ? 'r' : 'p'] += toCents(a.total);
    }
    for (const c of cash) {
      const m = months.get(formatMonth(c.month));
      if (m) m[c.side === 'R' ? 'in' : 'out'] += toCents(c.total);
    }
    const main = section(
      'Resultado por período',
      [
        { key: 'month', label: 'Mês', type: 'month' },
        { key: 'revenue', label: 'Receitas (competência)', type: 'money', sum: true },
        { key: 'expense', label: 'Despesas (competência)', type: 'money', sum: true },
        { key: 'result', label: 'Resultado gerencial', type: 'money', sum: true },
        { key: 'received', label: 'Recebido (caixa)', type: 'money', sum: true },
        { key: 'paid', label: 'Pago (caixa)', type: 'money', sum: true },
        { key: 'cash', label: 'Resultado de caixa', type: 'money', sum: true },
      ],
      [...months].map(([month, m]) => ({
        month,
        revenue: fromCents(m.r),
        expense: fromCents(m.p),
        result: fromCents(m.r - m.p),
        received: fromCents(m.in),
        paid: fromCents(m.out),
        cash: fromCents(m.in - m.out),
      })),
    );
    return {
      regime: 'ACCRUAL' as const,
      sections: [main],
      notes: ['Competência: receitas e despesas pelo mês a que pertencem. Caixa: pagamentos e recebimentos pela data efetiva. O resultado é operacional, não lucro contábil.'],
    };
  }

  /** 7 e 8. Contas a pagar / a receber pelo vencimento. */
  private async obligations(companyId: string, side: 'payables' | 'receivables', q: ReportQueryDto, p: Period) {
    const now = today();
    const open = side === 'payables' ? ['PENDING', 'PARTIALLY_PAID'] : ['PENDING', 'PARTIALLY_RECEIVED'];
    const done = side === 'payables' ? 'PAID' : 'RECEIVED';
    const status: Prisma.PayableWhereInput & Prisma.ReceivableWhereInput =
      q.status === 'OPEN'
        ? { status: { in: open as never } }
        : q.status === 'OVERDUE'
          ? { status: { in: open as never }, dueDate: { lt: now } }
          : q.status === 'SETTLED'
            ? { status: done as never }
            : { status: { not: 'CANCELED' } };
    const where = {
      companyId,
      dueDate: { gte: p.from, lte: p.to },
      ...status,
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.vehicleId ? { OR: [{ vehicleId: q.vehicleId }, { allocations: { some: { vehicleId: q.vehicleId } } }] } : {}),
    };
    const include = { category: { select: { name: true } }, vehicle: { select: { name: true } } } as const;
    type Row = { dueDate: Date; description: string; competence: Date; amount: Prisma.Decimal; status: string; category: { name: string }; vehicle: { name: string } | null; settled: Prisma.Decimal; extra: string | null };
    let rows: Row[];
    if (side === 'payables') {
      const list = await this.prisma.payable.findMany({
        where: { ...where, approvalStatus: 'APPROVED', ...(q.routeId ? { routeId: q.routeId } : {}) },
        include: { ...include, driver: { select: { name: true } } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        take: 2000,
      });
      rows = list.map((x) => ({ ...x, settled: x.paidAmount, extra: x.supplierName ?? x.driver?.name ?? null }));
    } else {
      const list = await this.prisma.receivable.findMany({
        where: { ...where, ...(q.contractId ? { contractId: q.contractId } : {}) },
        include: { ...include, contract: { select: { number: true, contractor: { select: { name: true } } } } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        take: 2000,
      });
      rows = list.map((x) => ({ ...x, settled: x.receivedAmount, extra: x.contract?.contractor.name ?? null }));
    }
    const label = (s: string, due: Date) => {
      if (s === 'CANCELED') return 'Cancelada';
      if (s === done) return side === 'payables' ? 'Paga' : 'Recebida';
      const overdue = due < now;
      const partial = s.startsWith('PARTIALLY');
      return `${partial ? 'Parcial' : 'Em aberto'}${overdue ? ' · vencida' : ''}`;
    };
    const main = section(
      side === 'payables' ? 'Contas a pagar' : 'Contas a receber',
      [
        { key: 'dueDate', label: 'Vencimento', type: 'date' },
        { key: 'description', label: 'Descrição', type: 'text' },
        { key: 'party', label: side === 'payables' ? 'Fornecedor/motorista' : 'Contratante/pagador', type: 'text' },
        { key: 'category', label: 'Categoria', type: 'text' },
        { key: 'competence', label: 'Competência', type: 'month' },
        { key: 'amount', label: 'Valor', type: 'money', sum: true },
        { key: 'settled', label: side === 'payables' ? 'Pago' : 'Recebido', type: 'money', sum: true },
        { key: 'open', label: 'Em aberto', type: 'money', sum: true },
        { key: 'status', label: 'Situação', type: 'text' },
      ],
      rows.map((x) => ({
        dueDate: dateOnly(x.dueDate),
        description: x.vehicle ? `${x.description} · ${x.vehicle.name}` : x.description,
        party: x.extra,
        category: x.category.name,
        competence: formatMonth(x.competence),
        amount: fromCents(toCents(x.amount)),
        settled: fromCents(toCents(x.settled)),
        open: fromCents(toCents(x.amount) - toCents(x.settled)),
        status: label(x.status, x.dueDate),
      })),
      'Total',
    );
    if (main.totals) main.totals.dueDate = null;
    if (main.totals) main.totals.description = `${rows.length} lançamento(s)`;
    return { regime: 'DUE' as const, sections: [main], notes: rows.length === 2000 ? ['Mostrando os primeiros 2.000 lançamentos; refine os filtros.'] : [] };
  }

  /** 9. Combustível: por veículo, com km do registro diário, km/l e custo por km. */
  private async fuel(companyId: string, q: ReportQueryDto, p: Period) {
    const vehicleWhere = q.vehicleId ? { vehicleId: q.vehicleId } : {};
    const [fuels, logs, vehicles] = await Promise.all([
      this.prisma.fuelExpenseDetail.findMany({
        where: { companyId, filledAt: { gte: p.from, lte: p.to }, payable: { status: { not: 'CANCELED' }, approvalStatus: 'APPROVED' }, ...vehicleWhere },
        include: { vehicle: { select: { name: true } }, payable: { select: { amount: true } } },
        orderBy: [{ filledAt: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.vehicleDailyLog.groupBy({ by: ['vehicleId'], where: { companyId, date: { gte: p.from, lte: p.to }, ...vehicleWhere }, _sum: { kmDriven: true } }),
      this.prisma.vehicle.findMany({ where: { companyId, ...(q.vehicleId ? { id: q.vehicleId } : {}) }, select: { id: true, name: true, plate: true }, orderBy: { name: 'asc' } }),
    ]);
    const acc = new Map<string, { count: number; ml: number; cents: number; km: number }>();
    const get = (id: string) => acc.get(id) ?? (acc.set(id, { count: 0, ml: 0, cents: 0, km: 0 }), acc.get(id)!);
    for (const f of fuels) {
      const a = get(f.vehicleId);
      a.count += 1;
      a.ml += toMilliliters(f.liters);
      a.cents += toCents(f.payable.amount);
    }
    for (const l of logs) get(l.vehicleId).km += toKmTenths(l._sum.kmDriven ?? '0');
    const summary = section(
      'Combustível por veículo',
      [
        { key: 'vehicle', label: 'Veículo', type: 'text' },
        { key: 'count', label: 'Abastecimentos', type: 'number', sum: true },
        { key: 'liters', label: 'Litros', type: 'number', sum: true },
        { key: 'amount', label: 'Valor', type: 'money', sum: true },
        { key: 'avgPrice', label: 'Preço médio/L', type: 'money' },
        { key: 'km', label: 'Km rodados', type: 'number', sum: true },
        { key: 'kmPerLiter', label: 'km/l', type: 'number' },
        { key: 'costPerKm', label: 'Combustível por km', type: 'money' },
      ],
      vehicles
        .filter((v) => acc.has(v.id))
        .map((v) => {
          const a = acc.get(v.id)!;
          return {
            vehicle: `${v.name} (${v.plate})`,
            count: a.count,
            liters: fromMilliliters(a.ml),
            amount: fromCents(a.cents),
            // R$/L com 2 casas: centavos × 1000 / ml
            avgPrice: a.ml ? fromCents(Math.floor((a.cents * 1000 + Math.floor(a.ml / 2)) / a.ml)) : null,
            km: fromKmTenths(a.km),
            kmPerLiter: kmPerLiter(a.km, a.ml),
            costPerKm: costPerKm(a.cents, a.km),
          };
        }),
    );
    const detail = section(
      'Abastecimentos',
      [
        { key: 'date', label: 'Data', type: 'date' },
        { key: 'vehicle', label: 'Veículo', type: 'text' },
        { key: 'station', label: 'Posto', type: 'text' },
        { key: 'liters', label: 'Litros', type: 'number', sum: true },
        { key: 'price', label: 'Preço/L', type: 'number' },
        { key: 'amount', label: 'Valor', type: 'money', sum: true },
        { key: 'odometer', label: 'Hodômetro', type: 'number' },
      ],
      fuels.map((f) => ({
        date: dateOnly(f.filledAt),
        vehicle: f.vehicle.name,
        station: f.station,
        liters: f.liters.toFixed(3),
        price: f.pricePerLiter.toFixed(4),
        amount: fromCents(toCents(f.payable.amount)),
        odometer: f.odometerKm,
      })),
    );
    return { regime: 'OPERATIONAL' as const, sections: [summary, detail], notes: ['Km rodados vêm do registro diário de km. Abastecimentos enviados por motoristas só entram depois de aprovados.'] };
  }

  /** 10. Custos de manutenção por veículo e por tipo. */
  private async maintenance(companyId: string, q: ReportQueryDto, p: Period) {
    const list = await this.prisma.maintenance.findMany({
      where: { companyId, date: { gte: p.from, lte: p.to }, OR: [{ payableId: null }, { payable: { status: { not: 'CANCELED' } } }], ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}) },
      include: { vehicle: { select: { id: true, name: true, plate: true } } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    });
    const byVehicle = new Map<string, { label: string; count: number; cents: number }>();
    const byType = new Map<string, { count: number; cents: number }>();
    for (const m of list) {
      const v = byVehicle.get(m.vehicleId) ?? { label: `${m.vehicle.name} (${m.vehicle.plate})`, count: 0, cents: 0 };
      v.count += 1;
      v.cents += toCents(m.amount);
      byVehicle.set(m.vehicleId, v);
      const t = byType.get(m.type) ?? { count: 0, cents: 0 };
      t.count += 1;
      t.cents += toCents(m.amount);
      byType.set(m.type, t);
    }
    const total = list.reduce((a, m) => a + toCents(m.amount), 0);
    const sections = [
      section(
        'Manutenção por veículo',
        [
          { key: 'vehicle', label: 'Veículo', type: 'text' },
          { key: 'count', label: 'Serviços', type: 'number', sum: true },
          { key: 'amount', label: 'Valor', type: 'money', sum: true },
          { key: 'share', label: '% do total', type: 'percent' },
        ],
        [...byVehicle.values()].sort((a, b) => b.cents - a.cents).map((v) => ({ vehicle: v.label, count: v.count, amount: fromCents(v.cents), share: share(v.cents, total) })),
      ),
      section(
        'Por tipo',
        [
          { key: 'type', label: 'Tipo', type: 'text' },
          { key: 'count', label: 'Serviços', type: 'number', sum: true },
          { key: 'amount', label: 'Valor', type: 'money', sum: true },
        ],
        [...byType].sort((a, b) => b[1].cents - a[1].cents).map(([type, t]) => ({ type: MAINTENANCE_LABELS[type] ?? type, count: t.count, amount: fromCents(t.cents) })),
      ),
      section(
        'Serviços',
        [
          { key: 'date', label: 'Data', type: 'date' },
          { key: 'vehicle', label: 'Veículo', type: 'text' },
          { key: 'type', label: 'Tipo', type: 'text' },
          { key: 'description', label: 'Descrição', type: 'text' },
          { key: 'supplier', label: 'Fornecedor', type: 'text' },
          { key: 'odometer', label: 'Hodômetro', type: 'number' },
          { key: 'amount', label: 'Valor', type: 'money', sum: true },
        ],
        list.map((m) => ({
          date: dateOnly(m.date),
          vehicle: m.vehicle.name,
          type: MAINTENANCE_LABELS[m.type] ?? m.type,
          description: m.description,
          supplier: m.supplierName,
          odometer: m.odometerKm,
          amount: fromCents(toCents(m.amount)),
        })),
      ),
    ];
    return { regime: 'OPERATIONAL' as const, sections, notes: ['Pela data do serviço. Manutenções com a conta cancelada não entram.'] };
  }

  // -------------------------------------------------------------------------

  private period(q: ReportQueryDto): Period {
    const current = firstOfMonth(today());
    const from = q.from ? parseMonth(q.from) : current;
    const to = q.to ? parseMonth(q.to) : from;
    if (from > to) throw badRequest('O mês inicial deve ser anterior ao final');
    if (monthsBetween(from, to).length > MAX_MONTHS) throw badRequest(`Consulte no máximo ${MAX_MONTHS} meses`);
    return { from, to: lastOfMonth(to) };
  }

  /** Filtros sempre conferidos contra a empresa do token (404 se for de outra). */
  private async assertFilters(companyId: string, q: ReportQueryDto) {
    const checks: [string | undefined, () => Promise<unknown>, string][] = [
      [q.vehicleId, () => this.prisma.vehicle.findFirst({ where: { id: q.vehicleId, companyId }, select: { id: true } }), 'Veículo não encontrado'],
      [q.routeId, () => this.prisma.route.findFirst({ where: { id: q.routeId, companyId }, select: { id: true } }), 'Rota não encontrada'],
      [q.contractId, () => this.prisma.contract.findFirst({ where: { id: q.contractId, companyId }, select: { id: true } }), 'Contrato não encontrado'],
      [q.categoryId, () => this.prisma.financialCategory.findFirst({ where: { id: q.categoryId, companyId }, select: { id: true } }), 'Categoria não encontrada'],
      [q.accountId, () => this.prisma.financialAccount.findFirst({ where: { id: q.accountId, companyId }, select: { id: true } }), 'Conta não encontrada'],
    ];
    for (const [id, find, message] of checks) if (id && !(await find())) throw notFound(message);
  }

  private async filterLabels(companyId: string, q: ReportQueryDto) {
    const out: Record<string, string> = {};
    if (q.vehicleId) out['Veículo'] = (await this.prisma.vehicle.findFirstOrThrow({ where: { id: q.vehicleId, companyId }, select: { name: true } })).name;
    if (q.routeId) out['Rota'] = (await this.prisma.route.findFirstOrThrow({ where: { id: q.routeId, companyId }, select: { name: true } })).name;
    if (q.contractId) {
      const c = await this.prisma.contract.findFirstOrThrow({ where: { id: q.contractId, companyId }, select: { number: true, contractor: { select: { name: true } } } });
      out['Contrato'] = c.number ? `${c.number} — ${c.contractor.name}` : c.contractor.name;
    }
    if (q.categoryId) out['Categoria'] = (await this.prisma.financialCategory.findFirstOrThrow({ where: { id: q.categoryId, companyId }, select: { name: true } })).name;
    if (q.accountId) out['Conta'] = (await this.prisma.financialAccount.findFirstOrThrow({ where: { id: q.accountId, companyId }, select: { name: true } })).name;
    if (q.status) out['Situação'] = { OPEN: 'Em aberto', OVERDUE: 'Vencidas', SETTLED: 'Liquidadas' }[q.status];
    return out;
  }

  /**
   * Valor por obrigação, ou só a parte do veículo filtrado (alocação). O
   * liquidado do veículo é proporcional à sua parte.
   */
  private share(side: 'payables' | 'receivables', q: ReportQueryDto) {
    const settledCol = side === 'payables' ? Prisma.sql`o."paidAmount"` : Prisma.sql`o."receivedAmount"`;
    const filters: Prisma.Sql[] = [];
    if (q.categoryId) filters.push(Prisma.sql`AND o."categoryId" = ${q.categoryId}::uuid`);
    if (side === 'receivables' && q.contractId) filters.push(Prisma.sql`AND o."contractId" = ${q.contractId}::uuid`);
    if (side === 'payables' && q.routeId) filters.push(Prisma.sql`AND o."routeId" = ${q.routeId}::uuid`);
    if (!q.vehicleId) return { amount: Prisma.sql`o.amount`, settled: settledCol, join: Prisma.empty, filters: Prisma.join(filters, ' ') };
    const table = side === 'payables' ? Prisma.sql`expense_allocations` : Prisma.sql`revenue_allocations`;
    const fk = side === 'payables' ? Prisma.sql`"payableId"` : Prisma.sql`"receivableId"`;
    return {
      amount: Prisma.sql`a.amount`,
      settled: Prisma.sql`ROUND(${settledCol} * a.amount / NULLIF(o.amount, 0), 2)`,
      join: Prisma.sql`JOIN ${table} a ON a.${fk} = o.id AND a."vehicleId" = ${q.vehicleId}::uuid`,
      filters: Prisma.join(filters, ' '),
    };
  }

  private vehicleNote(q: ReportQueryDto) {
    return q.vehicleId ? ['Com filtro de veículo, os valores são a parte atribuída ao veículo (direta ou por rateio).'] : [];
  }

  private async accrualTotals(companyId: string, p: Period, categoryId?: string) {
    const cat = categoryId ? Prisma.sql`AND "categoryId" = ${categoryId}::uuid` : Prisma.empty;
    const [row] = await this.prisma.$queryRaw<{ revenue: string | null; expense: string | null }[]>`
      SELECT (SELECT SUM(amount) FROM receivables WHERE "companyId" = ${companyId}::uuid AND status <> 'CANCELED' AND competence BETWEEN ${p.from}::date AND ${p.to}::date ${cat})::text AS revenue,
             (SELECT SUM(amount) FROM payables WHERE "companyId" = ${companyId}::uuid AND status <> 'CANCELED' AND "approvalStatus" = 'APPROVED' AND competence BETWEEN ${p.from}::date AND ${p.to}::date ${cat})::text AS expense`;
    return { revenue: toCents(row.revenue ?? '0'), expense: toCents(row.expense ?? '0') };
  }
}

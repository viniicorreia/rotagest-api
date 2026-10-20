import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { addMonths, firstOfMonth, formatMonth, fromCents, monthsBetween, toCents } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import { splitAmounts, type AllocationSplit } from '../obligations/allocation';
import { defaultHorizon } from '../obligations/schedule';

export const DEFAULT_CONTRACT_DUE_DAY = 10;

/**
 * Geração das contas a receber dos contratos (ARCHITECTURE.md §6.8): uma por
 * contrato e competência, do início do contrato até o mês que vem. A chave
 * única (contractId, competence) torna a geração idempotente; uma conta
 * cancelada também ocupa a competência, então não volta a ser gerada.
 * Contratos VARIABLE não geram nada (são faturados por km ou à mão).
 */
@Injectable()
export class ContractBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categories: CategoriesService,
  ) {}

  async generateDue(companyId: string, actorUserId: string, opts: { contractId?: string; tx?: Tx } = {}): Promise<number> {
    const client = opts.tx ?? this.prisma;
    const contracts = await client.contract.findMany({
      where: { companyId, status: 'ACTIVE', billingType: { in: ['MONTHLY', 'FIXED_PERIOD'] }, ...(opts.contractId ? { id: opts.contractId } : {}) },
      include: { contractor: { select: { name: true } }, vehicles: { orderBy: { createdAt: 'asc' } } },
    });
    if (contracts.length === 0) return 0;
    const closed = await client.monthlyClosing.findMany({ where: { companyId, status: 'CLOSED' }, select: { year: true, month: true } });
    const closedSet = new Set(closed.map((c) => `${c.year}-${String(c.month).padStart(2, '0')}`));
    const horizon = defaultHorizon();
    let created = 0;

    for (const c of contracts) {
      if (toCents(c.amount) <= 0) continue;
      const start = firstOfMonth(c.startDate);
      const end = c.endDate && firstOfMonth(c.endDate) < horizon ? firstOfMonth(c.endDate) : horizon;
      if (start > end) continue;
      const existing = await client.receivable.findMany({ where: { companyId, contractId: c.id }, select: { competence: true } });
      const have = new Set(existing.map((r) => formatMonth(r.competence)));
      const months = monthsBetween(start, end).filter((m) => !have.has(formatMonth(m)) && !closedSet.has(formatMonth(m)));
      if (months.length === 0) continue;

      const categoryId = c.revenueCategoryId ?? (await this.categories.bySystemKey(client as Tx, companyId, 'CONTRACT')).id;
      const label = (m: Date) => `${String(m.getUTCMonth() + 1).padStart(2, '0')}/${m.getUTCFullYear()}`;
      const rows = await client.receivable.createManyAndReturn({
        data: months.map((m) => ({
          companyId,
          description: `${c.contractor.name}${c.number ? ` — contrato ${c.number}` : ''} — ${label(m)}`,
          categoryId,
          contractId: c.id,
          amount: c.amount,
          competence: m,
          dueDate: addMonths(m, c.dueMonthOffset, c.dueDay ?? DEFAULT_CONTRACT_DUE_DAY),
          kind: 'SINGLE' as const,
          createdById: actorUserId,
        })),
        skipDuplicates: true,
        select: { id: true, amount: true },
      });

      const split = contractSplit(c.vehicles);
      const data: Prisma.RevenueAllocationCreateManyInput[] = rows.flatMap((r): Prisma.RevenueAllocationCreateManyInput[] =>
        split === null
          ? []
          : split.items.length === 1
            ? [{ companyId, receivableId: r.id, vehicleId: split.items[0].vehicleId, contractId: c.id, method: 'DIRECT' as const, percent: '100', amount: r.amount.toFixed(2) }]
            : splitAmounts(split, toCents(r.amount)).map((p) => ({ companyId, receivableId: r.id, vehicleId: p.vehicleId, contractId: c.id, method: split.method, percent: p.percent, amount: fromCents(p.cents) })),
      );
      if (data.length) await client.revenueAllocation.createMany({ data });
      created += rows.length;
    }
    return created;
  }
}

/** Veículos do contrato → rateio da receita (percentual informado ou partes iguais). */
export function contractSplit(vehicles: { vehicleId: string; sharePercent: { toFixed(dp: number): string } | null }[]): AllocationSplit | null {
  if (vehicles.length === 0) return null;
  const withShare = vehicles.every((v) => v.sharePercent !== null && Number(v.sharePercent.toFixed(4)) > 0);
  if (withShare) {
    return { method: 'PERCENT', items: vehicles.map((v) => ({ vehicleId: v.vehicleId, weight: Math.round(Number(v.sharePercent!.toFixed(4)) * 10_000) })) };
  }
  return { method: 'EQUAL', items: vehicles.map((v) => ({ vehicleId: v.vehicleId, weight: 1 })) };
}

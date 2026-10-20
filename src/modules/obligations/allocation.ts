import { badRequest, businessRule, notFound } from '../../common/errors';
import { allocateLargestRemainder, fromCents, toCents } from '../../domain';
import type { Tx } from '../../prisma/prisma.service';

/**
 * Rateio de uma obrigação entre veículos (ARCHITECTURE.md §6.6). A soma das
 * partes é sempre exatamente o valor da obrigação (método do maior resto).
 * Sem rateio, uma obrigação com veículo é 100% DIRECT daquele veículo.
 */
export const SPLIT_METHODS = ['EQUAL', 'PERCENT', 'FIXED'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

/** Percentual com até 4 casas ("33.3333"). */
export const PERCENT_PATTERN = /^\d{1,3}(\.\d{1,4})?$/;

export interface AllocationSplit {
  method: SplitMethod;
  /** Pesos inteiros; a parte de cada veículo é proporcional ao peso. */
  items: { vehicleId: string; weight: number }[];
}

export interface AllocationInput {
  vehicleId: string;
  percent?: string;
  amount?: string;
}

type Target = 'PAYABLE' | 'RECEIVABLE';

/** Valida a entrada do usuário e devolve o rateio em pesos inteiros. */
export function splitFromInput(method: SplitMethod, items: AllocationInput[], totalCents: number): AllocationSplit {
  if (items.length < 2) throw badRequest('Para ratear, escolha pelo menos dois veículos');
  if (new Set(items.map((i) => i.vehicleId)).size !== items.length) throw badRequest('Cada veículo só pode aparecer uma vez no rateio');
  if (method === 'EQUAL') return { method, items: items.map((i) => ({ vehicleId: i.vehicleId, weight: 1 })) };
  if (method === 'PERCENT') {
    const weights = items.map((i) => {
      if (!i.percent || !PERCENT_PATTERN.test(i.percent)) throw badRequest('Informe o percentual de cada veículo (ex.: 33.3333)');
      const [int, dec = ''] = i.percent.split('.');
      return Number(int) * 10_000 + Number(dec.padEnd(4, '0'));
    });
    if (weights.some((w) => w <= 0)) throw badRequest('Cada percentual deve ser maior que zero');
    if (weights.reduce((a, b) => a + b, 0) !== 1_000_000) throw badRequest('Os percentuais do rateio devem somar 100%');
    return { method, items: items.map((i, k) => ({ vehicleId: i.vehicleId, weight: weights[k] })) };
  }
  const cents = items.map((i) => {
    if (!i.amount) throw badRequest('Informe o valor de cada veículo no rateio');
    return toCents(i.amount);
  });
  if (cents.some((c) => c <= 0)) throw badRequest('Cada valor do rateio deve ser maior que zero');
  if (cents.reduce((a, b) => a + b, 0) !== totalCents) throw badRequest('Os valores do rateio devem somar o valor total');
  return { method, items: items.map((i, k) => ({ vehicleId: i.vehicleId, weight: cents[k] })) };
}

/** Parte de cada veículo em centavos para um valor (uma parcela, uma ocorrência...). */
export function splitAmounts(split: AllocationSplit, amountCents: number) {
  const parts = allocateLargestRemainder(amountCents, split.items.map((i) => i.weight));
  const sum = split.items.reduce((a, i) => a + i.weight, 0);
  return split.items.map((i, k) => ({ vehicleId: i.vehicleId, cents: parts[k], percent: ((i.weight / sum) * 100).toFixed(6) }));
}

export async function assertVehiclesUsable(tx: Tx, companyId: string, ids: string[]) {
  const found = await tx.vehicle.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, archivedAt: true } });
  if (found.length !== new Set(ids).size) throw notFound('Veículo não encontrado');
  if (found.some((v) => v.archivedAt)) throw businessRule('Um dos veículos está arquivado');
}

function rows(target: Target, companyId: string, ownerId: string, vehicleId: string | null, split: AllocationSplit | null, amountCents: number) {
  const owner = target === 'PAYABLE' ? { payableId: ownerId } : { receivableId: ownerId };
  if (split) {
    return splitAmounts(split, amountCents).map((p) => ({ companyId, ...owner, vehicleId: p.vehicleId, method: split.method, percent: p.percent, amount: fromCents(p.cents) }));
  }
  if (vehicleId) return [{ companyId, ...owner, vehicleId, method: 'DIRECT' as const, percent: '100', amount: fromCents(amountCents) }];
  return [];
}

/** Regrava as alocações da obrigação: rateio, veículo único (DIRECT) ou nenhuma. */
export async function writeAllocations(tx: Tx, target: Target, companyId: string, ownerId: string, vehicleId: string | null, split: AllocationSplit | null, amountCents: number) {
  if (target === 'PAYABLE') {
    await tx.expenseAllocation.deleteMany({ where: { companyId, payableId: ownerId } });
    const data = rows(target, companyId, ownerId, vehicleId, split, amountCents) as { companyId: string; payableId: string; vehicleId: string; method: SplitMethod | 'DIRECT'; percent: string; amount: string }[];
    if (data.length) await tx.expenseAllocation.createMany({ data });
  } else {
    await tx.revenueAllocation.deleteMany({ where: { companyId, receivableId: ownerId } });
    const data = rows(target, companyId, ownerId, vehicleId, split, amountCents) as { companyId: string; receivableId: string; vehicleId: string; method: SplitMethod | 'DIRECT'; percent: string; amount: string }[];
    if (data.length) await tx.revenueAllocation.createMany({ data });
  }
}

/** Rateio atual da obrigação (null se não for rateada), para reaplicar quando o valor muda. */
export async function currentSplit(tx: Tx, target: Target, companyId: string, ownerId: string): Promise<AllocationSplit | null> {
  const list =
    target === 'PAYABLE'
      ? await tx.expenseAllocation.findMany({ where: { companyId, payableId: ownerId }, orderBy: { createdAt: 'asc' } })
      : await tx.revenueAllocation.findMany({ where: { companyId, receivableId: ownerId }, orderBy: { createdAt: 'asc' } });
  const split = list.filter((a) => a.method !== 'DIRECT' && a.vehicleId);
  if (split.length === 0) return null;
  const method = (SPLIT_METHODS as readonly string[]).includes(split[0].method) ? (split[0].method as SplitMethod) : 'FIXED';
  // Percentual e igual mantêm os pesos originais; no valor fixo, o valor atual de
  // cada parte vira o peso. Assim mudar o total preserva as proporções.
  const weight = (a: (typeof split)[number]) =>
    method === 'PERCENT' ? Math.round(Number(a.percent?.toFixed(6) ?? '0') * 10_000) : method === 'EQUAL' ? 1 : Math.max(1, toCents(a.amount));
  return { method, items: split.map((a) => ({ vehicleId: a.vehicleId!, weight: weight(a) })) };
}

import { Injectable } from '@nestjs/common';
import { Prisma, type TransactionDirection, type TransactionKind } from '@prisma/client';
import { fromCents, toCents } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';

export interface LedgerEntry {
  companyId: string;
  accountId: string;
  kind: TransactionKind;
  direction: TransactionDirection;
  amountCents: number;
  occurredAt: Date;
  description: string;
  settlementId?: string;
  transferId?: string;
  reversesTransactionId?: string;
  reason?: string;
  createdById: string;
}

/**
 * Razão financeiro (AccountTransaction): FONTE ÚNICA de saldo. Não existe
 * coluna de saldo; o saldo é sempre Σ IN − Σ OUT. Lançamentos nunca são
 * alterados (trigger no banco): correções entram como estorno.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tx: Tx, entry: LedgerEntry) {
    if (!Number.isSafeInteger(entry.amountCents) || entry.amountCents <= 0) throw new Error('Lançamento com valor inválido');
    return tx.accountTransaction.create({
      data: {
        companyId: entry.companyId,
        accountId: entry.accountId,
        kind: entry.kind,
        direction: entry.direction,
        amount: fromCents(entry.amountCents),
        occurredAt: entry.occurredAt,
        description: entry.description,
        settlementId: entry.settlementId ?? null,
        transferId: entry.transferId ?? null,
        reversesTransactionId: entry.reversesTransactionId ?? null,
        reason: entry.reason ?? null,
        createdById: entry.createdById,
      },
    });
  }

  /** Estorna um lançamento: mesmo valor, direção oposta, ligado ao original (no máximo um estorno por lançamento). */
  async reverse(tx: Tx, original: { id: string; companyId: string; accountId: string; direction: TransactionDirection; amount: Prisma.Decimal; description: string }, occurredAt: Date, reason: string, userId: string) {
    return this.record(tx, {
      companyId: original.companyId,
      accountId: original.accountId,
      kind: 'REVERSAL',
      direction: original.direction === 'IN' ? 'OUT' : 'IN',
      amountCents: toCents(original.amount),
      occurredAt,
      description: `Estorno: ${original.description}`.slice(0, 200),
      reversesTransactionId: original.id,
      reason,
      createdById: userId,
    });
  }

  /** Saldo em centavos por conta, até `asOf` (inclusive). Contas sem movimento ficam com 0. */
  async balances(companyId: string, opts: { accountIds?: string[]; asOf?: Date; before?: Date } = {}, tx?: Tx): Promise<Map<string, number>> {
    const filters: Prisma.Sql[] = [Prisma.sql`"companyId" = ${companyId}::uuid`];
    if (opts.accountIds) {
      if (opts.accountIds.length === 0) return new Map();
      filters.push(Prisma.sql`"accountId" IN (${Prisma.join(opts.accountIds.map((id) => Prisma.sql`${id}::uuid`))})`);
    }
    if (opts.asOf) filters.push(Prisma.sql`"occurredAt" <= ${opts.asOf}::date`);
    if (opts.before) filters.push(Prisma.sql`"occurredAt" < ${opts.before}::date`);
    const rows = await (tx ?? this.prisma).$queryRaw<{ accountId: string; balance: string }[]>`
      SELECT "accountId", SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END)::text AS balance
      FROM account_transactions
      WHERE ${Prisma.join(filters, ' AND ')}
      GROUP BY "accountId"`;
    const map = new Map<string, number>();
    for (const id of opts.accountIds ?? []) map.set(id, 0);
    for (const row of rows) map.set(row.accountId, toCents(row.balance));
    return map;
  }

  async balanceOf(companyId: string, accountId: string, opts: { asOf?: Date; before?: Date } = {}, tx?: Tx): Promise<number> {
    return (await this.balances(companyId, { accountIds: [accountId], ...opts }, tx)).get(accountId) ?? 0;
  }
}

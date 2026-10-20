import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode, badRequest, businessRule, conflict, notFound } from '../../common/errors';
import { dateOnly, money } from '../../common/serialize';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { fromCents, parseDate, toCents, today } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { AuditService } from '../audit/audit.service';
import type { SettleDto } from '../obligations/obligations.dto';
import { LedgerService } from '../transactions/ledger.service';
import { PeriodLockService } from '../transactions/period-lock.service';

export type ObligationTarget = 'PAYABLE' | 'RECEIVABLE';

export const SETTLEMENT_INCLUDE = { account: { select: { id: true, name: true } } } satisfies Prisma.SettlementInclude;
export type SettlementRow = Prisma.SettlementGetPayload<{ include: typeof SETTLEMENT_INCLUDE }>;

interface ObligationState {
  id: string;
  description: string;
  amount: Prisma.Decimal;
  settled: Prisma.Decimal;
  status: string;
  canceled: boolean;
  approved: boolean;
}

/** Status persistido a partir do valor liquidado (vencida é derivada, não entra aqui). */
export function statusFor(target: ObligationTarget, settledCents: number, amountCents: number) {
  if (settledCents <= 0) return 'PENDING' as const;
  if (settledCents < amountCents) return target === 'PAYABLE' ? ('PARTIALLY_PAID' as const) : ('PARTIALLY_RECEIVED' as const);
  return target === 'PAYABLE' ? ('PAID' as const) : ('RECEIVED' as const);
}

/**
 * Liquidações (pagamentos e recebimentos), ARCHITECTURE.md §6.3. Numa única
 * transação: lock da obrigação → validações → Settlement idempotente →
 * lançamento no razão → cache paidAmount/receivedAmount + status → auditoria.
 * Estorno nunca apaga: marca a liquidação e lança o movimento oposto.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly periods: PeriodLockService,
    private readonly accounts: AccountsService,
  ) {}

  async settle(ctx: TenantContext, target: ObligationTarget, obligationId: string, dto: SettleDto, meta: RequestMeta, outerTx?: Tx): Promise<SettlementRow> {
    const settledAt = dto.settledAt ? parseDate(dto.settledAt) : today();
    if (settledAt > today()) throw badRequest('A data do pagamento/recebimento não pode ser futura');
    const requested = dto.amount !== undefined ? toCents(dto.amount) : null;

    const run = async (tx: Tx) => {
      const replay = await this.findByKey(tx, ctx.companyId, dto.idempotencyKey);
      if (replay) return this.assertReplay(replay, target, obligationId, dto, requested);

      const ob = await this.lockObligation(tx, ctx.companyId, target, obligationId);
      if (ob.canceled) throw businessRule('Este lançamento está cancelado');
      if (!ob.approved) throw businessRule('Esta despesa ainda não foi aprovada');
      const amountCents = toCents(ob.amount);
      const settledCents = toCents(ob.settled);
      const openCents = amountCents - settledCents;
      if (openCents <= 0) throw businessRule(target === 'PAYABLE' ? 'Esta conta já está paga' : 'Esta conta já está recebida');
      const cents = requested ?? openCents;
      if (cents > openCents) throw businessRule(`O valor excede o saldo em aberto (R$ ${fromCents(openCents).replace('.', ',')})`);

      const account = await this.accounts.findActiveOrThrow(tx, ctx.companyId, dto.accountId);
      await this.periods.assertOpen(ctx.companyId, settledAt, tx);

      const settlement = await tx.settlement.create({
        data: {
          companyId: ctx.companyId,
          type: target === 'PAYABLE' ? 'PAYMENT' : 'RECEIPT',
          payableId: target === 'PAYABLE' ? obligationId : null,
          receivableId: target === 'RECEIVABLE' ? obligationId : null,
          accountId: account.id,
          amount: fromCents(cents),
          settledAt,
          method: dto.method,
          idempotencyKey: dto.idempotencyKey,
          notes: dto.notes ?? null,
          createdById: ctx.userId,
        },
        include: SETTLEMENT_INCLUDE,
      });
      await this.ledger.record(tx, {
        companyId: ctx.companyId,
        accountId: account.id,
        kind: 'SETTLEMENT',
        direction: target === 'PAYABLE' ? 'OUT' : 'IN',
        amountCents: cents,
        occurredAt: settledAt,
        description: `${target === 'PAYABLE' ? 'Pagamento' : 'Recebimento'}: ${ob.description}`.slice(0, 200),
        settlementId: settlement.id,
        createdById: ctx.userId,
      });
      await this.writeSettled(tx, target, obligationId, settledCents + cents, amountCents);
      await this.audit.log(
        {
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: target === 'PAYABLE' ? 'payable.paid' : 'receivable.received',
          entityType: 'Settlement',
          entityId: settlement.id,
          after: this.toDto(settlement),
          meta,
        },
        tx,
      );
      return settlement;
    };

    if (outerTx) return run(outerTx);
    try {
      return await this.prisma.$transaction(run);
    } catch (err) {
      // Mesma chave enviada em paralelo: a perdedora da unicidade devolve a liquidação vencedora.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findByKey(this.prisma, ctx.companyId, dto.idempotencyKey);
        if (winner) return this.assertReplay(winner, target, obligationId, dto, requested);
      }
      throw err;
    }
  }

  async reverse(ctx: TenantContext, settlementId: string, reason: string, meta: RequestMeta): Promise<SettlementRow> {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.settlement.findFirst({ where: { id: settlementId, companyId: ctx.companyId }, select: { payableId: true, receivableId: true } });
      if (!found) throw notFound('Pagamento/recebimento não encontrado');
      const target: ObligationTarget = found.payableId ? 'PAYABLE' : 'RECEIVABLE';
      const obligationId = (found.payableId ?? found.receivableId)!;
      const ob = await this.lockObligation(tx, ctx.companyId, target, obligationId);

      const settlement = await tx.settlement.findFirstOrThrow({ where: { id: settlementId }, include: { ...SETTLEMENT_INCLUDE, transactions: true } });
      if (settlement.reversedAt) throw conflict('Este lançamento já foi estornado');
      const when = today();
      await this.periods.assertOpen(ctx.companyId, when, tx);

      const original = settlement.transactions.find((t) => t.kind === 'SETTLEMENT');
      if (!original) throw new Error(`Liquidação ${settlementId} sem lançamento no razão`);
      await this.ledger.reverse(tx, original, when, reason, ctx.userId);

      const updated = await tx.settlement.update({ where: { id: settlementId }, data: { reversedAt: new Date(), reversalReason: reason }, include: SETTLEMENT_INCLUDE });
      await this.writeSettled(tx, target, obligationId, toCents(ob.settled) - toCents(settlement.amount), toCents(ob.amount));
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'settlement.reversed', entityType: 'Settlement', entityId: settlementId, after: this.toDto(updated), reason, meta },
        tx,
      );
      return updated;
    });
  }

  /** `SELECT … FOR UPDATE` na obrigação: serializa liquidações concorrentes do mesmo lançamento. */
  private async lockObligation(tx: Tx, companyId: string, target: ObligationTarget, id: string): Promise<ObligationState> {
    if (target === 'PAYABLE') {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payables WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw notFound('Conta a pagar não encontrada');
      const p = await tx.payable.findUniqueOrThrow({ where: { id }, select: { id: true, description: true, amount: true, paidAmount: true, status: true, approvalStatus: true } });
      return { id, description: p.description, amount: p.amount, settled: p.paidAmount, status: p.status, canceled: p.status === 'CANCELED', approved: p.approvalStatus === 'APPROVED' };
    }
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM receivables WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound('Conta a receber não encontrada');
    const r = await tx.receivable.findUniqueOrThrow({ where: { id }, select: { id: true, description: true, amount: true, receivedAmount: true, status: true } });
    return { id, description: r.description, amount: r.amount, settled: r.receivedAmount, status: r.status, canceled: r.status === 'CANCELED', approved: true };
  }

  private async writeSettled(tx: Tx, target: ObligationTarget, id: string, settledCents: number, amountCents: number) {
    if (settledCents < 0 || settledCents > amountCents) throw new Error('Cache de valor liquidado inconsistente');
    if (target === 'PAYABLE') {
      await tx.payable.update({ where: { id }, data: { paidAmount: fromCents(settledCents), status: statusFor('PAYABLE', settledCents, amountCents) as 'PENDING' | 'PARTIALLY_PAID' | 'PAID' } });
    } else {
      await tx.receivable.update({
        where: { id },
        data: { receivedAmount: fromCents(settledCents), status: statusFor('RECEIVABLE', settledCents, amountCents) as 'PENDING' | 'PARTIALLY_RECEIVED' | 'RECEIVED' },
      });
    }
  }

  private findByKey(client: Tx | PrismaService, companyId: string, key: string) {
    return client.settlement.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey: key } }, include: SETTLEMENT_INCLUDE });
  }

  private assertReplay(existing: SettlementRow, target: ObligationTarget, obligationId: string, dto: SettleDto, requested: number | null): SettlementRow {
    const sameOwner = target === 'PAYABLE' ? existing.payableId === obligationId : existing.receivableId === obligationId;
    const sameAmount = requested === null || toCents(existing.amount) === requested;
    if (!sameOwner || !sameAmount || existing.accountId !== dto.accountId) {
      throw conflict('Esta chave de idempotência já foi usada em outro lançamento', ErrorCode.IDEMPOTENCY_CONFLICT);
    }
    return existing;
  }

  toDto(s: SettlementRow) {
    return {
      id: s.id,
      type: s.type,
      amount: money(s.amount),
      settledAt: dateOnly(s.settledAt),
      method: s.method,
      account: s.account,
      notes: s.notes,
      reversedAt: s.reversedAt,
      reversalReason: s.reversalReason,
      createdAt: s.createdAt,
      payableId: s.payableId,
      receivableId: s.receivableId,
    };
  }
}

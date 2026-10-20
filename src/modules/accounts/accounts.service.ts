import { Injectable } from '@nestjs/common';
import { Prisma, type FinancialAccount } from '@prisma/client';
import { ErrorCode, badRequest, businessRule, conflict, notFound } from '../../common/errors';
import { dateOnly, money } from '../../common/serialize';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { firstOfMonth, formatDate, fromCents, parseDate, toCents, today } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LedgerService } from '../transactions/ledger.service';
import { PeriodLockService } from '../transactions/period-lock.service';
import type { AdjustmentDto, CreateAccountDto, CreateTransferDto, ListAccountsQueryDto, ListTransfersQueryDto, ReverseDto, StatementQueryDto, UpdateAccountDto } from './accounts.dto';

type AccountRow = Pick<FinancialAccount, 'id' | 'name' | 'type' | 'bankName' | 'openingBalance' | 'openingBalanceDate' | 'status'>;
const FIELDS = { id: true, name: true, type: true, bankName: true, openingBalance: true, openingBalanceDate: true, status: true } satisfies Prisma.FinancialAccountSelect;

const TRANSFER_INCLUDE = { fromAccount: { select: { name: true } }, toAccount: { select: { name: true } } } satisfies Prisma.FinancialTransferInclude;
type TransferRow = Prisma.FinancialTransferGetPayload<{ include: typeof TRANSFER_INCLUDE }>;

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly periods: PeriodLockService,
  ) {}

  // -------------------------------------------------------------------------
  // Contas
  // -------------------------------------------------------------------------

  async list(ctx: TenantContext, q: ListAccountsQueryDto) {
    const accounts = await this.prisma.financialAccount.findMany({
      where: { companyId: ctx.companyId, status: q.includeInactive ? undefined : 'ACTIVE' },
      select: FIELDS,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    const balances = await this.ledger.balances(ctx.companyId, { accountIds: accounts.map((a) => a.id) });
    const items = accounts.map((a) => this.toDto(a, balances.get(a.id) ?? 0));
    const total = accounts.filter((a) => a.status === 'ACTIVE').reduce((acc, a) => acc + (balances.get(a.id) ?? 0), 0);
    return { items, totalBalance: fromCents(total) };
  }

  async get(ctx: TenantContext, id: string) {
    const account = await this.findOrThrow(this.prisma, ctx.companyId, id);
    return this.toDto(account, await this.ledger.balanceOf(ctx.companyId, id));
  }

  async create(ctx: TenantContext, dto: CreateAccountDto, meta: RequestMeta) {
    const openingDate = parseDate(dto.openingBalanceDate);
    this.assertNotFuture(openingDate, 'A data do saldo inicial não pode ser futura');
    const openingCents = toCents(dto.openingBalance);
    return this.prisma.$transaction(async (tx) => {
      await this.periods.assertOpen(ctx.companyId, openingDate, tx);
      await this.assertNameFree(tx, ctx.companyId, dto.name);
      const account = await tx.financialAccount.create({
        data: {
          companyId: ctx.companyId,
          name: dto.name,
          type: dto.type,
          bankName: dto.bankName ?? null,
          openingBalance: dto.openingBalance,
          openingBalanceDate: openingDate,
        },
        select: FIELDS,
      });
      if (openingCents !== 0) {
        await this.ledger.record(tx, {
          companyId: ctx.companyId,
          accountId: account.id,
          kind: 'OPENING_BALANCE',
          direction: openingCents > 0 ? 'IN' : 'OUT',
          amountCents: Math.abs(openingCents),
          occurredAt: openingDate,
          description: 'Saldo inicial',
          createdById: ctx.userId,
        });
      }
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'account.created', entityType: 'FinancialAccount', entityId: account.id, after: account, meta }, tx);
      return this.toDto(account, openingCents);
    });
  }

  async update(ctx: TenantContext, id: string, dto: UpdateAccountDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findOrThrow(tx, ctx.companyId, id, true);
      if (dto.name && dto.name !== before.name) await this.assertNameFree(tx, ctx.companyId, dto.name);

      const changesOpening = dto.openingBalance !== undefined || dto.openingBalanceDate !== undefined;
      const newDate = dto.openingBalanceDate ? parseDate(dto.openingBalanceDate) : before.openingBalanceDate;
      const newCents = dto.openingBalance !== undefined ? toCents(dto.openingBalance) : toCents(before.openingBalance);
      if (changesOpening) {
        this.assertNotFuture(newDate, 'A data do saldo inicial não pode ser futura');
        await this.periods.assertOpen(ctx.companyId, [before.openingBalanceDate, newDate], tx);
        await this.rewriteOpeningBalance(tx, ctx, id, newCents, newDate);
      }

      if (dto.status === 'INACTIVE' && before.status === 'ACTIVE') {
        const balance = await this.ledger.balanceOf(ctx.companyId, id, {}, tx);
        if (balance !== 0) throw businessRule('Transfira o saldo para outra conta antes de desativar esta conta.');
      }

      const after = await tx.financialAccount.update({
        where: { id },
        data: {
          name: dto.name,
          type: dto.type,
          bankName: dto.bankName,
          status: dto.status,
          openingBalance: changesOpening ? fromCents(newCents) : undefined,
          openingBalanceDate: changesOpening ? newDate : undefined,
        },
        select: FIELDS,
      });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'account.updated', entityType: 'FinancialAccount', entityId: id, before, after, meta }, tx);
      return this.toDto(after, await this.ledger.balanceOf(ctx.companyId, id, {}, tx));
    });
  }

  /**
   * O saldo inicial é o único lançamento do razão que pode ser corrigido no
   * lugar (o trigger do banco só permite isso para OPENING_BALANCE).
   */
  private async rewriteOpeningBalance(tx: Tx, ctx: TenantContext, accountId: string, cents: number, date: Date) {
    const existing = await tx.accountTransaction.findFirst({ where: { companyId: ctx.companyId, accountId, kind: 'OPENING_BALANCE' } });
    if (!existing) {
      if (cents === 0) return;
      await this.ledger.record(tx, {
        companyId: ctx.companyId,
        accountId,
        kind: 'OPENING_BALANCE',
        direction: cents > 0 ? 'IN' : 'OUT',
        amountCents: Math.abs(cents),
        occurredAt: date,
        description: 'Saldo inicial',
        createdById: ctx.userId,
      });
      return;
    }
    if (cents === 0) throw businessRule('O saldo inicial já foi lançado e não pode ser zerado. Registre um ajuste de saldo.');
    await tx.accountTransaction.update({
      where: { id: existing.id },
      data: { amount: fromCents(Math.abs(cents)), direction: cents > 0 ? 'IN' : 'OUT', occurredAt: date },
    });
  }

  async statement(ctx: TenantContext, id: string, q: StatementQueryDto) {
    const account = await this.findOrThrow(this.prisma, ctx.companyId, id);
    const to = q.to ? parseDate(q.to) : today();
    const from = q.from ? parseDate(q.from) : firstOfMonth(to);
    if (from > to) throw badRequest('A data inicial deve ser anterior à final');

    const [opening, rows, current] = await Promise.all([
      this.ledger.balanceOf(ctx.companyId, id, { before: from }),
      this.prisma.accountTransaction.findMany({
        where: { companyId: ctx.companyId, accountId: id, occurredAt: { gte: from, lte: to } },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
        include: { reversedBy: { select: { id: true } } },
        take: 2000,
      }),
      this.ledger.balanceOf(ctx.companyId, id),
    ]);
    let running = opening;
    let totalIn = 0;
    let totalOut = 0;
    const entries = rows.map((t) => {
      const cents = toCents(t.amount);
      if (t.direction === 'IN') {
        running += cents;
        totalIn += cents;
      } else {
        running -= cents;
        totalOut += cents;
      }
      return this.entryDto(t, running);
    });
    return {
      account: this.toDto(account, current),
      from: formatDate(from),
      to: formatDate(to),
      openingBalance: fromCents(opening),
      closingBalance: fromCents(running),
      totalIn: fromCents(totalIn),
      totalOut: fromCents(totalOut),
      entries,
    };
  }

  /** Ajuste manual: permissão própria (accounts:adjust), justificativa obrigatória e auditoria. Não entra no resultado operacional. */
  async adjust(ctx: TenantContext, id: string, dto: AdjustmentDto, meta: RequestMeta) {
    const occurredAt = parseDate(dto.occurredAt);
    this.assertNotFuture(occurredAt, 'A data do ajuste não pode ser futura');
    return this.prisma.$transaction(async (tx) => {
      await this.findActiveOrThrow(tx, ctx.companyId, id);
      await this.periods.assertOpen(ctx.companyId, occurredAt, tx);
      const entry = await this.ledger.record(tx, {
        companyId: ctx.companyId,
        accountId: id,
        kind: 'ADJUSTMENT',
        direction: dto.direction,
        amountCents: toCents(dto.amount),
        occurredAt,
        description: dto.direction === 'IN' ? 'Ajuste de saldo (entrada)' : 'Ajuste de saldo (saída)',
        reason: dto.reason,
        createdById: ctx.userId,
      });
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'account.adjusted', entityType: 'AccountTransaction', entityId: entry.id, after: entry, reason: dto.reason, meta },
        tx,
      );
      const balance = await this.ledger.balanceOf(ctx.companyId, id, {}, tx);
      return { entry: this.entryDto({ ...entry, reversedBy: null }, balance), balance: fromCents(balance) };
    });
  }

  // -------------------------------------------------------------------------
  // Transferências
  // -------------------------------------------------------------------------

  async listTransfers(ctx: TenantContext, q: ListTransfersQueryDto) {
    const to = q.to ? parseDate(q.to) : today();
    const from = q.from ? parseDate(q.from) : firstOfMonth(to);
    const rows = await this.prisma.financialTransfer.findMany({
      where: { companyId: ctx.companyId, transferredAt: { gte: from, lte: to } },
      include: TRANSFER_INCLUDE,
      orderBy: [{ transferredAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return rows.map((t) => this.transferDto(t));
  }

  /**
   * Transferência = 1 FinancialTransfer + 2 lançamentos (OUT na origem, IN no
   * destino) na mesma transação. Não é receita nem despesa. Idempotente pela
   * chave do cliente: repetir a chave devolve a transferência já criada.
   */
  async transfer(ctx: TenantContext, dto: CreateTransferDto, meta: RequestMeta) {
    if (dto.fromAccountId === dto.toAccountId) throw badRequest('Escolha contas diferentes para origem e destino');
    const date = parseDate(dto.transferredAt);
    this.assertNotFuture(date, 'A data da transferência não pode ser futura');
    const cents = toCents(dto.amount);

    const existing = await this.findTransferByKey(ctx.companyId, dto.idempotencyKey);
    if (existing) return this.replayTransfer(existing, dto, cents, date);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const [from, to] = await Promise.all([
          this.findActiveOrThrow(tx, ctx.companyId, dto.fromAccountId),
          this.findActiveOrThrow(tx, ctx.companyId, dto.toAccountId),
        ]);
        await this.periods.assertOpen(ctx.companyId, date, tx);
        const transfer = await tx.financialTransfer.create({
          data: {
            companyId: ctx.companyId,
            fromAccountId: from.id,
            toAccountId: to.id,
            amount: fromCents(cents),
            transferredAt: date,
            description: dto.description ?? null,
            idempotencyKey: dto.idempotencyKey,
            createdById: ctx.userId,
          },
          include: TRANSFER_INCLUDE,
        });
        const label = dto.description ? ` (${dto.description})` : '';
        await this.ledger.record(tx, {
          companyId: ctx.companyId,
          accountId: from.id,
          kind: 'TRANSFER',
          direction: 'OUT',
          amountCents: cents,
          occurredAt: date,
          description: `Transferência para ${to.name}${label}`.slice(0, 200),
          transferId: transfer.id,
          createdById: ctx.userId,
        });
        await this.ledger.record(tx, {
          companyId: ctx.companyId,
          accountId: to.id,
          kind: 'TRANSFER',
          direction: 'IN',
          amountCents: cents,
          occurredAt: date,
          description: `Transferência de ${from.name}${label}`.slice(0, 200),
          transferId: transfer.id,
          createdById: ctx.userId,
        });
        const dtoOut = this.transferDto(transfer);
        await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'transfer.created', entityType: 'FinancialTransfer', entityId: transfer.id, after: dtoOut, meta }, tx);
        return dtoOut;
      });
    } catch (err) {
      // Duas requisições simultâneas com a mesma chave: a segunda perde na unicidade e devolve a primeira.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findTransferByKey(ctx.companyId, dto.idempotencyKey);
        if (winner) return this.replayTransfer(winner, dto, cents, date);
      }
      throw err;
    }
  }

  async reverseTransfer(ctx: TenantContext, id: string, dto: ReverseDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM financial_transfers WHERE id = ${id}::uuid AND "companyId" = ${ctx.companyId}::uuid FOR UPDATE`;
      const transfer = await tx.financialTransfer.findFirst({ where: { id, companyId: ctx.companyId }, include: { ...TRANSFER_INCLUDE, transactions: true } });
      if (!transfer) throw notFound('Transferência não encontrada');
      if (transfer.reversedAt) throw conflict('Esta transferência já foi estornada');
      const when = today();
      await this.periods.assertOpen(ctx.companyId, when, tx);
      for (const t of transfer.transactions.filter((x) => x.kind === 'TRANSFER')) {
        await this.ledger.reverse(tx, t, when, dto.reason, ctx.userId);
      }
      const updated = await tx.financialTransfer.update({ where: { id }, data: { reversedAt: new Date() }, include: TRANSFER_INCLUDE });
      const out = this.transferDto(updated);
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'transfer.reversed', entityType: 'FinancialTransfer', entityId: id, after: out, reason: dto.reason, meta }, tx);
      return out;
    });
  }

  // -------------------------------------------------------------------------
  // Apoio
  // -------------------------------------------------------------------------

  /** Conta da empresa e ativa — usada por liquidações e transferências. */
  async findActiveOrThrow(tx: Tx, companyId: string, id: string): Promise<AccountRow> {
    const account = await this.findOrThrow(tx, companyId, id);
    if (account.status !== 'ACTIVE') throw businessRule(`A conta ${account.name} está desativada`);
    return account;
  }

  private async findOrThrow(client: Tx | PrismaService, companyId: string, id: string, lock = false): Promise<AccountRow> {
    if (lock) await client.$queryRaw`SELECT id FROM financial_accounts WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
    const account = await client.financialAccount.findFirst({ where: { id, companyId }, select: FIELDS });
    if (!account) throw notFound('Conta financeira não encontrada');
    return account;
  }

  private async assertNameFree(tx: Tx, companyId: string, name: string) {
    const existing = await tx.financialAccount.findFirst({ where: { companyId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (existing) throw conflict('Já existe uma conta com este nome');
  }

  private assertNotFuture(date: Date, message: string) {
    if (date > today()) throw badRequest(message);
  }

  private findTransferByKey(companyId: string, key: string) {
    return this.prisma.financialTransfer.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey: key } }, include: TRANSFER_INCLUDE });
  }

  private replayTransfer(existing: TransferRow, dto: CreateTransferDto, cents: number, date: Date) {
    const same =
      existing.fromAccountId === dto.fromAccountId &&
      existing.toAccountId === dto.toAccountId &&
      toCents(existing.amount) === cents &&
      existing.transferredAt.getTime() === date.getTime();
    if (!same) throw conflict('Esta chave de idempotência já foi usada em outra transferência', ErrorCode.IDEMPOTENCY_CONFLICT);
    return this.transferDto(existing);
  }

  toDto(a: AccountRow, balanceCents: number) {
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      bankName: a.bankName,
      openingBalance: money(a.openingBalance),
      openingBalanceDate: dateOnly(a.openingBalanceDate),
      status: a.status,
      balance: fromCents(balanceCents),
    };
  }

  private entryDto(
    t: { id: string; occurredAt: Date; kind: string; direction: 'IN' | 'OUT'; amount: Prisma.Decimal; description: string; reason: string | null; settlementId: string | null; transferId: string | null; reversedBy: { id: string } | null },
    balanceAfterCents: number,
  ) {
    return {
      id: t.id,
      occurredAt: dateOnly(t.occurredAt),
      kind: t.kind as 'OPENING_BALANCE' | 'SETTLEMENT' | 'TRANSFER' | 'ADJUSTMENT' | 'REVERSAL',
      direction: t.direction,
      amount: money(t.amount),
      description: t.description,
      reason: t.reason,
      balanceAfter: fromCents(balanceAfterCents),
      settlementId: t.settlementId,
      transferId: t.transferId,
      reversed: !!t.reversedBy,
    };
  }

  private transferDto(t: TransferRow) {
    return {
      id: t.id,
      fromAccountId: t.fromAccountId,
      fromAccountName: t.fromAccount.name,
      toAccountId: t.toAccountId,
      toAccountName: t.toAccount.name,
      amount: money(t.amount),
      transferredAt: dateOnly(t.transferredAt),
      description: t.description,
      reversedAt: t.reversedAt,
      createdAt: t.createdAt,
    };
  }
}

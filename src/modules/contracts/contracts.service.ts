import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { badRequest, businessRule, conflict, notFound } from '../../common/errors';
import { dateOnly, money, month } from '../../common/serialize';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { firstOfMonth, isValidDocument, parseDate, toCents, today } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CategoriesService } from '../categories/categories.service';
import { assertVehiclesUsable } from '../obligations/allocation';
import { ContractBillingService } from './contract-billing.service';
import type {
  ContractStatusDto,
  ContractVehicleInputDto,
  CreateContractDto,
  CreateContractorDto,
  ListContractsQueryDto,
  UpdateContractDto,
  UpdateContractorDto,
} from './contracts.dto';

const INCLUDE = {
  contractor: { select: { id: true, name: true } },
  revenueCategory: { select: { id: true, name: true } },
  vehicles: { include: { vehicle: { select: { id: true, name: true, plate: true } } }, orderBy: { createdAt: 'asc' } },
  routes: { include: { route: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ContractInclude;
type ContractRow = Prisma.ContractGetPayload<{ include: typeof INCLUDE }>;

/** Contratantes e contratos; a geração mensal das contas a receber fica no ContractBillingService. */
@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
    private readonly billing: ContractBillingService,
  ) {}

  // ---------------------------------------------------------------- contratantes

  async listContractors(ctx: TenantContext) {
    const rows = await this.prisma.contractor.findMany({
      where: { companyId: ctx.companyId },
      include: { _count: { select: { contracts: { where: { status: 'ACTIVE' } } } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return rows.map(({ _count, companyId: _c, createdAt: _a, updatedAt: _u, personType: _p, ...c }) => ({ ...c, activeContracts: _count.contracts }));
  }

  async createContractor(ctx: TenantContext, dto: CreateContractorDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const personType = this.personTypeOf(dto.document);
      if (dto.document) await this.assertContractorDocFree(tx, ctx.companyId, dto.document);
      const c = await tx.contractor.create({ data: { ...dto, personType, companyId: ctx.companyId } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'contractor.created', entityType: 'Contractor', entityId: c.id, after: dto, meta }, tx);
      return { id: c.id, name: c.name, kind: c.kind, document: c.document, email: c.email, phone: c.phone, status: c.status, activeContracts: 0 };
    });
  }

  async updateContractor(ctx: TenantContext, id: string, dto: UpdateContractorDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.contractor.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!before) throw notFound('Contratante não encontrado');
      if (dto.document && dto.document !== before.document) await this.assertContractorDocFree(tx, ctx.companyId, dto.document);
      const personType = dto.document !== undefined ? this.personTypeOf(dto.document) : undefined;
      const c = await tx.contractor.update({ where: { id }, data: { ...dto, personType }, include: { _count: { select: { contracts: { where: { status: 'ACTIVE' } } } } } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'contractor.updated', entityType: 'Contractor', entityId: id, before, after: dto, meta }, tx);
      return { id: c.id, name: c.name, kind: c.kind, document: c.document, email: c.email, phone: c.phone, status: c.status, activeContracts: c._count.contracts };
    });
  }

  async removeContractor(ctx: TenantContext, id: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.contractor.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!c) throw notFound('Contratante não encontrado');
      if (await tx.contract.count({ where: { companyId: ctx.companyId, contractorId: id } })) throw conflict('Este contratante tem contratos. Marque como inativo em vez de excluir.');
      await tx.contractor.delete({ where: { id } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'contractor.deleted', entityType: 'Contractor', entityId: id, before: c, meta }, tx);
    });
  }

  private personTypeOf(document: string | null | undefined) {
    if (!document) return null;
    const type = document.length === 11 ? 'INDIVIDUAL' : 'COMPANY';
    if (!isValidDocument(type, document)) throw badRequest(type === 'INDIVIDUAL' ? 'CPF inválido' : 'CNPJ inválido');
    return type;
  }

  private async assertContractorDocFree(tx: Tx, companyId: string, document: string) {
    if (await tx.contractor.findFirst({ where: { companyId, document }, select: { id: true } })) throw conflict('Já existe um contratante com este documento');
  }

  // ---------------------------------------------------------------- contratos

  async list(ctx: TenantContext, q: ListContractsQueryDto) {
    const rows = await this.prisma.contract.findMany({
      where: { companyId: ctx.companyId, status: q.status, contractorId: q.contractorId },
      include: INCLUDE,
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
    });
    return rows.map((c) => this.toDto(c));
  }

  async get(ctx: TenantContext, id: string) {
    await this.billing.generateDue(ctx.companyId, ctx.userId, { contractId: id });
    const c = await this.prisma.contract.findFirst({ where: { id, companyId: ctx.companyId }, include: INCLUDE });
    if (!c) throw notFound('Contrato não encontrado');
    const receivables = await this.prisma.receivable.findMany({
      where: { companyId: ctx.companyId, contractId: id },
      orderBy: { competence: 'desc' },
      take: 36,
      select: { id: true, competence: true, dueDate: true, amount: true, receivedAmount: true, status: true },
    });
    return {
      ...this.toDto(c),
      receivables: receivables.map((r) => ({ id: r.id, competence: month(r.competence), dueDate: dateOnly(r.dueDate), amount: money(r.amount), receivedAmount: money(r.receivedAmount), status: r.status })),
    };
  }

  async create(ctx: TenantContext, dto: CreateContractDto, meta: RequestMeta) {
    const startDate = parseDate(dto.startDate);
    const endDate = dto.endDate ? parseDate(dto.endDate) : null;
    this.assertPeriod(dto.billingType ?? 'MONTHLY', startDate, endDate);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertRefs(tx, ctx.companyId, dto);
        const c = await tx.contract.create({
          data: {
            companyId: ctx.companyId,
            contractorId: dto.contractorId,
            number: dto.number ?? null,
            description: dto.description ?? null,
            billingType: dto.billingType ?? 'MONTHLY',
            amount: dto.amount,
            startDate,
            endDate,
            dueDay: dto.dueDay ?? 10,
            dueMonthOffset: dto.dueMonthOffset ?? 1,
            revenueCategoryId: dto.revenueCategoryId ?? null,
            status: 'DRAFT',
          },
        });
        await this.writeLinks(tx, ctx.companyId, c.id, dto.vehicles, dto.routeIds);
        await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'contract.created', entityType: 'Contract', entityId: c.id, after: dto, meta }, tx);
        return this.toDto(await tx.contract.findUniqueOrThrow({ where: { id: c.id }, include: INCLUDE }));
      });
    } catch (e) {
      throw this.uniqueNumber(e);
    }
  }

  /** Mudanças valem para as competências ainda não geradas; o que já foi gerado não muda. */
  async update(ctx: TenantContext, id: string, dto: UpdateContractDto, meta: RequestMeta) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await this.findOrThrow(tx, ctx.companyId, id);
        if (before.status === 'ENDED' || before.status === 'CANCELED') throw businessRule('Contrato encerrado ou cancelado não pode ser alterado');
        if (before.status !== 'DRAFT' && (dto.billingType !== undefined && dto.billingType !== before.billingType)) throw businessRule('O tipo de cobrança só muda enquanto o contrato é rascunho');
        if (before.status !== 'DRAFT' && dto.startDate !== undefined && dto.startDate !== dateOnly(before.startDate)) throw businessRule('O início só muda enquanto o contrato é rascunho');
        if (before.status !== 'DRAFT' && dto.contractorId !== undefined && dto.contractorId !== before.contractorId) throw businessRule('O contratante só muda enquanto o contrato é rascunho');
        const startDate = dto.startDate ? parseDate(dto.startDate) : before.startDate;
        const endDate = dto.endDate !== undefined ? (dto.endDate ? parseDate(dto.endDate) : null) : before.endDate;
        this.assertPeriod(dto.billingType ?? before.billingType, startDate, endDate);
        await this.assertRefs(tx, ctx.companyId, { ...dto, contractorId: dto.contractorId ?? before.contractorId });
        await tx.contract.update({
          where: { id },
          data: {
            contractorId: dto.contractorId,
            number: dto.number,
            description: dto.description,
            billingType: dto.billingType,
            amount: dto.amount,
            startDate,
            endDate,
            dueDay: dto.dueDay,
            dueMonthOffset: dto.dueMonthOffset,
            revenueCategoryId: dto.revenueCategoryId,
          },
        });
        await this.writeLinks(tx, ctx.companyId, id, dto.vehicles, dto.routeIds);
        await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'contract.updated', entityType: 'Contract', entityId: id, before: this.toDto(before), after: dto, meta }, tx);
        if (before.status === 'ACTIVE') await this.billing.generateDue(ctx.companyId, ctx.userId, { contractId: id, tx });
        return this.toDto(await tx.contract.findUniqueOrThrow({ where: { id }, include: INCLUDE }));
      });
    } catch (e) {
      throw this.uniqueNumber(e);
    }
  }

  async changeStatus(ctx: TenantContext, id: string, dto: ContractStatusDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findOrThrow(tx, ctx.companyId, id);
      const allowed: Record<string, string[]> = {
        DRAFT: ['ACTIVE', 'CANCELED'],
        ACTIVE: ['SUSPENDED', 'ENDED', 'CANCELED'],
        SUSPENDED: ['ACTIVE', 'ENDED', 'CANCELED'],
        ENDED: [],
        CANCELED: [],
      };
      if (!allowed[before.status].includes(dto.status)) throw businessRule(`Não é possível passar de ${before.status} para ${dto.status}`);
      if (dto.status === 'ACTIVE' && before.billingType !== 'VARIABLE' && toCents(before.amount) <= 0) throw businessRule('Informe o valor mensal antes de ativar');

      let endDate = before.endDate;
      let canceledIds: string[] = [];
      if (dto.status === 'ENDED' || dto.status === 'CANCELED') {
        endDate = dto.status === 'ENDED' ? (dto.endDate ? parseDate(dto.endDate) : today()) : before.endDate;
        if (endDate && endDate < before.startDate) throw badRequest('O fim deve ser depois do início');
        // Contas futuras ainda sem recebimento deixam de valer.
        const cutoff = dto.status === 'ENDED' ? firstOfMonth(endDate!) : new Date(Date.UTC(1900, 0, 1));
        const open = await tx.receivable.findMany({
          where: { companyId: ctx.companyId, contractId: id, status: 'PENDING', competence: { gt: cutoff } },
          select: { id: true, competence: true },
        });
        const closed = await tx.monthlyClosing.findMany({ where: { companyId: ctx.companyId, status: 'CLOSED' }, select: { year: true, month: true } });
        const closedSet = new Set(closed.map((c) => `${c.year}-${String(c.month).padStart(2, '0')}`));
        canceledIds = open.filter((r) => !closedSet.has(month(r.competence))).map((r) => r.id);
        if (canceledIds.length) {
          await tx.receivable.updateMany({
            where: { id: { in: canceledIds } },
            data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: dto.reason ?? (dto.status === 'ENDED' ? 'Contrato encerrado' : 'Contrato cancelado') },
          });
        }
      }
      await tx.contract.update({ where: { id }, data: { status: dto.status, endDate } });
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'contract.status_changed', entityType: 'Contract', entityId: id, before: { status: before.status }, after: { status: dto.status, endDate: dateOnly(endDate), canceledReceivables: canceledIds }, reason: dto.reason, meta },
        tx,
      );
      if (dto.status === 'ACTIVE') await this.billing.generateDue(ctx.companyId, ctx.userId, { contractId: id, tx });
      return this.toDto(await tx.contract.findUniqueOrThrow({ where: { id }, include: INCLUDE }));
    });
  }

  // ---------------------------------------------------------------- apoio

  private assertPeriod(billingType: string, start: Date, end: Date | null) {
    if (end && end < start) throw badRequest('O fim deve ser depois do início');
    if (billingType === 'FIXED_PERIOD' && !end) throw badRequest('Contrato por período precisa da data de fim');
  }

  private async assertRefs(tx: Tx, companyId: string, dto: Partial<CreateContractDto>) {
    if (dto.contractorId) {
      const c = await tx.contractor.findFirst({ where: { id: dto.contractorId, companyId }, select: { status: true } });
      if (!c) throw notFound('Contratante não encontrado');
    }
    if (dto.revenueCategoryId) await this.categories.assertUsable(tx, companyId, dto.revenueCategoryId, 'INCOME');
    if (dto.vehicles?.length) {
      const ids = dto.vehicles.map((v) => v.vehicleId);
      if (new Set(ids).size !== ids.length) throw badRequest('Cada veículo só pode aparecer uma vez');
      await assertVehiclesUsable(tx, companyId, ids);
      this.assertShares(dto.vehicles);
    }
    if (dto.routeIds?.length) {
      const found = await tx.route.count({ where: { companyId, id: { in: dto.routeIds } } });
      if (found !== new Set(dto.routeIds).size) throw notFound('Rota não encontrada');
    }
  }

  /** Participações: todas vazias (partes iguais) ou todas preenchidas somando 100. */
  private assertShares(vehicles: ContractVehicleInputDto[]) {
    const filled = vehicles.filter((v) => v.sharePercent);
    if (filled.length === 0) return;
    if (filled.length !== vehicles.length) throw badRequest('Informe a participação de todos os veículos ou de nenhum');
    const total = vehicles.reduce((acc, v) => {
      const [int, dec = ''] = v.sharePercent!.split('.');
      return acc + Number(int) * 10_000 + Number(dec.padEnd(4, '0'));
    }, 0);
    if (total !== 1_000_000) throw badRequest('As participações dos veículos devem somar 100%');
  }

  private async writeLinks(tx: Tx, companyId: string, contractId: string, vehicles?: ContractVehicleInputDto[], routeIds?: string[]) {
    if (vehicles !== undefined) {
      await tx.contractVehicle.deleteMany({ where: { companyId, contractId } });
      if (vehicles.length) await tx.contractVehicle.createMany({ data: vehicles.map((v) => ({ companyId, contractId, vehicleId: v.vehicleId, sharePercent: v.sharePercent ?? null })) });
    }
    if (routeIds !== undefined) {
      await tx.contractRoute.deleteMany({ where: { companyId, contractId } });
      if (routeIds.length) await tx.contractRoute.createMany({ data: [...new Set(routeIds)].map((routeId) => ({ companyId, contractId, routeId })) });
    }
  }

  private async findOrThrow(tx: Tx, companyId: string, id: string) {
    const c = await tx.contract.findFirst({ where: { id, companyId }, include: INCLUDE });
    if (!c) throw notFound('Contrato não encontrado');
    return c;
  }

  private uniqueNumber(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return conflict('Já existe um contrato com este número');
    return e;
  }

  private toDto(c: ContractRow) {
    return {
      id: c.id,
      contractor: c.contractor,
      number: c.number,
      description: c.description,
      billingType: c.billingType,
      amount: money(c.amount),
      startDate: dateOnly(c.startDate),
      endDate: dateOnly(c.endDate),
      dueDay: c.dueDay,
      dueMonthOffset: c.dueMonthOffset,
      revenueCategory: c.revenueCategory,
      status: c.status,
      vehicles: c.vehicles.map((v) => ({ vehicle: v.vehicle, sharePercent: v.sharePercent ? v.sharePercent.toFixed(4).replace(/\.?0+$/, '') : null })),
      routes: c.routes.map((r) => r.route),
    };
  }
}

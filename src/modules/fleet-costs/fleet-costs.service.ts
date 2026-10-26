import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { badRequest, businessRule, forbidden, notFound } from '../../common/errors';
import { dateOnly, money } from '../../common/serialize';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import {
  costPerKm,
  firstOfMonth,
  formatMonth,
  fromCents,
  fromKmTenths,
  fromMilliliters,
  fuelAmountCents,
  kmPerLiter,
  lastOfMonth,
  parseDate,
  parseMonth,
  toCents,
  toKmTenths,
  toMilliliters,
  toRateUnits,
  today,
} from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CategoriesService } from '../categories/categories.service';
import { activeOn, FleetService } from '../fleet/fleet.service';
import { writeAllocations } from '../obligations/allocation';
import type { SettleNowDto } from '../obligations/obligations.dto';
import { attachmentDto } from '../attachments/attachment-dto';
import { LIST_INCLUDE, PayablesService } from '../payables/payables.service';
import { SettlementsService } from '../settlements/settlements.service';
import { PeriodLockService } from '../transactions/period-lock.service';
import type {
  CancelCostDto,
  CostSummaryQueryDto,
  CreateDriverExpenseDto,
  CreateFuelingDto,
  CreateMaintenanceDto,
  FuelInputDto,
  ListExpenseApprovalsQueryDto,
  ListFuelingsQueryDto,
  ListMaintenancesQueryDto,
  RejectExpenseDto,
} from './fleet-costs.dto';

const VEHICLE_REF = { select: { id: true, name: true, plate: true } } as const;
const PAYABLE_REF = { select: { id: true, status: true, approvalStatus: true, paidAmount: true, dueDate: true } } as const;

const MAINTENANCE_INCLUDE = { vehicle: VEHICLE_REF, payable: PAYABLE_REF } satisfies Prisma.MaintenanceInclude;
type MaintenanceRow = Prisma.MaintenanceGetPayload<{ include: typeof MAINTENANCE_INCLUDE }>;

const FUEL_INCLUDE = {
  vehicle: VEHICLE_REF,
  payable: { select: { ...PAYABLE_REF.select, amount: true, driver: { select: { id: true, name: true } } } },
} satisfies Prisma.FuelExpenseDetailInclude;
type FuelRow = Prisma.FuelExpenseDetailGetPayload<{ include: typeof FUEL_INCLUDE }>;

const EXPENSE_INCLUDE = {
  ...LIST_INCLUDE,
  driver: { select: { id: true, name: true } },
  fuelDetail: { include: { vehicle: VEHICLE_REF } },
  attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.PayableInclude;
type ExpenseRow = Prisma.PayableGetPayload<{ include: typeof EXPENSE_INCLUDE }>;

interface CostPayableInput {
  description: string;
  categoryId: string;
  vehicleId: string | null;
  amountCents: number;
  date: Date;
  dueDate: Date;
  supplierName: string | null;
  notes: string | null;
  driverId: string | null;
  approvalStatus: 'APPROVED' | 'PENDING_APPROVAL';
}

const MAINTENANCE_LABEL: Record<string, string> = {
  PREVENTIVE: 'Manutenção preventiva',
  CORRECTIVE: 'Manutenção corretiva',
  OIL_CHANGE: 'Troca de óleo',
  TIRES: 'Pneus',
  MECHANICAL: 'Mecânica',
  ELECTRICAL: 'Elétrica',
  OTHER: 'Manutenção',
};

/**
 * Custos da frota: manutenção e abastecimento viram contas a pagar ligadas ao
 * veículo (alocação direta), na mesma transação. Despesas enviadas pelo
 * motorista entram como PENDING_APPROVAL e ficam fora de saldos, DRE e
 * pagamento até alguém com expenses:approve aprovar.
 */
@Injectable()
export class FleetCostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
    private readonly fleet: FleetService,
    private readonly payables: PayablesService,
    private readonly settlements: SettlementsService,
    private readonly periods: PeriodLockService,
  ) {}

  // -------------------------------------------------------------------------
  // Manutenção
  // -------------------------------------------------------------------------

  async listMaintenances(ctx: TenantContext, q: ListMaintenancesQueryDto) {
    const where: Prisma.MaintenanceWhereInput = { companyId: ctx.companyId };
    if (q.vehicleId) where.vehicleId = q.vehicleId;
    if (q.month) {
      const m = parseMonth(q.month);
      where.date = { gte: m, lte: lastOfMonth(m) };
    }
    const [items, total, sum] = await Promise.all([
      this.prisma.maintenance.findMany({ where, include: MAINTENANCE_INCLUDE, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.maintenance.count({ where }),
      this.prisma.maintenance.aggregate({ where: { AND: [where, { OR: [{ payableId: null }, { payable: { status: { not: 'CANCELED' } } }] }] }, _sum: { amount: true } }),
    ]);
    return { items: items.map((m) => this.maintenanceDto(m)), total, page: q.page, pageSize: q.pageSize, amount: money(sum._sum.amount ?? new Prisma.Decimal(0)) };
  }

  async createMaintenance(ctx: TenantContext, dto: CreateMaintenanceDto, meta: RequestMeta) {
    const date = parseDate(dto.date);
    if (date > today()) throw badRequest('A data do serviço não pode ser futura');
    const amountCents = toCents(dto.amount);
    const id = await this.prisma.$transaction(async (tx) => {
      const vehicle = await this.usableVehicle(tx, ctx.companyId, dto.vehicleId);
      const category = dto.categoryId
        ? await this.categories.assertUsable(tx, ctx.companyId, dto.categoryId, 'EXPENSE')
        : await this.categories.bySystemKey(tx, ctx.companyId, dto.type === 'TIRES' ? 'TIRES' : 'MAINTENANCE');
      const payableId = await this.createCostPayable(tx, ctx, {
        description: `${MAINTENANCE_LABEL[dto.type]} — ${vehicle.name}: ${dto.description}`,
        categoryId: category.id,
        vehicleId: vehicle.id,
        amountCents,
        date,
        dueDate: dto.dueDate ? parseDate(dto.dueDate) : date,
        supplierName: dto.supplierName ?? null,
        notes: dto.notes ?? null,
        driverId: null,
        approvalStatus: 'APPROVED',
      });
      const m = await tx.maintenance.create({
        data: {
          companyId: ctx.companyId,
          vehicleId: vehicle.id,
          type: dto.type,
          description: dto.description,
          date,
          amount: fromCents(amountCents),
          odometerKm: dto.odometerKm ?? null,
          supplierName: dto.supplierName ?? null,
          notes: dto.notes ?? null,
          payableId,
        },
      });
      await this.bumpOdometer(tx, vehicle, dto.odometerKm);
      if (dto.settleNow) await this.settle(tx, ctx, payableId, dto.settleNow, meta);
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'maintenance.created', entityType: 'Maintenance', entityId: m.id, after: { ...dto, payableId }, meta }, tx);
      return m.id;
    });
    return this.getMaintenance(ctx, id);
  }

  async getMaintenance(ctx: TenantContext, id: string) {
    const m = await this.prisma.maintenance.findFirst({ where: { id, companyId: ctx.companyId }, include: MAINTENANCE_INCLUDE });
    if (!m) throw notFound('Manutenção não encontrada');
    return this.maintenanceDto(m);
  }

  /** Cancela a conta ligada (exige não ter pagamento ativo). O registro fica no histórico. */
  async cancelMaintenance(ctx: TenantContext, id: string, dto: CancelCostDto, meta: RequestMeta) {
    const m = await this.prisma.maintenance.findFirst({ where: { id, companyId: ctx.companyId }, select: { payableId: true } });
    if (!m) throw notFound('Manutenção não encontrada');
    if (m.payableId) await this.payables.cancel(ctx, m.payableId, { reason: dto.reason }, meta);
    return this.getMaintenance(ctx, id);
  }

  // -------------------------------------------------------------------------
  // Abastecimento
  // -------------------------------------------------------------------------

  async listFuelings(ctx: TenantContext, q: ListFuelingsQueryDto) {
    const where: Prisma.FuelExpenseDetailWhereInput = { companyId: ctx.companyId, payable: { approvalStatus: 'APPROVED' } };
    if (q.vehicleId) where.vehicleId = q.vehicleId;
    if (q.month) {
      const m = parseMonth(q.month);
      where.filledAt = { gte: m, lte: lastOfMonth(m) };
    }
    const active: Prisma.FuelExpenseDetailWhereInput = { AND: [where, { payable: { status: { not: 'CANCELED' } } }] };
    const [items, total, liters, amount] = await Promise.all([
      this.prisma.fuelExpenseDetail.findMany({ where, include: FUEL_INCLUDE, orderBy: [{ filledAt: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.fuelExpenseDetail.count({ where }),
      this.prisma.fuelExpenseDetail.aggregate({ where: active, _sum: { liters: true } }),
      this.prisma.payable.aggregate({ where: { companyId: ctx.companyId, status: { not: 'CANCELED' }, fuelDetail: active }, _sum: { amount: true } }),
    ]);
    return {
      items: items.map((f) => this.fuelingDto(f)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      liters: (liters._sum.liters ?? new Prisma.Decimal(0)).toFixed(3),
      amount: money(amount._sum.amount ?? new Prisma.Decimal(0)),
    };
  }

  async createFueling(ctx: TenantContext, dto: CreateFuelingDto, meta: RequestMeta) {
    const date = parseDate(dto.date);
    if (date > today()) throw badRequest('A data do abastecimento não pode ser futura');
    const amountCents = dto.amount ? toCents(dto.amount) : this.fuelCents(dto);
    if (amountCents <= 0) throw badRequest('O valor do abastecimento deve ser maior que zero');
    const id = await this.prisma.$transaction(async (tx) => {
      const vehicle = await this.usableVehicle(tx, ctx.companyId, dto.vehicleId);
      if (dto.driverId) {
        const d = await tx.driver.findFirst({ where: { id: dto.driverId, companyId: ctx.companyId }, select: { id: true } });
        if (!d) throw notFound('Motorista não encontrado');
      }
      const category = await this.categories.bySystemKey(tx, ctx.companyId, 'FUEL');
      const payableId = await this.createCostPayable(tx, ctx, {
        description: `Abastecimento — ${vehicle.name} (${dto.liters.replace('.', ',')} L)`,
        categoryId: category.id,
        vehicleId: vehicle.id,
        amountCents,
        date,
        dueDate: dto.dueDate ? parseDate(dto.dueDate) : date,
        supplierName: dto.station ?? null,
        notes: dto.notes ?? null,
        driverId: dto.driverId ?? null,
        approvalStatus: 'APPROVED',
      });
      const f = await this.createFuelDetail(tx, ctx.companyId, payableId, vehicle.id, date, dto);
      await this.bumpOdometer(tx, vehicle, dto.odometerKm);
      if (dto.settleNow) await this.settle(tx, ctx, payableId, dto.settleNow, meta);
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'fueling.created', entityType: 'FuelExpenseDetail', entityId: f.id, after: { ...dto, payableId }, meta }, tx);
      return f.id;
    });
    const f = await this.prisma.fuelExpenseDetail.findUniqueOrThrow({ where: { id }, include: FUEL_INCLUDE });
    return this.fuelingDto(f);
  }

  async cancelFueling(ctx: TenantContext, id: string, dto: CancelCostDto, meta: RequestMeta) {
    const f = await this.prisma.fuelExpenseDetail.findFirst({ where: { id, companyId: ctx.companyId }, select: { payableId: true } });
    if (!f) throw notFound('Abastecimento não encontrado');
    await this.payables.cancel(ctx, f.payableId, { reason: dto.reason }, meta);
    const row = await this.prisma.fuelExpenseDetail.findUniqueOrThrow({ where: { id }, include: FUEL_INCLUDE });
    return this.fuelingDto(row);
  }

  // -------------------------------------------------------------------------
  // Resumo por veículo: km, receita do km, combustível, manutenção, km/l, R$/km
  // -------------------------------------------------------------------------

  async summary(ctx: TenantContext, q: CostSummaryQueryDto) {
    const from = parseMonth(q.month);
    const to = lastOfMonth(from);
    const companyId = ctx.companyId;
    const live = { status: { not: 'CANCELED' as const }, approvalStatus: 'APPROVED' as const };
    const [vehicles, logs, fuels, maints] = await Promise.all([
      this.prisma.vehicle.findMany({ where: { companyId }, select: { id: true, name: true, plate: true, archivedAt: true }, orderBy: { name: 'asc' } }),
      this.prisma.vehicleDailyLog.groupBy({ by: ['vehicleId'], where: { companyId, date: { gte: from, lte: to } }, _sum: { kmDriven: true, amount: true } }),
      this.prisma.fuelExpenseDetail.findMany({ where: { companyId, filledAt: { gte: from, lte: to }, payable: live }, select: { vehicleId: true, liters: true, payable: { select: { amount: true } } } }),
      this.prisma.maintenance.findMany({ where: { companyId, date: { gte: from, lte: to }, OR: [{ payableId: null }, { payable: live }] }, select: { vehicleId: true, amount: true } }),
    ]);
    const acc = new Map<string, { km: number; revenue: number; ml: number; fuel: number; maint: number }>();
    const row = (id: string) => {
      let r = acc.get(id);
      if (!r) acc.set(id, (r = { km: 0, revenue: 0, ml: 0, fuel: 0, maint: 0 }));
      return r;
    };
    for (const l of logs) {
      const r = row(l.vehicleId);
      r.km += toKmTenths(l._sum.kmDriven ?? '0');
      r.revenue += toCents(l._sum.amount ?? '0');
    }
    for (const f of fuels) {
      const r = row(f.vehicleId);
      r.ml += toMilliliters(f.liters);
      r.fuel += toCents(f.payable.amount);
    }
    for (const m of maints) row(m.vehicleId).maint += toCents(m.amount);
    return {
      month: formatMonth(from),
      vehicles: vehicles
        .filter((v) => !v.archivedAt || acc.has(v.id))
        .map((v) => {
          const r = acc.get(v.id) ?? { km: 0, revenue: 0, ml: 0, fuel: 0, maint: 0 };
          return {
            vehicle: { id: v.id, name: v.name, plate: v.plate },
            km: fromKmTenths(r.km),
            kmRevenue: fromCents(r.revenue),
            liters: fromMilliliters(r.ml),
            fuelCost: fromCents(r.fuel),
            maintenanceCost: fromCents(r.maint),
            kmPerLiter: kmPerLiter(r.km, r.ml),
            costPerKm: costPerKm(r.fuel + r.maint, r.km),
          };
        }),
    };
  }

  // -------------------------------------------------------------------------
  // Despesas do motorista
  // -------------------------------------------------------------------------

  async myExpenseCategories(ctx: TenantContext) {
    await this.categories.ensureDefaults(ctx.companyId);
    const items = await this.prisma.financialCategory.findMany({
      where: { companyId: ctx.companyId, type: 'EXPENSE', status: 'ACTIVE',
        // Categorias administrativas não fazem sentido para o motorista.
        OR: [{ systemKey: null }, { systemKey: { notIn: ['SALARY', 'ACCOUNTING', 'BANK_FEES', 'TAXES', 'INSURANCE', 'LICENSING'] } }],
      },
      select: { id: true, name: true, type: true, systemKey: true },
      orderBy: [{ systemKey: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    });
    return { items };
  }

  async listMyExpenses(ctx: TenantContext, q: { page: number; pageSize: number }) {
    const driver = await this.requireDriver(ctx);
    const where: Prisma.PayableWhereInput = { companyId: ctx.companyId, driverId: driver.id, createdById: ctx.userId };
    const [items, total] = await Promise.all([
      this.prisma.payable.findMany({ where, include: EXPENSE_INCLUDE, orderBy: [{ competence: 'desc' }, { createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.payable.count({ where }),
    ]);
    return { items: items.map((p) => this.expenseDto(p)), total, page: q.page, pageSize: q.pageSize };
  }

  async createMyExpense(ctx: TenantContext, dto: CreateDriverExpenseDto, meta: RequestMeta) {
    const date = parseDate(dto.date);
    if (date > today()) throw badRequest('A data da despesa não pode ser futura');
    if (dto.fuel && !dto.vehicleId) throw badRequest('Informe o veículo abastecido');
    const amountCents = toCents(dto.amount);
    const id = await this.prisma.$transaction(async (tx) => {
      const driver = await this.requireDriver(ctx, tx);
      await this.categories.assertUsable(tx, ctx.companyId, dto.categoryId, 'EXPENSE');
      let vehicleId: string | null = null;
      if (dto.vehicleId) {
        const assigned = await tx.routeAssignment.findFirst({ where: { companyId: ctx.companyId, driverId: driver.id, vehicleId: dto.vehicleId, ...activeOn(date) }, select: { id: true } });
        if (!assigned) throw forbidden('Você não está escalado neste veículo nesta data');
        vehicleId = (await this.usableVehicle(tx, ctx.companyId, dto.vehicleId)).id;
      }
      const payableId = await this.createCostPayable(tx, ctx, {
        description: dto.description,
        categoryId: dto.categoryId,
        vehicleId,
        amountCents,
        date,
        dueDate: date,
        supplierName: dto.supplierName ?? dto.fuel?.station ?? null,
        notes: dto.notes ?? null,
        driverId: driver.id,
        approvalStatus: 'PENDING_APPROVAL',
      });
      if (dto.fuel) await this.createFuelDetail(tx, ctx.companyId, payableId, vehicleId!, date, dto.fuel);
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.submitted', entityType: 'Payable', entityId: payableId, after: dto, meta }, tx);
      return payableId;
    });
    const p = await this.prisma.payable.findUniqueOrThrow({ where: { id }, include: EXPENSE_INCLUDE });
    return this.expenseDto(p);
  }

  /** O motorista retira uma despesa que ainda não foi analisada. */
  async withdrawMyExpense(ctx: TenantContext, id: string, meta: RequestMeta) {
    const driver = await this.requireDriver(ctx);
    return this.prisma.$transaction(async (tx) => {
      const p = await this.lockExpense(tx, ctx.companyId, id);
      if (p.driverId !== driver.id || p.createdById !== ctx.userId) throw notFound('Despesa não encontrada');
      if (p.approvalStatus !== 'PENDING_APPROVAL' || p.status === 'CANCELED') throw businessRule('Esta despesa já foi analisada');
      await tx.payable.update({ where: { id }, data: { status: 'CANCELED', canceledAt: new Date(), cancelReason: 'Retirada pelo motorista' } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.withdrawn', entityType: 'Payable', entityId: id, meta }, tx);
      return this.expenseDto(await tx.payable.findUniqueOrThrow({ where: { id }, include: EXPENSE_INCLUDE }));
    });
  }

  // -------------------------------------------------------------------------
  // Aprovação
  // -------------------------------------------------------------------------

  async listApprovals(ctx: TenantContext, q: ListExpenseApprovalsQueryDto) {
    const where: Prisma.PayableWhereInput = { companyId: ctx.companyId, driverId: { not: null }, approvalStatus: q.status ?? 'PENDING_APPROVAL' };
    if ((q.status ?? 'PENDING_APPROVAL') === 'PENDING_APPROVAL') where.status = { not: 'CANCELED' };
    const [items, total] = await Promise.all([
      this.prisma.payable.findMany({ where, include: EXPENSE_INCLUDE, orderBy: [{ createdAt: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.payable.count({ where }),
    ]);
    return { items: items.map((p) => this.expenseDto(p)), total, page: q.page, pageSize: q.pageSize };
  }

  async approve(ctx: TenantContext, id: string, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.lockPending(tx, ctx.companyId, id);
      await this.periods.assertOpen(ctx.companyId, p.competence, tx);
      await tx.payable.update({ where: { id }, data: { approvalStatus: 'APPROVED' } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.approved', entityType: 'Payable', entityId: id, meta }, tx);
      return this.expenseDto(await tx.payable.findUniqueOrThrow({ where: { id }, include: EXPENSE_INCLUDE }));
    });
  }

  async reject(ctx: TenantContext, id: string, dto: RejectExpenseDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockPending(tx, ctx.companyId, id);
      await tx.payable.update({ where: { id }, data: { approvalStatus: 'REJECTED', status: 'CANCELED', canceledAt: new Date(), cancelReason: dto.reason } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'expense.rejected', entityType: 'Payable', entityId: id, reason: dto.reason, meta }, tx);
      return this.expenseDto(await tx.payable.findUniqueOrThrow({ where: { id }, include: EXPENSE_INCLUDE }));
    });
  }

  // -------------------------------------------------------------------------

  private async createCostPayable(tx: Tx, ctx: TenantContext, input: CostPayableInput): Promise<string> {
    const competence = firstOfMonth(input.date);
    await this.periods.assertOpen(ctx.companyId, competence, tx);
    if (input.dueDate < input.date) throw badRequest('O vencimento não pode ser antes da data do gasto');
    const p = await tx.payable.create({
      data: {
        companyId: ctx.companyId,
        description: input.description,
        categoryId: input.categoryId,
        vehicleId: input.vehicleId,
        driverId: input.driverId,
        supplierName: input.supplierName,
        notes: input.notes,
        amount: fromCents(input.amountCents),
        competence,
        dueDate: input.dueDate,
        approvalStatus: input.approvalStatus,
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    await writeAllocations(tx, 'PAYABLE', ctx.companyId, p.id, input.vehicleId, null, input.amountCents);
    return p.id;
  }

  private createFuelDetail(tx: Tx, companyId: string, payableId: string, vehicleId: string, date: Date, fuel: FuelInputDto) {
    return tx.fuelExpenseDetail.create({
      data: {
        companyId,
        payableId,
        vehicleId,
        fuelType: fuel.fuelType ?? 'DIESEL',
        liters: fuel.liters,
        pricePerLiter: fuel.pricePerLiter,
        odometerKm: fuel.odometerKm ?? null,
        station: fuel.station ?? null,
        filledAt: date,
      },
    });
  }

  private fuelCents(fuel: FuelInputDto) {
    return fuelAmountCents(toMilliliters(fuel.liters), toRateUnits(fuel.pricePerLiter));
  }

  private async settle(tx: Tx, ctx: TenantContext, payableId: string, dto: SettleNowDto, meta: RequestMeta) {
    await this.settlements.settle(ctx, 'PAYABLE', payableId, { ...dto }, meta, tx);
  }

  private async usableVehicle(tx: Tx, companyId: string, id: string) {
    const v = await tx.vehicle.findFirst({ where: { id, companyId }, select: { id: true, name: true, archivedAt: true, odometerKm: true } });
    if (!v) throw notFound('Veículo não encontrado');
    if (v.archivedAt) throw businessRule('Este veículo está arquivado');
    return v;
  }

  private async bumpOdometer(tx: Tx, vehicle: { id: string; odometerKm: number }, km: number | null | undefined) {
    if (km && km > vehicle.odometerKm) await tx.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: km } });
  }

  private async requireDriver(ctx: TenantContext, tx?: Tx) {
    const driver = await this.fleet.driverOf(ctx, tx);
    if (!driver) throw forbidden('Seu usuário não está vinculado a um motorista ativo. Peça ao gestor.');
    return driver;
  }

  private async lockExpense(tx: Tx, companyId: string, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payables WHERE id = ${id}::uuid AND "companyId" = ${companyId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound('Despesa não encontrada');
    return tx.payable.findUniqueOrThrow({ where: { id }, select: { id: true, driverId: true, createdById: true, approvalStatus: true, status: true, competence: true } });
  }

  private async lockPending(tx: Tx, companyId: string, id: string) {
    const p = await this.lockExpense(tx, companyId, id);
    if (p.approvalStatus !== 'PENDING_APPROVAL' || p.status === 'CANCELED') throw businessRule('Esta despesa não está aguardando aprovação');
    return p;
  }

  private payableRef(p: { id: string; status: string; approvalStatus: string; paidAmount: Prisma.Decimal; dueDate: Date }) {
    return { id: p.id, status: p.status, approvalStatus: p.approvalStatus, paidAmount: money(p.paidAmount), dueDate: dateOnly(p.dueDate) };
  }

  private maintenanceDto(m: MaintenanceRow) {
    return {
      id: m.id,
      vehicle: m.vehicle,
      type: m.type,
      description: m.description,
      date: dateOnly(m.date),
      amount: money(m.amount),
      odometerKm: m.odometerKm,
      supplierName: m.supplierName,
      notes: m.notes,
      payable: m.payable ? this.payableRef(m.payable) : null,
      createdAt: m.createdAt,
    };
  }

  private fuelBase(f: { id: string; fuelType: FuelRow['fuelType']; filledAt: Date; liters: Prisma.Decimal; pricePerLiter: Prisma.Decimal; odometerKm: number | null; station: string | null }) {
    return {
      id: f.id,
      fuelType: f.fuelType,
      date: dateOnly(f.filledAt),
      liters: f.liters.toFixed(3),
      pricePerLiter: f.pricePerLiter.toFixed(4).replace(/0{1,2}$/, ''),
      odometerKm: f.odometerKm,
      station: f.station,
    };
  }

  private fuelingDto(f: FuelRow) {
    return { ...this.fuelBase(f), vehicle: f.vehicle, driver: f.payable.driver, amount: money(f.payable.amount), payable: this.payableRef(f.payable) };
  }

  private expenseDto(p: ExpenseRow) {
    const fuel = p.fuelDetail ? { ...this.fuelBase(p.fuelDetail), vehicle: p.fuelDetail.vehicle, driver: p.driver, amount: money(p.amount) } : null;
    return { ...this.payables.toDto(p), driver: p.driver, fuel, attachments: p.attachments.map(attachmentDto) };
  }
}

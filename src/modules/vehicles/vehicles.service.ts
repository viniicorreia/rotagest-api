import { Injectable } from '@nestjs/common';
import { Prisma, type Vehicle } from '@prisma/client';
import { ErrorCode, badRequest, conflict, notFound } from '../../common/errors';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { addMonths, firstOfMonth, formatMonth, formatRate, fromCents, kmAmountCents, monthsBetween, parseMonth, toKmTenths, toRateUnits, today } from '../../domain';
import { PeriodLockService } from '../transactions/period-lock.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ResultsService } from '../dashboard/results.service';
import { lockCompany, PlanLimitsService } from '../subscriptions/plan-limits.service';
import type { CreateVehicleDto, ListVehiclesQueryDto, UpdateVehicleDto, VehicleSummaryQueryDto } from './dto/vehicle.dto';

const FIELDS = {
  id: true,
  name: true,
  plate: true,
  brand: true,
  model: true,
  year: true,
  odometerKm: true,
  ratePerKm: true,
  status: true,
  notes: true,
  archivedAt: true,
  createdAt: true,
} satisfies Prisma.VehicleSelect;

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: PlanLimitsService,
    private readonly results: ResultsService,
    private readonly periods: PeriodLockService,
  ) {}

  async list(ctx: TenantContext, q: ListVehiclesQueryDto) {
    const where: Prisma.VehicleWhereInput = { companyId: ctx.companyId };
    if (!q.archived) where.archivedAt = null;
    if (q.status) where.status = q.status;
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { plate: { contains: q.search.toUpperCase().replace(/[^A-Z0-9]/g, '') || q.search } },
      ];
    }
    const [items, usage] = await Promise.all([
      this.prisma.vehicle.findMany({ where, select: FIELDS, orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { name: 'asc' }] }),
      this.usage(ctx.companyId),
    ]);
    return { items: items.map(toVehicleDto), usage };
  }

  async usage(companyId: string, tx?: Tx) {
    const client = tx ?? this.prisma;
    const [used, limits] = await Promise.all([
      client.vehicle.count({ where: { companyId, archivedAt: null } }),
      this.limits.getLimits(companyId, tx),
    ]);
    return { used, limit: limits.maxVehicles };
  }

  async get(ctx: TenantContext, id: string, q: VehicleSummaryQueryDto) {
    const vehicle = await this.prisma.vehicle.findFirst({ where: { id, companyId: ctx.companyId }, select: FIELDS });
    if (!vehicle) throw notFound('Veículo não encontrado');
    const hasHistory = await this.hasHistory(ctx.companyId, id);
    if (!ctx.permissions.includes('finance:read')) return { ...toVehicleDto(vehicle), hasHistory, financial: null };
    const to = q.to ? parseMonth(q.to) : firstOfMonth(today());
    const from = q.from ? parseMonth(q.from) : addMonths(to, -11, 1);
    if (from > to) throw badRequest('A competência inicial deve ser anterior à final');
    if (monthsBetween(from, to).length > 36) throw badRequest('Consulte no máximo 36 meses');

    const rows = await this.results.vehicleMonths(ctx.companyId, from, to, id);
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const months = monthsBetween(from, to).map((m) => {
      const r = byMonth.get(formatMonth(m));
      const revenue = r?.revenueCents ?? 0;
      const direct = r?.directCostCents ?? 0;
      const shared = r?.sharedCostCents ?? 0;
      return { month: formatMonth(m), revenue, direct, shared };
    });
    const sum = (k: 'revenue' | 'direct' | 'shared') => months.reduce((acc, m) => acc + m[k], 0);
    const revenue = sum('revenue');
    const direct = sum('direct');
    const shared = sum('shared');

    return {
      ...toVehicleDto(vehicle),
      hasHistory,
      financial: {
        from: formatMonth(from),
        to: formatMonth(to),
        regime: 'ACCRUAL' as const,
        revenue: fromCents(revenue),
        directCost: fromCents(direct),
        sharedCost: fromCents(shared),
        result: fromCents(revenue - direct - shared),
        months: months.map((m) => ({
          month: m.month,
          revenue: fromCents(m.revenue),
          directCost: fromCents(m.direct),
          sharedCost: fromCents(m.shared),
          result: fromCents(m.revenue - m.direct - m.shared),
        })),
      },
    };
  }

  async create(ctx: TenantContext, dto: CreateVehicleDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertCanAddVehicle(tx, ctx.companyId);
      await this.assertPlateFree(tx, ctx.companyId, dto.plate);
      const vehicle = toVehicleDto(await tx.vehicle.create({ data: { ...dto, companyId: ctx.companyId }, select: FIELDS }));
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'vehicle.created', entityType: 'Vehicle', entityId: vehicle.id, after: vehicle, meta }, tx);
      return vehicle;
    });
  }

  async update(ctx: TenantContext, id: string, dto: UpdateVehicleDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findOrThrow(tx, ctx.companyId, id);
      if (dto.plate && dto.plate !== before.plate) await this.assertPlateFree(tx, ctx.companyId, dto.plate);
      const { applyRateToUnbilled = true, ...data } = dto;
      const after = toVehicleDto(await tx.vehicle.update({ where: { id }, data, select: FIELDS }));
      let recalculated = 0;
      if (dto.ratePerKm !== undefined && after.ratePerKm !== before.ratePerKm && applyRateToUnbilled) {
        recalculated = await this.applyRate(tx, ctx.companyId, id, after.ratePerKm);
      }
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'vehicle.updated', entityType: 'Vehicle', entityId: id, before, after: { ...after, recalculatedLogs: recalculated }, meta }, tx);
      return after;
    });
  }

  /** Arquivar libera a vaga do plano e preserva todo o histórico financeiro. */
  async archive(ctx: TenantContext, id: string, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findOrThrow(tx, ctx.companyId, id);
      if (before.archivedAt) return before;
      const after = toVehicleDto(await tx.vehicle.update({ where: { id }, data: { archivedAt: new Date(), status: 'INACTIVE' }, select: FIELDS }));
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'vehicle.archived', entityType: 'Vehicle', entityId: id, before, after, meta }, tx);
      return after;
    });
  }

  async restore(ctx: TenantContext, id: string, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await this.findOrThrow(tx, ctx.companyId, id);
      if (!before.archivedAt) return before;
      await this.assertCanAddVehicle(tx, ctx.companyId);
      const after = toVehicleDto(await tx.vehicle.update({ where: { id }, data: { archivedAt: null, status: 'ACTIVE' }, select: FIELDS }));
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'vehicle.restored', entityType: 'Vehicle', entityId: id, before, after, meta }, tx);
      return after;
    });
  }

  /** Exclusão definitiva só para cadastro sem nenhum vínculo financeiro ou operacional. */
  async remove(ctx: TenantContext, id: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const before = await this.findOrThrow(tx, ctx.companyId, id);
      if (await this.hasHistory(ctx.companyId, id, tx)) {
        throw conflict('Este veículo tem histórico financeiro e não pode ser excluído. Arquive-o para tirá-lo de uso.');
      }
      await tx.vehicle.delete({ where: { id } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'vehicle.deleted', entityType: 'Vehicle', entityId: id, before, meta }, tx);
    });
  }

  /**
   * Nova taxa vale para os registros diários ainda não faturados (em meses
   * abertos). O que já virou conta a receber mantém a taxa da época.
   */
  private async applyRate(tx: Tx, companyId: string, vehicleId: string, rate: string | null): Promise<number> {
    const logs = await tx.vehicleDailyLog.findMany({ where: { companyId, vehicleId, receivableId: null }, select: { id: true, date: true, kmDriven: true } });
    if (logs.length === 0) return 0;
    const closed = await this.periods.closedMonths(companyId, logs.map((l) => l.date), tx);
    let n = 0;
    for (const log of logs) {
      if (closed.has(formatMonth(log.date))) continue;
      const amount = rate === null ? null : fromCents(kmAmountCents(toKmTenths(log.kmDriven), toRateUnits(rate)));
      await tx.vehicleDailyLog.update({ where: { id: log.id }, data: { ratePerKm: rate, amount } });
      n += 1;
    }
    return n;
  }

  private async hasHistory(companyId: string, vehicleId: string, tx?: Tx): Promise<boolean> {
    const client = tx ?? this.prisma;
    const where = { companyId, vehicleId };
    const counts = await Promise.all([
      client.payable.count({ where }),
      client.expenseAllocation.count({ where }),
      client.revenueAllocation.count({ where }),
      client.maintenance.count({ where }),
      client.fuelExpenseDetail.count({ where }),
      client.routeAssignment.count({ where }),
      client.contractVehicle.count({ where }),
      client.vehicleDailyLog.count({ where }),
    ]);
    return counts.some((c) => c > 0);
  }

  private async findOrThrow(tx: Tx, companyId: string, id: string) {
    const vehicle = await tx.vehicle.findFirst({ where: { id, companyId }, select: FIELDS });
    if (!vehicle) throw notFound('Veículo não encontrado');
    return toVehicleDto(vehicle);
  }

  private async assertPlateFree(tx: Tx, companyId: string, plate: string) {
    const existing = await tx.vehicle.findFirst({ where: { companyId, plate }, select: { id: true } });
    if (existing) throw conflict('Já existe um veículo com esta placa');
  }

  /** Limite de veículos do plano, com lock na empresa para não estourar sob concorrência. */
  private async assertCanAddVehicle(tx: Tx, companyId: string) {
    await lockCompany(tx, companyId);
    const { used, limit } = await this.usage(companyId, tx);
    if (limit !== null && used + 1 > limit) {
      throw conflict(`Seu plano permite até ${limit} veículo(s) ativo(s). Faça upgrade ou arquive um veículo.`, ErrorCode.PLAN_LIMIT_REACHED);
    }
  }
}

export type VehicleRecord = Pick<Vehicle, keyof typeof FIELDS>;

/** Converte a taxa Decimal em texto ("3.50") para a resposta. */
export function toVehicleDto(v: VehicleRecord) {
  return { ...v, ratePerKm: v.ratePerKm === null ? null : formatRate(toRateUnits(v.ratePerKm)) };
}

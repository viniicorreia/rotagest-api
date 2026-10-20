import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { badRequest, businessRule, conflict, forbidden, notFound } from '../../common/errors';
import { dateOnly, money } from '../../common/serialize';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { addDays } from '../../common/utils/dates';
import {
  MAX_KM_PER_DAY,
  firstOfMonth,
  formatMonth,
  formatRate,
  fromCents,
  fromKmTenths,
  kmAmountCents,
  lastOfMonth,
  parseDate,
  parseMonth,
  toCents,
  toKmTenths,
  toRateUnits,
  today,
} from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CategoriesService } from '../categories/categories.service';
import { activeOn, FleetService } from '../fleet/fleet.service';
import { PeriodLockService } from '../transactions/period-lock.service';
import type { BillingPreviewQueryDto, CreateBillingDto, CreateDailyLogDto, ListDailyLogsQueryDto, UpdateDailyLogDto } from './mileage.dto';

/** Quantos dias para trás o motorista pode lançar ou corrigir o próprio km. */
export const DRIVER_EDIT_WINDOW_DAYS = 7;

const INCLUDE = {
  vehicle: { select: { id: true, name: true, plate: true } },
  route: { select: { id: true, name: true } },
  driver: { select: { id: true, name: true } },
} satisfies Prisma.VehicleDailyLogInclude;
type LogRow = Prisma.VehicleDailyLogGetPayload<{ include: typeof INCLUDE }>;

interface Actor {
  ctx: TenantContext;
  manager: boolean;
  finance: boolean;
  driverId: string | null;
}

/**
 * Registro diário de km por veículo e faturamento por km (km × R$/km do
 * veículo). Gestor de frota lança para qualquer veículo; motorista lança só
 * para o veículo em que está escalado no dia, até DRIVER_EDIT_WINDOW_DAYS
 * para trás. Valores ficam ocultos para quem não tem finance:read.
 */
@Injectable()
export class MileageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fleet: FleetService,
    private readonly categories: CategoriesService,
    private readonly periods: PeriodLockService,
  ) {}

  async list(ctx: TenantContext, q: ListDailyLogsQueryDto) {
    const actor = await this.actor(ctx);
    const to = q.to ? parseDate(q.to) : today();
    const from = q.from ? parseDate(q.from) : firstOfMonth(today());
    if (from > to) throw badRequest('A data inicial deve ser anterior à final');
    if (to.getTime() - from.getTime() > 400 * 86_400_000) throw badRequest('Consulte no máximo 400 dias');
    const where: Prisma.VehicleDailyLogWhereInput = { companyId: ctx.companyId, date: { gte: from, lte: to }, vehicleId: q.vehicleId };
    if (q.billed !== undefined) where.receivableId = q.billed ? { not: null } : null;
    if (!ctx.permissions.includes('fleet:read')) where.OR = this.ownScope(actor);
    const rows = await this.prisma.vehicleDailyLog.findMany({ where, include: INCLUDE, orderBy: [{ date: 'desc' }, { vehicle: { name: 'asc' } }], take: 2000 });

    let km = 0;
    let amount = 0;
    let unbilled = 0;
    let missing = 0;
    for (const r of rows) {
      km += toKmTenths(r.kmDriven);
      if (r.amount === null) missing += 1;
      else {
        amount += toCents(r.amount);
        if (!r.receivableId) unbilled += toCents(r.amount);
      }
    }
    return {
      items: rows.map((r) => this.toDto(r, actor)),
      summary: {
        days: rows.length,
        km: fromKmTenths(km),
        amount: actor.finance ? fromCents(amount) : null,
        unbilledAmount: actor.finance ? fromCents(unbilled) : null,
        missingRateDays: missing,
      },
    };
  }

  async create(ctx: TenantContext, dto: CreateDailyLogDto, meta: RequestMeta) {
    const actor = await this.actor(ctx);
    const date = parseDate(dto.date);
    this.assertDateAllowed(actor, date);
    const km = this.resolveKm(dto.kmDriven, dto.odometerStart, dto.odometerEnd);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.findFirst({ where: { id: dto.vehicleId, companyId: ctx.companyId }, select: { id: true, archivedAt: true, ratePerKm: true, odometerKm: true } });
        if (!vehicle) throw notFound('Veículo não encontrado');
        if (vehicle.archivedAt) throw businessRule('Este veículo está arquivado');
        await this.periods.assertOpen(ctx.companyId, date, tx);

        let driverId = dto.driverId ?? null;
        let routeId = dto.routeId ?? null;
        if (!actor.manager) {
          // Motorista: só o veículo da própria escala naquele dia.
          const assignment = await tx.routeAssignment.findFirst({
            where: { companyId: ctx.companyId, driverId: actor.driverId!, vehicleId: vehicle.id, ...activeOn(date) },
            select: { routeId: true },
          });
          if (!assignment) throw forbidden('Você não está escalado neste veículo nesta data');
          driverId = actor.driverId;
          routeId = routeId ?? assignment.routeId;
        }
        if (driverId && !(await tx.driver.findFirst({ where: { id: driverId, companyId: ctx.companyId }, select: { id: true } }))) throw notFound('Motorista não encontrado');
        if (routeId && !(await tx.route.findFirst({ where: { id: routeId, companyId: ctx.companyId }, select: { id: true } }))) throw notFound('Rota não encontrada');

        const rate = vehicle.ratePerKm === null ? null : toRateUnits(vehicle.ratePerKm);
        const created = await tx.vehicleDailyLog.create({
          data: {
            companyId: ctx.companyId,
            vehicleId: vehicle.id,
            date,
            kmDriven: fromKmTenths(km),
            odometerStart: dto.odometerStart ?? null,
            odometerEnd: dto.odometerEnd ?? null,
            ratePerKm: rate === null ? null : formatRate(rate),
            amount: rate === null ? null : fromCents(kmAmountCents(km, rate)),
            driverId,
            routeId,
            notes: dto.notes ?? null,
            createdById: ctx.userId,
          },
          include: INCLUDE,
        });
        if (dto.odometerEnd && dto.odometerEnd > vehicle.odometerKm) {
          await tx.vehicle.update({ where: { id: vehicle.id }, data: { odometerKm: dto.odometerEnd } });
        }
        await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'daily_log.created', entityType: 'VehicleDailyLog', entityId: created.id, after: dto, meta }, tx);
        return this.toDto(created, actor);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('Já existe um registro de km deste veículo neste dia. Edite o registro existente.');
      throw e;
    }
  }

  async update(ctx: TenantContext, id: string, dto: UpdateDailyLogDto, meta: RequestMeta) {
    const actor = await this.actor(ctx);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.editableOrThrow(tx, actor, id);
      const odometerStart = dto.odometerStart !== undefined ? dto.odometerStart : before.odometerStart;
      const odometerEnd = dto.odometerEnd !== undefined ? dto.odometerEnd : before.odometerEnd;
      const odometerChanged = dto.odometerStart !== undefined || dto.odometerEnd !== undefined;
      const km = this.resolveKm(dto.kmDriven ?? (odometerChanged ? undefined : before.kmDriven.toFixed(1)), odometerStart, odometerEnd);

      let rate = before.ratePerKm === null ? null : toRateUnits(before.ratePerKm);
      if (rate === null) {
        // Registro sem taxa: passa a usar a taxa atual do veículo, se houver.
        const v = await tx.vehicle.findUniqueOrThrow({ where: { id: before.vehicleId }, select: { ratePerKm: true } });
        rate = v.ratePerKm === null ? null : toRateUnits(v.ratePerKm);
      }
      let driverId = dto.driverId !== undefined ? dto.driverId : before.driverId;
      if (!actor.manager) driverId = actor.driverId;
      if (driverId && driverId !== before.driverId && !(await tx.driver.findFirst({ where: { id: driverId, companyId: ctx.companyId }, select: { id: true } }))) throw notFound('Motorista não encontrado');
      const routeId = dto.routeId !== undefined ? dto.routeId : before.routeId;
      if (routeId && routeId !== before.routeId && !(await tx.route.findFirst({ where: { id: routeId, companyId: ctx.companyId }, select: { id: true } }))) throw notFound('Rota não encontrada');

      const after = await tx.vehicleDailyLog.update({
        where: { id },
        data: {
          kmDriven: fromKmTenths(km),
          odometerStart,
          odometerEnd,
          ratePerKm: rate === null ? null : formatRate(rate),
          amount: rate === null ? null : fromCents(kmAmountCents(km, rate)),
          driverId,
          routeId,
          notes: dto.notes,
        },
        include: INCLUDE,
      });
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'daily_log.updated', entityType: 'VehicleDailyLog', entityId: id, before: { kmDriven: before.kmDriven.toFixed(1), odometerStart: before.odometerStart, odometerEnd: before.odometerEnd }, after: dto, meta },
        tx,
      );
      return this.toDto(after, actor);
    });
  }

  async remove(ctx: TenantContext, id: string, meta: RequestMeta) {
    const actor = await this.actor(ctx);
    await this.prisma.$transaction(async (tx) => {
      const before = await this.editableOrThrow(tx, actor, id);
      await tx.vehicleDailyLog.delete({ where: { id } });
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'daily_log.deleted', entityType: 'VehicleDailyLog', entityId: id, before: { vehicleId: before.vehicleId, date: dateOnly(before.date), kmDriven: before.kmDriven.toFixed(1) }, meta },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- faturamento

  async billingPreview(ctx: TenantContext, q: BillingPreviewQueryDto) {
    const month = parseMonth(q.month);
    const rows = await this.prisma.vehicleDailyLog.findMany({
      where: { companyId: ctx.companyId, date: { gte: month, lte: lastOfMonth(month) } },
      select: { vehicleId: true, kmDriven: true, amount: true, receivableId: true },
    });
    const vehicles = await this.prisma.vehicle.findMany({
      where: { companyId: ctx.companyId, id: { in: [...new Set(rows.map((r) => r.vehicleId))] } },
      select: { id: true, name: true, plate: true, ratePerKm: true },
      orderBy: { name: 'asc' },
    });
    let total = 0;
    const result = vehicles.map((v) => {
      const mine = rows.filter((r) => r.vehicleId === v.id);
      const open = mine.filter((r) => !r.receivableId);
      const billed = mine.filter((r) => r.receivableId);
      const amount = open.reduce((acc, r) => acc + (r.amount ? toCents(r.amount) : 0), 0);
      total += amount;
      return {
        vehicle: { id: v.id, name: v.name, plate: v.plate },
        ratePerKm: v.ratePerKm === null ? null : formatRate(toRateUnits(v.ratePerKm)),
        days: open.length,
        km: fromKmTenths(open.reduce((acc, r) => acc + toKmTenths(r.kmDriven), 0)),
        amount: fromCents(amount),
        missingRateDays: open.filter((r) => r.amount === null).length,
        billedAmount: fromCents(billed.reduce((acc, r) => acc + (r.amount ? toCents(r.amount) : 0), 0)),
        billedDays: billed.length,
      };
    });
    return { month: q.month, vehicles: result, totalAmount: fromCents(total) };
  }

  /**
   * Gera uma conta a receber por veículo com os km do mês ainda não
   * faturados. Os registros ficam presos à conta; cancelar a conta libera
   * os registros para um novo faturamento.
   */
  async bill(ctx: TenantContext, dto: CreateBillingDto, meta: RequestMeta) {
    const month = parseMonth(dto.month);
    const dueDate = parseDate(dto.dueDate);
    if (dueDate < month) throw badRequest('O vencimento não pode ser antes do mês faturado');
    const vehicleIds = [...new Set(dto.vehicleIds)];
    return this.prisma.$transaction(async (tx) => {
      await this.periods.assertOpen(ctx.companyId, month, tx);
      const category = dto.categoryId ? await this.categories.assertUsable(tx, ctx.companyId, dto.categoryId, 'INCOME') : await this.categories.bySystemKey(tx, ctx.companyId, 'CONTRACT');
      const items = [];
      for (const vehicleId of vehicleIds) {
        const vehicle = await tx.vehicle.findFirst({ where: { id: vehicleId, companyId: ctx.companyId }, select: { id: true, name: true, plate: true } });
        if (!vehicle) throw notFound('Veículo não encontrado');
        // Trava os registros a faturar: dois faturamentos simultâneos não pegam o mesmo dia.
        const locked = await tx.$queryRaw<{ id: string; kmDriven: string; amount: string | null }[]>`
          SELECT id, "kmDriven"::text AS "kmDriven", amount::text AS amount FROM vehicle_daily_logs
          WHERE "companyId" = ${ctx.companyId}::uuid AND "vehicleId" = ${vehicleId}::uuid
            AND date BETWEEN ${month}::date AND ${lastOfMonth(month)}::date AND "receivableId" IS NULL
          ORDER BY date FOR UPDATE`;
        const billable = locked.filter((l) => l.amount !== null && toCents(l.amount) > 0);
        if (billable.length === 0) {
          throw businessRule(`${vehicle.name}: não há km com valor a faturar em ${formatMonth(month)}. Confira se o veículo tem valor por km.`);
        }
        const amount = billable.reduce((acc, l) => acc + toCents(l.amount!), 0);
        const km = fromKmTenths(billable.reduce((acc, l) => acc + toKmTenths(l.kmDriven), 0));
        const label = `${String(month.getUTCMonth() + 1).padStart(2, '0')}/${month.getUTCFullYear()}`;
        const description = `Km rodados ${label} — ${vehicle.name} (${km.replace('.', ',')} km)`;
        const receivable = await tx.receivable.create({
          data: {
            companyId: ctx.companyId,
            description,
            categoryId: category.id,
            amount: fromCents(amount),
            competence: month,
            dueDate,
            kind: 'SINGLE',
            notes: `${billable.length} dia(s) registrados`,
            createdById: ctx.userId,
          },
          select: { id: true },
        });
        await tx.revenueAllocation.create({ data: { companyId: ctx.companyId, receivableId: receivable.id, vehicleId, method: 'DIRECT', percent: 100, amount: fromCents(amount) } });
        await tx.vehicleDailyLog.updateMany({ where: { id: { in: billable.map((l) => l.id) } }, data: { receivableId: receivable.id } });
        items.push({ vehicle, receivableId: receivable.id, description, days: billable.length, km, amount: fromCents(amount) });
      }
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'daily_log.billed', entityType: 'Receivable', entityId: items[0]?.receivableId ?? null, after: { month: dto.month, items }, meta }, tx);
      return { items };
    });
  }

  // ---------------------------------------------------------------- apoio

  private async actor(ctx: TenantContext): Promise<Actor> {
    const manager = ctx.permissions.includes('fleet:manage');
    const driver = manager ? null : await this.fleet.driverOf(ctx);
    return { ctx, manager, finance: ctx.permissions.includes('finance:read'), driverId: driver?.id ?? null };
  }

  private ownScope(actor: Actor): Prisma.VehicleDailyLogWhereInput[] {
    return [{ createdById: actor.ctx.userId }, ...(actor.driverId ? [{ driverId: actor.driverId }] : [])];
  }

  private assertDateAllowed(actor: Actor, date: Date) {
    const now = today();
    if (date > now) throw badRequest('Não é possível registrar km de um dia que ainda não aconteceu');
    if (!actor.manager) {
      if (!actor.driverId) throw forbidden('Seu usuário não está ligado a um cadastro de motorista. Peça ao gestor para vincular.');
      if (date < addDays(now, -DRIVER_EDIT_WINDOW_DAYS)) throw forbidden(`Motoristas registram ou corrigem km até ${DRIVER_EDIT_WINDOW_DAYS} dias atrás. Peça ao gestor.`);
    }
  }

  private async editableOrThrow(tx: Tx, actor: Actor, id: string) {
    const log = await tx.vehicleDailyLog.findFirst({ where: { id, companyId: actor.ctx.companyId } });
    if (!log) throw notFound('Registro não encontrado');
    if (!actor.manager) {
      const own = log.createdById === actor.ctx.userId || (actor.driverId !== null && log.driverId === actor.driverId);
      if (!own) throw notFound('Registro não encontrado');
      this.assertDateAllowed(actor, log.date);
    }
    if (log.receivableId) throw businessRule('Este dia já foi faturado. Cancele a conta a receber para alterar o registro.');
    await this.periods.assertOpen(actor.ctx.companyId, log.date, tx);
    return log;
  }

  /** km do dia: informado direto ou pela diferença dos hodômetros (os dois precisam bater). */
  private resolveKm(kmDriven: string | undefined, start: number | null | undefined, end: number | null | undefined): number {
    const hasStart = start !== null && start !== undefined;
    const hasEnd = end !== null && end !== undefined;
    if (hasStart !== hasEnd) throw badRequest('Informe os dois hodômetros (saída e chegada) ou nenhum');
    let km: number | null = kmDriven !== undefined ? toKmTenths(kmDriven) : null;
    if (hasStart && hasEnd) {
      if (end! < start!) throw badRequest('O hodômetro de chegada deve ser maior ou igual ao de saída');
      const fromOdometer = (end! - start!) * 10;
      if (km !== null && km !== fromOdometer) throw badRequest('Os km informados não batem com a diferença dos hodômetros');
      km = fromOdometer;
    }
    if (km === null) throw badRequest('Informe os km rodados ou os hodômetros de saída e chegada');
    if (km > MAX_KM_PER_DAY * 10) throw badRequest(`Máximo de ${MAX_KM_PER_DAY} km por dia`);
    return km;
  }

  private toDto(r: LogRow, actor: Actor) {
    const own = r.createdById === actor.ctx.userId || (actor.driverId !== null && r.driverId === actor.driverId);
    const inWindow = r.date >= addDays(today(), -DRIVER_EDIT_WINDOW_DAYS);
    return {
      id: r.id,
      vehicle: r.vehicle,
      date: dateOnly(r.date),
      kmDriven: r.kmDriven.toFixed(1),
      odometerStart: r.odometerStart,
      odometerEnd: r.odometerEnd,
      route: r.route,
      driver: r.driver,
      ratePerKm: actor.finance && r.ratePerKm !== null ? formatRate(toRateUnits(r.ratePerKm)) : null,
      amount: actor.finance && r.amount !== null ? money(r.amount) : null,
      billed: r.receivableId !== null,
      receivableId: actor.finance ? r.receivableId : null,
      notes: r.notes,
      editable: !r.receivableId && (actor.manager || (own && inWindow)),
      createdAt: r.createdAt,
    };
  }
}

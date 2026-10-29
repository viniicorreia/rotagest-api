import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { badRequest, businessRule, conflict, notFound } from '../../common/errors';
import { dateOnly } from '../../common/serialize';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { parseDate, today } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  CreateAssignmentDto,
  CreateDriverDto,
  CreateRouteDto,
  EndAssignmentDto,
  ListAssignmentsQueryDto,
  ListFleetQueryDto,
  UpdateDriverDto,
  UpdateRouteDto,
} from './fleet.dto';

const VEHICLE_REF = { select: { id: true, name: true, plate: true } } as const;
const DRIVER_REF = { select: { id: true, name: true } } as const;
const ROUTE_REF = { select: { id: true, name: true } } as const;

const ASSIGNMENT_INCLUDE = { vehicle: VEHICLE_REF, driver: DRIVER_REF, route: ROUTE_REF } satisfies Prisma.RouteAssignmentInclude;
type AssignmentRow = Prisma.RouteAssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

/** Atribuição vigente na data: começou até ela e não terminou antes dela. */
export function activeOn(date: Date): Prisma.RouteAssignmentWhereInput {
  return { startDate: { lte: date }, OR: [{ endDate: null }, { endDate: { gte: date } }] };
}

/**
 * Motoristas, rotas e atribuições temporais (quem dirige qual veículo em qual
 * rota, e desde quando). Encerrar uma atribuição preenche o fim; o histórico
 * nunca é sobrescrito.
 */
@Injectable()
export class FleetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- motoristas

  async listDrivers(ctx: TenantContext, q: ListFleetQueryDto) {
    const where: Prisma.DriverWhereInput = { companyId: ctx.companyId, status: q.status };
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { document: { contains: q.search.replace(/\D/g, '') || q.search } }];
    return this.findDrivers(this.prisma, where);
  }

  async createDriver(ctx: TenantContext, dto: CreateDriverDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.document) await this.assertDocumentFree(tx, ctx.companyId, dto.document);
      if (dto.memberId) await this.assertMemberFree(tx, ctx.companyId, dto.memberId);
      const d = await tx.driver.create({
        data: { ...dto, hiredAt: dto.hiredAt ? parseDate(dto.hiredAt) : null, companyId: ctx.companyId },
        select: { id: true },
      });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'driver.created', entityType: 'Driver', entityId: d.id, after: dto, meta }, tx);
      return this.driverById(tx, ctx, d.id);
    });
  }

  async updateDriver(ctx: TenantContext, id: string, dto: UpdateDriverDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.driver.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!before) throw notFound('Motorista não encontrado');
      if (before.anonymizedAt) throw conflict('Os dados deste motorista foram removidos e o cadastro não pode ser editado');
      if (dto.document && dto.document !== before.document) await this.assertDocumentFree(tx, ctx.companyId, dto.document);
      if (dto.memberId && dto.memberId !== before.memberId) await this.assertMemberFree(tx, ctx.companyId, dto.memberId);
      await tx.driver.update({
        where: { id },
        data: { ...dto, hiredAt: dto.hiredAt === undefined ? undefined : dto.hiredAt ? parseDate(dto.hiredAt) : null },
      });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'driver.updated', entityType: 'Driver', entityId: id, before, after: dto, meta }, tx);
      return this.driverById(tx, ctx, id);
    });
  }

  async removeDriver(ctx: TenantContext, id: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const d = await tx.driver.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!d) throw notFound('Motorista não encontrado');
      const where = { companyId: ctx.companyId, driverId: id };
      const used = await Promise.all([tx.routeAssignment.count({ where }), tx.payable.count({ where }), tx.vehicleDailyLog.count({ where })]);
      if (used.some((n) => n > 0)) throw conflict('Este motorista tem histórico. Marque como inativo em vez de excluir.');
      await tx.driver.delete({ where: { id } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'driver.deleted', entityType: 'Driver', entityId: id, before: d, meta }, tx);
    });
  }

  /**
   * LGPD: remove nome, CPF, telefone e vínculo de um motorista inativo,
   * mantendo o histórico (rotas, diários, despesas) com um rótulo neutro.
   * Irreversível.
   */
  async anonymizeDriver(ctx: TenantContext, id: string, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const d = await tx.driver.findFirst({ where: { id, companyId: ctx.companyId }, select: { status: true, anonymizedAt: true } });
      if (!d) throw notFound('Motorista não encontrado');
      if (d.anonymizedAt) throw conflict('Os dados deste motorista já foram removidos');
      if (d.status !== 'INACTIVE') throw businessRule('Marque o motorista como inativo antes de remover os dados pessoais.');
      const tag = id.slice(0, 8);
      await tx.driver.update({
        where: { id },
        data: { name: `Motorista removido ${tag}`, document: `anon-${tag}`, phone: null, hiredAt: null, memberId: null, anonymizedAt: new Date() },
      });
      // Sem "antes": a auditoria não guarda de novo os dados que estão sendo removidos.
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'driver.anonymized', entityType: 'Driver', entityId: id, meta }, tx);
      return this.driverById(tx, ctx, id);
    });
  }

  private async driverById(tx: Tx, ctx: TenantContext, id: string) {
    const [d] = await this.findDrivers(tx, { companyId: ctx.companyId, id });
    return d;
  }

  private async findDrivers(client: Tx, where: Prisma.DriverWhereInput) {
    const rows = await client.driver.findMany({
      where,
      include: { member: { select: { id: true, user: { select: { name: true } } } }, routeAssignments: { where: activeOn(today()), include: { route: ROUTE_REF } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return rows.map((d) => ({
      id: d.id,
      name: d.name,
      document: d.document,
      phone: d.phone,
      hiredAt: dateOnly(d.hiredAt),
      employmentType: d.employmentType,
      status: d.status,
      anonymized: d.anonymizedAt !== null,
      member: d.member ? { id: d.member.id, name: d.member.user.name } : null,
      currentRoutes: d.routeAssignments.map((a) => a.route.name),
    }));
  }

  private async assertDocumentFree(tx: Tx, companyId: string, document: string) {
    if (await tx.driver.findFirst({ where: { companyId, document }, select: { id: true } })) throw conflict('Já existe um motorista com este CPF');
  }

  /** O usuário vinculado precisa ser membro ativo DESTA empresa e não estar ligado a outro motorista. */
  private async assertMemberFree(tx: Tx, companyId: string, memberId: string) {
    const member = await tx.companyMember.findFirst({ where: { id: memberId, companyId }, select: { status: true } });
    if (!member) throw notFound('Membro não encontrado');
    if (member.status !== 'ACTIVE') throw businessRule('O usuário escolhido não está ativo nesta empresa');
    if (await tx.driver.findFirst({ where: { companyId, memberId }, select: { id: true } })) throw conflict('Este usuário já está ligado a outro motorista');
  }

  // ---------------------------------------------------------------- rotas

  async listRoutes(ctx: TenantContext, q: ListFleetQueryDto) {
    const where: Prisma.RouteWhereInput = { companyId: ctx.companyId, status: q.status };
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { region: { contains: q.search, mode: 'insensitive' } }];
    const rows = await this.prisma.route.findMany({
      where,
      include: { assignments: { where: activeOn(today()), include: { vehicle: VEHICLE_REF, driver: DRIVER_REF }, orderBy: { startDate: 'asc' } } },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.routeDto(r));
  }

  async createRoute(ctx: TenantContext, dto: CreateRouteDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertRouteNameFree(tx, ctx.companyId, dto.name);
      const r = await tx.route.create({ data: { ...dto, companyId: ctx.companyId } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'route.created', entityType: 'Route', entityId: r.id, after: dto, meta }, tx);
      return this.routeDto({ ...r, assignments: [] });
    });
  }

  async updateRoute(ctx: TenantContext, id: string, dto: UpdateRouteDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.route.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!before) throw notFound('Rota não encontrada');
      if (dto.name && dto.name !== before.name) await this.assertRouteNameFree(tx, ctx.companyId, dto.name);
      const r = await tx.route.update({
        where: { id },
        data: dto,
        include: { assignments: { where: activeOn(today()), include: { vehicle: VEHICLE_REF, driver: DRIVER_REF } } },
      });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'route.updated', entityType: 'Route', entityId: id, before, after: dto, meta }, tx);
      return this.routeDto(r);
    });
  }

  async removeRoute(ctx: TenantContext, id: string, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.route.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!r) throw notFound('Rota não encontrada');
      const where = { companyId: ctx.companyId, routeId: id };
      const used = await Promise.all([
        tx.routeAssignment.count({ where }),
        tx.contractRoute.count({ where }),
        tx.payable.count({ where }),
        tx.vehicleDailyLog.count({ where }),
        tx.expenseAllocation.count({ where }),
      ]);
      if (used.some((n) => n > 0)) throw conflict('Esta rota tem histórico. Marque como inativa em vez de excluir.');
      await tx.route.delete({ where: { id } });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'route.deleted', entityType: 'Route', entityId: id, before: r, meta }, tx);
    });
  }

  private routeDto(r: Prisma.RouteGetPayload<{ include: { assignments: { include: { vehicle: typeof VEHICLE_REF; driver: typeof DRIVER_REF } } } }>) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      transportType: r.transportType,
      region: r.region,
      status: r.status,
      current: r.assignments.map((a) => ({ id: a.id, vehicle: a.vehicle, driver: a.driver, startDate: dateOnly(a.startDate), endDate: dateOnly(a.endDate) })),
    };
  }

  private async assertRouteNameFree(tx: Tx, companyId: string, name: string) {
    if (await tx.route.findFirst({ where: { companyId, name: { equals: name, mode: 'insensitive' } }, select: { id: true } })) throw conflict('Já existe uma rota com este nome');
  }

  // ---------------------------------------------------------------- atribuições

  async listAssignments(ctx: TenantContext, q: ListAssignmentsQueryDto) {
    const and: Prisma.RouteAssignmentWhereInput[] = [{ companyId: ctx.companyId }];
    if (q.routeId) and.push({ routeId: q.routeId });
    if (q.vehicleId) and.push({ vehicleId: q.vehicleId });
    if (q.driverId) and.push({ driverId: q.driverId });
    if (q.current) and.push(activeOn(today()));
    const rows = await this.prisma.routeAssignment.findMany({ where: { AND: and }, include: ASSIGNMENT_INCLUDE, orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }], take: 500 });
    return rows.map((a) => this.assignmentDto(a));
  }

  async createAssignment(ctx: TenantContext, dto: CreateAssignmentDto, meta: RequestMeta) {
    if (!dto.vehicleId && !dto.driverId) throw badRequest('Informe o veículo, o motorista ou os dois');
    const startDate = parseDate(dto.startDate);
    const endDate = dto.endDate ? parseDate(dto.endDate) : null;
    if (endDate && endDate < startDate) throw badRequest('O fim deve ser igual ou depois do início');
    return this.prisma.$transaction(async (tx) => {
      const route = await tx.route.findFirst({ where: { id: dto.routeId, companyId: ctx.companyId }, select: { status: true } });
      if (!route) throw notFound('Rota não encontrada');
      if (route.status !== 'ACTIVE') throw businessRule('Esta rota está inativa');
      if (dto.vehicleId) {
        const v = await tx.vehicle.findFirst({ where: { id: dto.vehicleId, companyId: ctx.companyId }, select: { archivedAt: true } });
        if (!v) throw notFound('Veículo não encontrado');
        if (v.archivedAt) throw businessRule('Este veículo está arquivado');
      }
      if (dto.driverId) {
        const d = await tx.driver.findFirst({ where: { id: dto.driverId, companyId: ctx.companyId }, select: { status: true } });
        if (!d) throw notFound('Motorista não encontrado');
        if (d.status !== 'ACTIVE') throw businessRule('Este motorista está inativo');
      }
      // Na mesma rota, o mesmo veículo (ou motorista) não pode ter duas atribuições sobrepostas.
      const overlap: Prisma.RouteAssignmentWhereInput = {
        companyId: ctx.companyId,
        routeId: dto.routeId,
        OR: [...(dto.vehicleId ? [{ vehicleId: dto.vehicleId }] : []), ...(dto.driverId ? [{ driverId: dto.driverId }] : [])],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: startDate } }] }, ...(endDate ? [{ startDate: { lte: endDate } }] : [])],
      };
      if (await tx.routeAssignment.findFirst({ where: overlap, select: { id: true } })) {
        throw conflict('Já existe uma atribuição desse veículo ou motorista nesta rota no mesmo período. Encerre a anterior primeiro.');
      }
      const a = await tx.routeAssignment.create({
        data: { companyId: ctx.companyId, routeId: dto.routeId, vehicleId: dto.vehicleId ?? null, driverId: dto.driverId ?? null, startDate, endDate, notes: dto.notes ?? null },
        include: ASSIGNMENT_INCLUDE,
      });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'assignment.created', entityType: 'RouteAssignment', entityId: a.id, after: dto, meta }, tx);
      return this.assignmentDto(a);
    });
  }

  async endAssignment(ctx: TenantContext, id: string, dto: EndAssignmentDto, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.routeAssignment.findFirst({ where: { id, companyId: ctx.companyId } });
      if (!a) throw notFound('Atribuição não encontrada');
      const endDate = parseDate(dto.endDate);
      if (endDate < a.startDate) throw badRequest('O fim deve ser igual ou depois do início');
      if (a.endDate && a.endDate < endDate) throw businessRule('Esta atribuição já terminou');
      const after = await tx.routeAssignment.update({ where: { id }, data: { endDate }, include: ASSIGNMENT_INCLUDE });
      await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'assignment.ended', entityType: 'RouteAssignment', entityId: id, before: { endDate: dateOnly(a.endDate) }, after: { endDate: dto.endDate }, meta }, tx);
      return this.assignmentDto(after);
    });
  }

  /** Portal do motorista: cadastro ligado ao usuário e o que ele dirige hoje. */
  async mine(ctx: TenantContext) {
    const driver = await this.driverOf(ctx);
    if (!driver) return { driver: null, assignments: [], vehicles: [] };
    const now = today();
    const rows = await this.prisma.routeAssignment.findMany({ where: { companyId: ctx.companyId, driverId: driver.id, ...activeOn(now) }, include: ASSIGNMENT_INCLUDE, orderBy: { startDate: 'asc' } });
    const vehicles = new Map<string, { id: string; name: string; plate: string }>();
    for (const a of rows) if (a.vehicle) vehicles.set(a.vehicle.id, a.vehicle);
    return { driver, assignments: rows.map((a) => this.assignmentDto(a)), vehicles: [...vehicles.values()] };
  }

  /** Motorista ligado ao membro logado (null se não houver ou estiver inativo). */
  async driverOf(ctx: TenantContext, tx?: Tx) {
    return (tx ?? this.prisma).driver.findFirst({ where: { companyId: ctx.companyId, memberId: ctx.memberId, status: 'ACTIVE' }, select: { id: true, name: true } });
  }

  private assignmentDto(a: AssignmentRow) {
    const now = today();
    return {
      id: a.id,
      route: a.route,
      vehicle: a.vehicle,
      driver: a.driver,
      startDate: dateOnly(a.startDate),
      endDate: dateOnly(a.endDate),
      notes: a.notes,
      active: a.startDate <= now && (!a.endDate || a.endDate >= now),
    };
  }
}

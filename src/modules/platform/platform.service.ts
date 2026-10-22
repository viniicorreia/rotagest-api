import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { businessRule, conflict, notFound } from '../../common/errors';
import type { AuthUser, RequestMeta } from '../../common/tenant/tenant-context';
import { addDays } from '../../common/utils/dates';
import { PLAN_FEATURES, fromCents, parseDate, toCents } from '../../domain';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { PlatformSettingsService } from '../subscriptions/platform-settings.service';
import type {
  CreatePlanDto,
  ListCompaniesQueryDto,
  ListSubscriptionsQueryDto,
  SetCompanyStatusDto,
  UpdatePlanDto,
  UpdatePlatformSettingsDto,
  UpdateSubscriptionDto,
} from './platform.dto';

const FEATURE_LABELS = new Map<string, string>(PLAN_FEATURES.map((f) => [f.key, f.label]));

/** Campos cadastrais da empresa. Nada do financeiro das empresas sai daqui. */
const COMPANY_FIELDS = {
  id: true,
  tradeName: true,
  legalName: true,
  document: true,
  email: true,
  phone: true,
  city: true,
  state: true,
  status: true,
  createdAt: true,
} satisfies Prisma.CompanySelect;

const SUBSCRIPTION_FIELDS = {
  id: true,
  status: true,
  trialEndsAt: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  canceledAt: true,
  overrideMaxVehicles: true,
  overrideMaxUsers: true,
  externalProvider: true,
  companyId: true,
  plan: { select: { id: true, code: true, name: true, maxVehicles: true, maxUsers: true } },
} satisfies Prisma.SubscriptionSelect;

type SubscriptionRow = Prisma.SubscriptionGetPayload<{ select: typeof SUBSCRIPTION_FIELDS }>;

/**
 * Painel do SUPER_ADMIN: empresas, planos, assinaturas, configurações e
 * indicadores comerciais. Só lê dados cadastrais e de uso (contagens) das
 * empresas; receitas, despesas, contas e relatórios delas não são acessíveis.
 * Toda alteração é auditada com justificativa.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: PlatformSettingsService,
    private readonly billing: BillingService,
  ) {}

  // -------------------------------------------------------------------------
  // Indicadores
  // -------------------------------------------------------------------------

  async overview() {
    const now = new Date();
    const [companies, companiesByStatus, subsByStatus, subsByPlan, plans, active, newCompanies30d, trialsEnding7d, vehicles, members] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.company.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.subscription.groupBy({ by: ['planId'], where: { status: { not: 'CANCELED' } }, _count: { _all: true } }),
      this.prisma.plan.findMany({ select: { id: true, name: true } }),
      this.prisma.subscription.findMany({ where: { status: 'ACTIVE' }, select: { plan: { select: { price: true, interval: true } } } }),
      this.prisma.company.count({ where: { createdAt: { gte: addDays(now, -30) } } }),
      this.prisma.subscription.count({ where: { status: 'TRIALING', trialEndsAt: { gte: now, lte: addDays(now, 7) } } }),
      this.prisma.vehicle.count({ where: { archivedAt: null, company: { status: 'ACTIVE' } } }),
      this.prisma.companyMember.count({ where: { status: 'ACTIVE', company: { status: 'ACTIVE' } } }),
    ]);
    const planName = new Map(plans.map((p) => [p.id, p.name]));
    // Anual entra como 1/12 por mês; arredonda por assinatura para fechar em centavos.
    const mrrCents = active.reduce((sum, s) => sum + (s.plan.interval === 'YEARLY' ? Math.round(toCents(s.plan.price) / 12) : toCents(s.plan.price)), 0);
    return {
      companies,
      companiesByStatus: companiesByStatus.map((r) => ({ status: r.status, count: r._count._all })),
      subscriptionsByStatus: subsByStatus.map((r) => ({ status: r.status, count: r._count._all })),
      subscriptionsByPlan: subsByPlan
        .map((r) => ({ planId: r.planId, name: planName.get(r.planId) ?? '—', count: r._count._all }))
        .sort((a, b) => b.count - a.count),
      mrr: fromCents(mrrCents),
      newCompanies30d,
      trialsEnding7d,
      pastDue: subsByStatus.find((r) => r.status === 'PAST_DUE')?._count._all ?? 0,
      vehicles,
      members,
      billing: this.billing.status(),
    };
  }

  // -------------------------------------------------------------------------
  // Empresas
  // -------------------------------------------------------------------------

  async listCompanies(q: ListCompaniesQueryDto) {
    const digits = q.search?.replace(/\D/g, '');
    const where: Prisma.CompanyWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? {
            OR: [
              { tradeName: { contains: q.search, mode: 'insensitive' } },
              { legalName: { contains: q.search, mode: 'insensitive' } },
              { email: { contains: q.search, mode: 'insensitive' } },
              ...(digits && digits.length >= 3 ? [{ document: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        select: { ...COMPANY_FIELDS, subscription: { select: SUBSCRIPTION_FIELDS } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.company.count({ where }),
    ]);
    const usage = await this.usageOf(rows.map((r) => r.id));
    return {
      items: rows.map(({ subscription, ...c }) => ({ ...c, subscription: subscription ? subscriptionSummary(subscription) : null, usage: usageFor(usage, c.id, subscription) })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async getCompany(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: {
        ...COMPANY_FIELDS,
        subscription: { select: SUBSCRIPTION_FIELDS },
        members: { where: { role: 'OWNER', status: 'ACTIVE' }, select: { user: { select: { id: true, name: true, email: true } } } },
      },
    });
    if (!company) throw notFound('Empresa não encontrada');
    const { subscription, members, ...rest } = company;
    const [usage, history, supportAccess] = await Promise.all([
      this.usageOf([id]),
      this.historyOf(id),
      this.prisma.supportGrant.findFirst({
        where: { companyId: id, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { expiresAt: 'desc' },
        select: { expiresAt: true, reason: true },
      }),
    ]);
    return {
      ...rest,
      subscription: subscription ? subscriptionSummary(subscription) : null,
      usage: usageFor(usage, id, subscription),
      owners: members.map((m) => m.user),
      supportAccess,
      history,
    };
  }

  async setCompanyStatus(user: AuthUser, id: string, dto: SetCompanyStatusDto, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM companies WHERE id = ${id}::uuid FOR UPDATE`;
      if (!rows.length) throw notFound('Empresa não encontrada');
      const before = rows[0].status;
      if (before === dto.status) throw conflict(`A empresa já está ${COMPANY_STATUS_LABELS[dto.status]}`);
      await tx.company.update({ where: { id }, data: { status: dto.status } });
      await this.audit.log(
        {
          companyId: id,
          actorUserId: user.userId,
          action: `platform.company.${dto.status === 'ACTIVE' ? 'activated' : dto.status === 'SUSPENDED' ? 'suspended' : 'canceled'}`,
          entityType: 'Company',
          entityId: id,
          before: { status: before },
          after: { status: dto.status },
          reason: dto.reason,
          meta,
        },
        tx,
      );
    });
    return this.getCompany(id);
  }

  // -------------------------------------------------------------------------
  // Planos
  // -------------------------------------------------------------------------

  async listPlans() {
    const [plans, counts, settings] = await Promise.all([
      this.prisma.plan.findMany({ include: { features: true }, orderBy: [{ status: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.subscription.groupBy({ by: ['planId'], where: { status: { not: 'CANCELED' } }, _count: { _all: true } }),
      this.settings.get(),
    ]);
    const countOf = new Map(counts.map((c) => [c.planId, c._count._all]));
    return {
      items: plans.map((p) => planDto(p, countOf.get(p.id) ?? 0, settings.defaultPlan?.id === p.id)),
      catalog: PLAN_FEATURES.map((f) => ({ key: f.key, label: f.label, enabled: false })),
    };
  }

  async createPlan(user: AuthUser, dto: CreatePlanDto, meta: RequestMeta) {
    const id = await this.prisma.$transaction(async (tx) => {
      if (await tx.plan.findUnique({ where: { code: dto.code }, select: { id: true } })) throw conflict('Já existe um plano com este código');
      const plan = await tx.plan.create({
        data: {
          code: dto.code,
          name: dto.name,
          description: dto.description ?? null,
          price: dto.price,
          interval: dto.interval,
          maxVehicles: dto.maxVehicles ?? null,
          maxUsers: dto.maxUsers ?? null,
          isPublic: dto.isPublic ?? true,
          sortOrder: dto.sortOrder ?? 0,
          features: { create: (dto.features ?? []).map((f) => ({ key: f.key, enabled: f.enabled })) },
        },
        include: { features: true },
      });
      await this.audit.log({ actorUserId: user.userId, action: 'platform.plan.created', entityType: 'Plan', entityId: plan.id, after: planAudit(plan), meta }, tx);
      return plan.id;
    });
    return this.planById(id);
  }

  async updatePlan(user: AuthUser, id: string, dto: UpdatePlanDto, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.plan.findUnique({ where: { id }, include: { features: true } });
      if (!before) throw notFound('Plano não encontrado');
      if (dto.status === 'ARCHIVED' && before.status !== 'ARCHIVED') {
        const settings = await this.settings.get(tx);
        if (settings.defaultPlan?.id === id) throw businessRule('Este é o plano padrão das novas empresas. Escolha outro plano padrão antes de arquivar.');
      }
      const { features, ...fields } = dto;
      const after = await tx.plan.update({
        where: { id },
        data: {
          ...fields,
          ...(features
            ? {
                features: {
                  deleteMany: {},
                  create: features.map((f) => ({ key: f.key, enabled: f.enabled })),
                },
              }
            : {}),
        },
        include: { features: true },
      });
      await this.audit.log(
        { actorUserId: user.userId, action: 'platform.plan.updated', entityType: 'Plan', entityId: id, before: planAudit(before), after: planAudit(after), meta },
        tx,
      );
    });
    return this.planById(id);
  }

  private async planById(id: string) {
    const [plan, count, settings] = await Promise.all([
      this.prisma.plan.findUniqueOrThrow({ where: { id }, include: { features: true } }),
      this.prisma.subscription.count({ where: { planId: id, status: { not: 'CANCELED' } } }),
      this.settings.get(),
    ]);
    return planDto(plan, count, settings.defaultPlan?.id === id);
  }

  // -------------------------------------------------------------------------
  // Assinaturas
  // -------------------------------------------------------------------------

  async listSubscriptions(q: ListSubscriptionsQueryDto) {
    const now = new Date();
    const where: Prisma.SubscriptionWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.planId ? { planId: q.planId } : {}),
      ...(q.trialEnding ? { status: 'TRIALING', trialEndsAt: { lte: addDays(now, 7) } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        select: { ...SUBSCRIPTION_FIELDS, company: { select: { id: true, tradeName: true, status: true } } },
        orderBy: q.trialEnding ? [{ trialEndsAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.subscription.count({ where }),
    ]);
    const usage = await this.usageOf(rows.map((r) => r.companyId));
    return { items: rows.map((r) => subscriptionDto(r, usageFor(usage, r.companyId, r))), total, page: q.page, pageSize: q.pageSize };
  }

  async updateSubscription(user: AuthUser, id: string, dto: UpdateSubscriptionDto, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM subscriptions WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked.length) throw notFound('Assinatura não encontrada');
      const before = await tx.subscription.findUniqueOrThrow({ where: { id }, select: SUBSCRIPTION_FIELDS });
      if (dto.planId && dto.planId !== before.plan.id) {
        const plan = await tx.plan.findUnique({ where: { id: dto.planId }, select: { status: true } });
        if (!plan) throw notFound('Plano não encontrado');
        if (plan.status !== 'ACTIVE') throw businessRule('Este plano está arquivado e não aceita novas assinaturas');
      }
      const data: Prisma.SubscriptionUncheckedUpdateInput = {};
      if (dto.planId !== undefined) data.planId = dto.planId;
      if (dto.status !== undefined && dto.status !== before.status) {
        data.status = dto.status;
        data.canceledAt = dto.status === 'CANCELED' ? new Date() : null;
        // Ativar manualmente abre um novo período a partir de hoje e encerra o teste.
        if (dto.status === 'ACTIVE') {
          data.currentPeriodStart = new Date();
          data.trialEndsAt = null;
        }
      }
      if (dto.trialEndsAt !== undefined) data.trialEndsAt = dto.trialEndsAt === null ? null : parseDate(dto.trialEndsAt);
      if (dto.currentPeriodEnd !== undefined) data.currentPeriodEnd = dto.currentPeriodEnd === null ? null : parseDate(dto.currentPeriodEnd);
      if (dto.overrideMaxVehicles !== undefined) data.overrideMaxVehicles = dto.overrideMaxVehicles;
      if (dto.overrideMaxUsers !== undefined) data.overrideMaxUsers = dto.overrideMaxUsers;
      const status = (data.status as string | undefined) ?? before.status;
      if (status === 'TRIALING' && !(data.trialEndsAt ?? before.trialEndsAt)) throw businessRule('Informe até quando vai o período de teste');
      if (!Object.keys(data).length) throw businessRule('Nada para alterar');
      const after = await tx.subscription.update({ where: { id }, data, select: SUBSCRIPTION_FIELDS });
      await this.audit.log(
        {
          companyId: before.companyId,
          actorUserId: user.userId,
          action: 'platform.subscription.updated',
          entityType: 'Subscription',
          entityId: id,
          before: subscriptionAudit(before),
          after: subscriptionAudit(after),
          reason: dto.reason,
          meta,
        },
        tx,
      );
    });
    return this.subscriptionById(id);
  }

  private async subscriptionById(id: string) {
    const row = await this.prisma.subscription.findUniqueOrThrow({
      where: { id },
      select: { ...SUBSCRIPTION_FIELDS, company: { select: { id: true, tradeName: true, status: true } } },
    });
    const usage = await this.usageOf([row.companyId]);
    return subscriptionDto(row, usageFor(usage, row.companyId, row));
  }

  // -------------------------------------------------------------------------
  // Configurações
  // -------------------------------------------------------------------------

  async getSettings() {
    const s = await this.settings.get();
    return { ...s, billing: this.billing.status() };
  }

  async updateSettings(user: AuthUser, dto: UpdatePlatformSettingsDto, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx: Tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('platform_settings'))`;
      const before = await this.settings.get(tx);
      if (dto.defaultPlanId) {
        const plan = await tx.plan.findUnique({ where: { id: dto.defaultPlanId }, select: { status: true } });
        if (!plan) throw notFound('Plano não encontrado');
        if (plan.status !== 'ACTIVE') throw businessRule('O plano padrão precisa estar ativo');
      }
      const values = {
        allowNewCompanies: dto.allowNewCompanies ?? before.allowNewCompanies,
        defaultPlanId: dto.defaultPlanId ?? before.defaultPlan?.id ?? null,
        trialDays: dto.trialDays ?? before.trialDays,
        supportEmail: dto.supportEmail !== undefined ? dto.supportEmail : before.supportEmail,
        updatedById: user.userId,
      };
      await tx.platformSettings.upsert({ where: { id: 1 }, create: { id: 1, ...values }, update: values });
      const after = await this.settings.get(tx);
      await this.audit.log(
        { actorUserId: user.userId, action: 'platform.settings.updated', entityType: 'PlatformSettings', entityId: '1', before: settingsAudit(before), after: settingsAudit(after), meta },
        tx,
      );
    });
    return this.getSettings();
  }

  // -------------------------------------------------------------------------
  // Auxiliares
  // -------------------------------------------------------------------------

  /** Contagens de uso por empresa (sem nenhum valor financeiro). */
  private async usageOf(companyIds: string[]) {
    if (!companyIds.length) return { users: new Map<string, number>(), vehicles: new Map<string, number>() };
    const now = new Date();
    const [members, invitations, vehicles] = await Promise.all([
      this.prisma.companyMember.groupBy({ by: ['companyId'], where: { companyId: { in: companyIds }, status: 'ACTIVE' }, _count: { _all: true } }),
      this.prisma.companyInvitation.groupBy({ by: ['companyId'], where: { companyId: { in: companyIds }, status: 'PENDING', expiresAt: { gt: now } }, _count: { _all: true } }),
      this.prisma.vehicle.groupBy({ by: ['companyId'], where: { companyId: { in: companyIds }, archivedAt: null }, _count: { _all: true } }),
    ]);
    const users = new Map<string, number>();
    for (const r of [...members, ...invitations]) users.set(r.companyId, (users.get(r.companyId) ?? 0) + r._count._all);
    return { users, vehicles: new Map(vehicles.map((r) => [r.companyId, r._count._all])) };
  }

  private async historyOf(companyId: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: { companyId, OR: [{ action: { startsWith: 'platform.' } }, { action: { startsWith: 'billing.' } }, { action: { in: ['support.granted', 'support.revoked', 'support.session_started'] } }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => !!v))];
    const actors = new Map(
      (await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } })).map((u) => [u.id, u]),
    );
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      reason: r.reason,
      actor: r.actorUserId ? (actors.get(r.actorUserId) ?? null) : null,
      createdAt: r.createdAt,
      before: r.before,
      after: r.after,
    }));
  }
}

const COMPANY_STATUS_LABELS: Record<string, string> = { ACTIVE: 'ativa', SUSPENDED: 'suspensa', CANCELED: 'cancelada' };

function subscriptionSummary(s: SubscriptionRow) {
  return { id: s.id, status: s.status, plan: { id: s.plan.id, code: s.plan.code, name: s.plan.name }, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd };
}

function usageFor(usage: { users: Map<string, number>; vehicles: Map<string, number> }, companyId: string, s: SubscriptionRow | null) {
  return {
    users: usage.users.get(companyId) ?? 0,
    vehicles: usage.vehicles.get(companyId) ?? 0,
    maxUsers: s ? (s.overrideMaxUsers ?? s.plan.maxUsers) : null,
    maxVehicles: s ? (s.overrideMaxVehicles ?? s.plan.maxVehicles) : null,
  };
}

function subscriptionDto(r: SubscriptionRow & { company: { id: string; tradeName: string; status: 'ACTIVE' | 'SUSPENDED' | 'CANCELED' } }, usage: ReturnType<typeof usageFor>) {
  const warnings: string[] = [];
  if (usage.maxVehicles !== null && usage.vehicles > usage.maxVehicles)
    warnings.push(`Usa ${usage.vehicles} veículo(s), acima do limite de ${usage.maxVehicles}. Nada é apagado; novos cadastros ficam bloqueados.`);
  if (usage.maxUsers !== null && usage.users > usage.maxUsers)
    warnings.push(`Tem ${usage.users} usuário(s), acima do limite de ${usage.maxUsers}. Ninguém perde acesso; novos convites ficam bloqueados.`);
  return {
    id: r.id,
    company: r.company,
    plan: { id: r.plan.id, code: r.plan.code, name: r.plan.name },
    status: r.status,
    trialEndsAt: r.trialEndsAt,
    currentPeriodStart: r.currentPeriodStart,
    currentPeriodEnd: r.currentPeriodEnd,
    canceledAt: r.canceledAt,
    overrideMaxVehicles: r.overrideMaxVehicles,
    overrideMaxUsers: r.overrideMaxUsers,
    externalProvider: r.externalProvider,
    usage,
    warnings,
  };
}

type PlanWithFeatures = Prisma.PlanGetPayload<{ include: { features: true } }>;

function planDto(p: PlanWithFeatures, subscriptions: number, isDefault: boolean) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    price: fromCents(toCents(p.price)),
    currency: p.currency,
    interval: p.interval,
    maxVehicles: p.maxVehicles,
    maxUsers: p.maxUsers,
    status: p.status,
    isPublic: p.isPublic,
    sortOrder: p.sortOrder,
    features: p.features.map((f) => ({ key: f.key, label: FEATURE_LABELS.get(f.key) ?? f.key, enabled: f.enabled })).sort((a, b) => a.key.localeCompare(b.key)),
    subscriptions,
    isDefault,
  };
}

function planAudit(p: PlanWithFeatures) {
  const { features, createdAt: _c, updatedAt: _u, ...rest } = p;
  return { ...rest, price: fromCents(toCents(p.price)), features: features.filter((f) => f.enabled).map((f) => f.key).sort() };
}

function subscriptionAudit(s: SubscriptionRow) {
  return {
    status: s.status,
    plan: s.plan.code,
    trialEndsAt: s.trialEndsAt,
    currentPeriodEnd: s.currentPeriodEnd,
    overrideMaxVehicles: s.overrideMaxVehicles,
    overrideMaxUsers: s.overrideMaxUsers,
  };
}

function settingsAudit(s: Awaited<ReturnType<PlatformSettingsService['get']>>) {
  return { allowNewCompanies: s.allowNewCompanies, defaultPlan: s.defaultPlan?.code ?? null, trialDays: s.trialDays, supportEmail: s.supportEmail };
}


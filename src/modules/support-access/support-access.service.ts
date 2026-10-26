import { Injectable, Logger } from '@nestjs/common';
import { conflict, notFound } from '../../common/errors';
import type { AuthUser, RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { TenantResolver } from '../../common/tenant/tenant-resolver.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { MailService } from '../mail/mail.service';
import { PlatformSettingsService } from '../subscriptions/platform-settings.service';
import type { CreateSupportGrantDto } from './support-access.dto';

const GRANT_SELECT = {
  id: true,
  reason: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
  grantedBy: { select: { id: true, name: true } },
  revokedBy: { select: { id: true, name: true } },
} as const;

/**
 * Acesso do suporte da plataforma aos dados de uma empresa (§5): só com
 * autorização do dono, por no máximo 72 h, somente leitura e com cada leitura
 * auditada e visível para o dono. O dono pode revogar a qualquer momento.
 */
@Injectable()
export class SupportAccessService {
  private readonly logger = new Logger(SupportAccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenants: TenantResolver,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly settings: PlatformSettingsService,
  ) {}

  // -------------------------------------------------------------------------
  // Lado da empresa (dono)
  // -------------------------------------------------------------------------

  async overview(ctx: TenantContext) {
    const grants = await this.prisma.supportGrant.findMany({
      where: { companyId: ctx.companyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: GRANT_SELECT,
    });
    const counts = await this.prisma.auditLog.groupBy({
      by: ['entityId'],
      where: { companyId: ctx.companyId, action: 'support.request', entityId: { in: grants.map((g) => g.id) } },
      _count: { _all: true },
    });
    const countOf = new Map(counts.map((c) => [c.entityId, c._count._all]));
    const now = new Date();
    const items = grants.map((g) => toGrantDto(g, countOf.get(g.id) ?? 0, now));
    const { supportEmail } = await this.settings.get();
    return { active: items.find((g) => g.status === 'ACTIVE') ?? null, grants: items, supportEmail };
  }

  async grant(ctx: TenantContext, dto: CreateSupportGrantDto, meta: RequestMeta) {
    const created = await this.prisma.$transaction(async (tx) => {
      // Uma autorização por vez: serializa pedidos simultâneos da mesma empresa.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('support_grant'), hashtext(${ctx.companyId}))`;
      const active = await tx.supportGrant.findFirst({
        where: { companyId: ctx.companyId, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (active) throw conflict('Já existe uma autorização ativa. Revogue-a antes de criar outra.');
      const grant = await tx.supportGrant.create({
        data: {
          companyId: ctx.companyId,
          grantedById: ctx.userId,
          reason: dto.reason,
          expiresAt: new Date(Date.now() + dto.hours * 3_600_000),
        },
        select: GRANT_SELECT,
      });
      await this.audit.log(
        {
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'support.granted',
          entityType: 'SupportGrant',
          entityId: grant.id,
          after: { expiresAt: grant.expiresAt, hours: dto.hours },
          reason: dto.reason,
          meta,
        },
        tx,
      );
      return grant;
    });
    await this.notifyPlatform(ctx.companyId, created.expiresAt, dto.reason);
    return toGrantDto(created, 0, new Date());
  }

  async revoke(ctx: TenantContext, id: string, meta: RequestMeta) {
    const grant = await this.prisma.$transaction(async (tx) => {
      const current = await tx.supportGrant.findFirst({ where: { id, companyId: ctx.companyId }, select: { revokedAt: true, expiresAt: true } });
      if (!current) throw notFound('Autorização não encontrada');
      if (current.revokedAt || current.expiresAt <= new Date()) throw conflict('Esta autorização já não está ativa');
      const updated = await tx.supportGrant.update({
        where: { id },
        data: { revokedAt: new Date(), revokedById: ctx.userId },
        select: GRANT_SELECT,
      });
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'support.revoked', entityType: 'SupportGrant', entityId: id, meta },
        tx,
      );
      return updated;
    });
    const accessCount = await this.prisma.auditLog.count({ where: { companyId: ctx.companyId, action: 'support.request', entityId: id } });
    return toGrantDto(grant, accessCount, new Date());
  }

  async log(ctx: TenantContext, id: string) {
    const grant = await this.prisma.supportGrant.findFirst({ where: { id, companyId: ctx.companyId }, select: { id: true } });
    if (!grant) throw notFound('Autorização não encontrada');
    const rows = await this.prisma.auditLog.findMany({
      where: { companyId: ctx.companyId, action: 'support.request', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { createdAt: true, actorUserId: true, after: true },
    });
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => !!v))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } });
    const nameOf = new Map(actors.map((a) => [a.id, a.name]));
    return rows.map((r) => {
      const after = (r.after ?? {}) as { method?: string; path?: string };
      return {
        at: r.createdAt,
        actorName: r.actorUserId ? (nameOf.get(r.actorUserId) ?? null) : null,
        method: after.method ?? 'GET',
        path: after.path ?? '',
      };
    });
  }

  // -------------------------------------------------------------------------
  // Lado da plataforma (SUPER_ADMIN)
  // -------------------------------------------------------------------------

  /** Abre a empresa no modo suporte: só com autorização vigente. */
  async startSession(user: AuthUser, companyId: string, meta: RequestMeta) {
    const ctx = await this.tenants.tryResolve(user.userId, companyId, { allowSupport: true });
    if (!ctx || ctx === 'SUSPENDED' || !ctx.support) {
      throw conflict('Esta empresa não autorizou o acesso do suporte, ou a autorização terminou.');
    }
    await this.sessions.setActiveCompany(user.sessionId, companyId);
    await this.audit.log({
      companyId,
      actorUserId: user.userId,
      action: 'support.session_started',
      entityType: 'SupportGrant',
      entityId: ctx.support.grantId,
      meta,
    });
    return this.auth.accessFor(user.userId, user.sessionId, companyId);
  }

  async endSession(user: AuthUser, meta: RequestMeta) {
    const companyId = user.claimedCompanyId;
    await this.sessions.setActiveCompany(user.sessionId, null);
    if (companyId) {
      await this.audit.log({ companyId, actorUserId: user.userId, action: 'support.session_ended', entityType: 'Company', entityId: companyId, meta });
    }
    return this.auth.accessFor(user.userId, user.sessionId, null);
  }

  /** Avisa o e-mail de suporte da plataforma (se configurado). Falha de envio não desfaz a autorização. */
  private async notifyPlatform(companyId: string, expiresAt: Date, reason: string) {
    const { supportEmail } = await this.settings.get();
    if (!supportEmail) return;
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { tradeName: true } });
    try {
      await this.mail.send({
        to: supportEmail,
        subject: `RotaGest — ${company?.tradeName ?? 'Uma empresa'} autorizou o acesso do suporte`,
        text: `A empresa ${company?.tradeName ?? companyId} autorizou o acesso do suporte até ${expiresAt.toISOString()}.\nMotivo: ${reason}`,
      });
    } catch (err) {
      this.logger.warn(`Falha ao avisar o suporte: ${(err as Error).message}`);
    }
  }
}

type GrantRow = {
  id: string;
  reason: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  grantedBy: { id: string; name: string };
  revokedBy: { id: string; name: string } | null;
};

function toGrantDto(g: GrantRow, accessCount: number, now: Date) {
  const status = g.revokedAt ? 'REVOKED' : g.expiresAt <= now ? 'EXPIRED' : 'ACTIVE';
  return { ...g, status: status as 'ACTIVE' | 'EXPIRED' | 'REVOKED', accessCount };
}

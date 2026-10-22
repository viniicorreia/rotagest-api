import { Injectable } from '@nestjs/common';
import { MEMBER_ROLE_LABELS, resolvePermissions } from '../../domain';
import { ErrorCode, conflict, unauthorized } from '../../common/errors';
import type { AuthUser, RequestMeta } from '../../common/tenant/tenant-context';
import { BLOCKED_SUBSCRIPTION, TenantResolver, effectiveCompanyStatus } from '../../common/tenant/tenant-resolver.service';
import { addMinutes } from '../../common/utils/dates';
import { generateToken, sha256 } from '../../common/utils/crypto';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordService } from './password.service';
import { SessionService, type IssuedSession } from './session.service';

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  activeCompanyId: string | null;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly tenants: TenantResolver,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta): Promise<AuthResult> {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } });
    if (exists) throw conflict('Este e-mail já está cadastrado. Entre ou recupere sua senha.');

    const user = await this.prisma.user.create({
      data: { name: dto.name, email: dto.email, passwordHash: await this.passwords.hash(dto.password) },
    });
    await this.audit.log({ actorUserId: user.id, action: 'auth.registered', entityType: 'User', entityId: user.id, meta });
    return this.issue(await this.sessions.create(user.id, null, meta));
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      await this.passwords.burn(dto.password);
      throw unauthorized('E-mail ou senha inválidos', ErrorCode.INVALID_CREDENTIALS);
    }
    const valid = await this.passwords.verify(user.passwordHash, dto.password);
    if (!valid || user.status !== 'ACTIVE') {
      await this.audit.log({ actorUserId: user.id, action: 'auth.login_failed', entityType: 'User', entityId: user.id, meta });
      throw unauthorized('E-mail ou senha inválidos', ErrorCode.INVALID_CREDENTIALS);
    }

    const data: { lastLoginAt: Date; passwordHash?: string } = { lastLoginAt: new Date() };
    if (this.passwords.needsRehash(user.passwordHash)) data.passwordHash = await this.passwords.hash(dto.password);
    await this.prisma.user.update({ where: { id: user.id }, data });

    const companyId = await this.pickDefaultCompany(user.id);
    await this.audit.log({ companyId, actorUserId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id, meta });
    return this.issue(await this.sessions.create(user.id, companyId, meta));
  }

  async refresh(refreshToken: string | undefined, meta: RequestMeta): Promise<AuthResult> {
    if (!refreshToken) throw unauthorized('Sessão expirada', ErrorCode.SESSION_EXPIRED);
    const session = await this.sessions.rotate(refreshToken, meta);
    // A empresa ativa gravada na sessão é revalidada: vínculo removido → sem empresa.
    // Uma sessão de suporte continua só enquanto a autorização do dono valer.
    if (session.activeCompanyId) {
      const ctx = await this.tenants.tryResolve(session.userId, session.activeCompanyId, { allowSupport: true });
      if (!ctx || ctx === 'SUSPENDED') {
        await this.sessions.setActiveCompany(session.sessionId, null);
        session.activeCompanyId = null;
      }
    }
    return this.issue(session);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.sessions.revokeByToken(refreshToken);
  }

  async logoutAll(user: AuthUser, meta: RequestMeta): Promise<void> {
    await this.sessions.revokeAllForUser(user.userId);
    await this.audit.log({ actorUserId: user.userId, action: 'auth.logout_all', entityType: 'User', entityId: user.userId, meta });
  }

  /** Troca a empresa ativa após validar o vínculo no banco; o refresh token não muda. */
  async switchCompany(user: AuthUser, companyId: string, meta: RequestMeta): Promise<Omit<AuthResult, 'refreshToken'>> {
    await this.tenants.resolve(user.userId, companyId);
    await this.sessions.setActiveCompany(user.sessionId, companyId);
    await this.audit.log({ companyId, actorUserId: user.userId, action: 'auth.company_switched', entityType: 'Company', entityId: companyId, meta });
    return this.accessFor(user.userId, user.sessionId, companyId);
  }

  async accessFor(userId: string, sessionId: string, companyId: string | null): Promise<Omit<AuthResult, 'refreshToken'>> {
    return {
      accessToken: await this.sessions.signAccessToken(userId, sessionId, companyId),
      expiresIn: this.sessions.accessTtlSeconds,
      activeCompanyId: companyId,
    };
  }

  async me(user: AuthUser) {
    const memberships = await this.prisma.companyMember.findMany({
      where: { userId: user.userId, status: 'ACTIVE' },
      select: {
        role: true,
        permissions: true,
        company: { select: { id: true, tradeName: true, status: true, subscription: { select: { status: true } } } },
      },
      orderBy: { company: { tradeName: 'asc' } },
    });
    const companies = memberships.map((m) => ({
      id: m.company.id,
      tradeName: m.company.tradeName,
      status: effectiveCompanyStatus(m.company),
      role: m.role,
      roleLabel: MEMBER_ROLE_LABELS[m.role],
    }));
    const active = memberships.find(
      (m) => m.company.id === user.claimedCompanyId && effectiveCompanyStatus(m.company) === 'ACTIVE',
    );
    return {
      user: { id: user.userId, name: user.name, email: user.email, platformRole: user.platformRole },
      companies,
      activeCompany: active
        ? {
            id: active.company.id,
            tradeName: active.company.tradeName,
            role: active.role,
            permissions: resolvePermissions(active.role, active.permissions),
            support: null,
          }
        : await this.supportCompany(user),
    };
  }

  /** Empresa aberta pelo suporte da plataforma com autorização vigente do dono. */
  private async supportCompany(user: AuthUser) {
    if (user.platformRole !== 'SUPER_ADMIN' || !user.claimedCompanyId) return null;
    const ctx = await this.tenants.tryResolve(user.userId, user.claimedCompanyId, { allowSupport: true });
    if (!ctx || ctx === 'SUSPENDED' || !ctx.support) return null;
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { tradeName: true } });
    return {
      id: ctx.companyId,
      tradeName: company.tradeName,
      role: ctx.role,
      permissions: [...ctx.permissions],
      support: { expiresAt: ctx.support.expiresAt },
    };
  }

  /** Sempre responde igual, exista ou não o e-mail. */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;

    const token = generateToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: addMinutes(new Date(), this.config.get('PASSWORD_RESET_TTL_MINUTES')),
      },
    });
    const url = `${this.config.get('WEB_URL')}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mail.send({
      to: user.email,
      subject: 'RotaGest — redefinição de senha',
      text: `Olá, ${user.name}. Para criar uma nova senha, acesse: ${url}\nSe você não pediu, ignore este e-mail.`,
      actionUrl: url,
    });
    await this.audit.log({ actorUserId: user.id, action: 'auth.password_reset_requested', entityType: 'User', entityId: user.id, meta });
  }

  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) {
      throw unauthorized('Link inválido ou expirado. Solicite um novo.', ErrorCode.SESSION_EXPIRED);
    }
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw unauthorized('Link inválido ou expirado. Solicite um novo.', ErrorCode.SESSION_EXPIRED);
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await this.sessions.revokeAllForUser(record.userId, tx);
      await this.audit.log(
        { actorUserId: record.userId, action: 'auth.password_reset', entityType: 'User', entityId: record.userId, meta },
        tx,
      );
    });
  }

  private async issue(session: IssuedSession): Promise<AuthResult> {
    return {
      ...(await this.accessFor(session.userId, session.sessionId, session.activeCompanyId)),
      refreshToken: session.refreshToken,
    };
  }

  /** Última empresa usada (se ainda válida) ou a primeira empresa ativa do usuário. */
  private async pickDefaultCompany(userId: string): Promise<string | null> {
    const last = await this.prisma.refreshSession.findFirst({
      where: { userId, activeCompanyId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { activeCompanyId: true },
    });
    if (last?.activeCompanyId) {
      const ctx = await this.tenants.tryResolve(userId, last.activeCompanyId);
      if (ctx && ctx !== 'SUSPENDED') return ctx.companyId;
    }
    const first = await this.prisma.companyMember.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        company: { status: 'ACTIVE', OR: [{ subscription: null }, { subscription: { status: { notIn: [...BLOCKED_SUBSCRIPTION] } } }] },
      },
      orderBy: { joinedAt: 'asc' },
      select: { companyId: true },
    });
    return first?.companyId ?? null;
  }
}

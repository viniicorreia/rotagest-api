import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { AccessTokenPayload } from '../../common/guards/jwt-auth.guard';
import { ErrorCode, unauthorized } from '../../common/errors';
import type { RequestMeta } from '../../common/tenant/tenant-context';
import { addDays } from '../../common/utils/dates';
import { generateToken, sha256 } from '../../common/utils/crypto';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface IssuedSession {
  sessionId: string;
  userId: string;
  refreshToken: string;
  activeCompanyId: string | null;
}

/**
 * Sessões de refresh com rotação e detecção de reuso (docs/ARCHITECTURE.md §7.2).
 * O valor do refresh token nunca é persistido, apenas seu SHA-256.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.get('JWT_ACCESS_TTL_SECONDS');
  }

  get refreshTtlMs(): number {
    return this.config.get('REFRESH_TOKEN_TTL_DAYS') * 86_400_000;
  }

  signAccessToken(userId: string, sessionId: string, companyId: string | null): Promise<string> {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, cid: companyId };
    return this.jwt.signAsync(payload, { algorithm: 'HS256', expiresIn: this.accessTtlSeconds });
  }

  async create(
    userId: string,
    activeCompanyId: string | null,
    meta: RequestMeta,
    familyId: string = randomUUID(),
    tx?: Tx,
  ): Promise<IssuedSession> {
    const refreshToken = generateToken();
    const session = await (tx ?? this.prisma).refreshSession.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        activeCompanyId,
        expiresAt: addDays(new Date(), this.config.get('REFRESH_TOKEN_TTL_DAYS')),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { sessionId: session.id, userId, refreshToken, activeCompanyId };
  }

  /**
   * Troca um refresh token válido por um novo da mesma família. Reapresentar um
   * token já rotacionado revoga a família inteira (indício de roubo).
   */
  async rotate(refreshToken: string, meta: RequestMeta): Promise<IssuedSession> {
    const current = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { select: { status: true } } },
    });
    if (!current || current.revokedAt || current.expiresAt <= new Date() || current.user.status !== 'ACTIVE') {
      throw unauthorized('Sessão expirada', ErrorCode.SESSION_EXPIRED);
    }
    if (current.rotatedAt) {
      await this.revokeFamily(current.familyId);
      await this.audit.log({
        actorUserId: current.userId,
        action: 'auth.refresh_reuse_detected',
        entityType: 'RefreshSession',
        entityId: current.id,
        meta,
      });
      throw unauthorized('Sessão encerrada por segurança. Entre novamente.', ErrorCode.SESSION_EXPIRED);
    }

    return this.prisma.$transaction(async (tx) => {
      // Marca como rotacionado de forma atômica: só uma requisição concorrente vence.
      const claimed = await tx.refreshSession.updateMany({
        where: { id: current.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: new Date() },
      });
      if (claimed.count !== 1) throw unauthorized('Sessão expirada', ErrorCode.SESSION_EXPIRED);
      return this.create(current.userId, current.activeCompanyId, meta, current.familyId, tx);
    });
  }

  /**
   * Grava a empresa ativa em toda a família da sessão, para que o próximo
   * refresh (feito com o token mais recente da família) a preserve.
   */
  async setActiveCompany(sessionId: string, companyId: string | null, tx?: Tx): Promise<void> {
    const client = tx ?? this.prisma;
    const session = await client.refreshSession.findUnique({ where: { id: sessionId }, select: { familyId: true } });
    if (!session) return;
    await client.refreshSession.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { activeCompanyId: companyId },
    });
  }

  async revokeByToken(refreshToken: string): Promise<void> {
    const session = await this.prisma.refreshSession.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (session) await this.revokeFamily(session.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string, tx?: Tx): Promise<void> {
    await (tx ?? this.prisma).refreshSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

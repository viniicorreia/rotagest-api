import { Injectable } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { conflict, ErrorCode, unauthorized } from '../../common/errors';
import type { AuthUser, RequestMeta } from '../../common/tenant/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';

/**
 * Direitos do titular (LGPD) sobre os próprios dados de usuário. Dados que
 * pertencem à empresa (lançamentos, relatórios) seguem com a empresa, que é a
 * controladora; ver docs/PRIVACY.md.
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
  ) {}

  async export(user: AuthUser, meta: RequestMeta) {
    const userId = user.userId;
    const [profile, memberships, sessions, activity] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, email: true, platformRole: true, status: true, createdAt: true, updatedAt: true, lastLoginAt: true },
      }),
      this.prisma.companyMember.findMany({
        where: { userId },
        select: {
          id: true,
          role: true,
          permissions: true,
          status: true,
          joinedAt: true,
          deactivatedAt: true,
          company: { select: { id: true, tradeName: true } },
          driver: { select: { id: true, name: true, document: true, phone: true, hiredAt: true, employmentType: true, status: true } },
        },
        orderBy: { joinedAt: 'asc' },
      }),
      this.prisma.refreshSession.findMany({
        where: { userId },
        select: { createdAt: true, expiresAt: true, revokedAt: true, ip: true, userAgent: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.findMany({
        where: { actorUserId: userId },
        select: { createdAt: true, action: true, entityType: true, companyId: true, ip: true, userAgent: true },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      }),
    ]);
    const invitations = await this.prisma.companyInvitation.findMany({
      where: { OR: [{ email: profile.email }, { acceptedById: userId }] },
      select: { email: true, role: true, status: true, createdAt: true, expiresAt: true, company: { select: { tradeName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    await this.audit.log({ actorUserId: userId, action: 'privacy.data_exported', entityType: 'User', entityId: userId, meta });
    return {
      generatedAt: new Date(),
      user: profile,
      memberships: memberships.map(({ driver: _driver, ...m }) => m),
      driverProfiles: memberships.filter((m) => m.driver).map((m) => ({ company: m.company, ...m.driver })),
      sessions,
      invitations,
      activity,
    };
  }

  /**
   * Exclusão da conta a pedido do titular: anonimiza nome e e-mail, invalida a
   * senha, encerra sessões e vínculos. Registros financeiros feitos pelo
   * usuário ficam com a empresa, ligados ao identificador anônimo.
   */
  async deleteAccount(user: AuthUser, password: string, meta: RequestMeta): Promise<void> {
    const record = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { passwordHash: true, platformRole: true, email: true } });
    if (!(await this.passwords.verify(record.passwordHash, password))) {
      throw unauthorized('Senha incorreta', ErrorCode.INVALID_CREDENTIALS);
    }
    if (record.platformRole === 'SUPER_ADMIN') {
      throw conflict('Administradores da plataforma não podem excluir a própria conta por aqui.', ErrorCode.ACCOUNT_OWNS_COMPANY);
    }
    const owned = await this.prisma.companyMember.findMany({
      where: { userId: user.userId, role: 'OWNER', status: 'ACTIVE', company: { status: { not: 'CANCELED' } } },
      select: { company: { select: { tradeName: true } } },
    });
    if (owned.length) {
      const names = owned.map((o) => o.company.tradeName).join(', ');
      throw conflict(
        `Você é dono de ${names}. Passe a propriedade a outro membro ou peça o cancelamento da empresa ao suporte antes de excluir a conta.`,
        ErrorCode.ACCOUNT_OWNS_COMPANY,
      );
    }

    const passwordHash = await this.passwords.hash(randomBytes(32).toString('base64url'));
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.userId },
        data: { name: 'Conta excluída', email: `excluida-${randomUUID()}@anonimo.invalid`, passwordHash, status: 'DISABLED', anonymizedAt: now },
      });
      await tx.companyMember.updateMany({ where: { userId: user.userId, status: 'ACTIVE' }, data: { status: 'INACTIVE', deactivatedAt: now } });
      await tx.companyInvitation.updateMany({ where: { email: record.email, status: 'PENDING' }, data: { status: 'REVOKED' } });
      await tx.passwordResetToken.deleteMany({ where: { userId: user.userId } });
      await this.sessions.revokeAllForUser(user.userId, tx);
      // O e-mail antigo não vai para a auditoria.
      await this.audit.log({ actorUserId: user.userId, action: 'privacy.account_deleted', entityType: 'User', entityId: user.userId, meta }, tx);
    });
  }
}

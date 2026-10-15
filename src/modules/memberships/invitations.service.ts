import { Injectable } from '@nestjs/common';
import type { CompanyInvitation } from '@prisma/client';
import { MEMBER_ROLE_LABELS } from '../../domain';
import { conflict, forbidden, notFound } from '../../common/errors';
import type { AuthUser, RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { addDays } from '../../common/utils/dates';
import { generateToken, sha256 } from '../../common/utils/crypto';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { MailService } from '../mail/mail.service';
import { PlanLimitsService } from '../subscriptions/plan-limits.service';
import type { InviteMemberDto } from './dto/membership.dto';
import { assertCanTouchRole } from './member-rules';

type InvitationView = ReturnType<InvitationsService['present']>;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: PlanLimitsService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  async list(ctx: TenantContext): Promise<InvitationView[]> {
    const rows = await this.prisma.companyInvitation.findMany({
      where: { companyId: ctx.companyId, status: { in: ['PENDING', 'EXPIRED'] } },
      orderBy: { createdAt: 'desc' },
      include: { invitedBy: { select: { name: true } } },
    });
    return rows.map((r) => this.present(r, r.invitedBy.name));
  }

  /**
   * Cria um convite. Um convite pendente para o mesmo e-mail é substituído.
   * Retorna o link para que o proprietário também possa compartilhá-lo
   * diretamente (ex.: WhatsApp); só quem tem members:manage chega aqui.
   */
  async create(ctx: TenantContext, dto: InviteMemberDto, meta: RequestMeta) {
    assertCanTouchRole(ctx, dto.role);
    const token = generateToken();

    const invitation = await this.prisma.$transaction(async (tx) => {
      const existingMember = await tx.companyMember.findFirst({
        where: { companyId: ctx.companyId, user: { email: dto.email } },
        select: { status: true },
      });
      if (existingMember?.status === 'ACTIVE') throw conflict('Esta pessoa já é membro da empresa');
      if (existingMember) throw conflict('Esta pessoa já é membro (desativado). Reative o acesso na lista de membros.');

      const replaced = await tx.companyInvitation.updateMany({
        where: { companyId: ctx.companyId, email: dto.email, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await this.limits.assertCanAddUsers(tx, ctx.companyId, replaced.count > 0 ? 0 : 1);

      const created = await tx.companyInvitation.create({
        data: {
          companyId: ctx.companyId,
          email: dto.email,
          role: dto.role,
          permissions: dto.permissions ?? [],
          tokenHash: sha256(token),
          expiresAt: addDays(new Date(), this.config.get('INVITATION_TTL_DAYS')),
          invitedById: ctx.userId,
        },
      });
      await this.audit.log(
        {
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'invitation.created',
          entityType: 'CompanyInvitation',
          entityId: created.id,
          after: { email: created.email, role: created.role, permissions: created.permissions },
          meta,
        },
        tx,
      );
      return created;
    });

    return this.deliver(ctx, invitation, token);
  }

  /** Gera novo link (o anterior deixa de valer) e renova a validade. */
  async resend(ctx: TenantContext, invitationId: string, meta: RequestMeta) {
    const token = generateToken();
    const invitation = await this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, ctx, invitationId);
      assertCanTouchRole(ctx, current.role);
      if (current.status !== 'PENDING' && current.status !== 'EXPIRED') {
        throw conflict('Este convite não pode mais ser reenviado');
      }
      const wasExpired = current.status === 'EXPIRED' || current.expiresAt <= new Date();
      if (wasExpired) await this.limits.assertCanAddUsers(tx, ctx.companyId, 1);

      const updated = await tx.companyInvitation.update({
        where: { id: current.id },
        data: {
          status: 'PENDING',
          tokenHash: sha256(token),
          expiresAt: addDays(new Date(), this.config.get('INVITATION_TTL_DAYS')),
        },
      });
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'invitation.resent', entityType: 'CompanyInvitation', entityId: updated.id, meta },
        tx,
      );
      return updated;
    });
    return this.deliver(ctx, invitation, token);
  }

  async revoke(ctx: TenantContext, invitationId: string, meta: RequestMeta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.load(tx, ctx, invitationId);
      assertCanTouchRole(ctx, current.role);
      if (current.status !== 'PENDING' && current.status !== 'EXPIRED') throw conflict('Este convite não está pendente');
      await tx.companyInvitation.update({ where: { id: current.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
      await this.audit.log(
        { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'invitation.revoked', entityType: 'CompanyInvitation', entityId: current.id, meta },
        tx,
      );
    });
  }

  /** Consulta pública pelo token: só o necessário para a tela de aceite. */
  async preview(token: string) {
    const inv = await this.prisma.companyInvitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { company: { select: { tradeName: true, status: true } }, invitedBy: { select: { name: true } } },
    });
    if (!inv || inv.status === 'REVOKED' || inv.company.status !== 'ACTIVE') throw notFound('Convite não encontrado');
    return {
      companyName: inv.company.tradeName,
      email: inv.email,
      role: inv.role,
      roleLabel: MEMBER_ROLE_LABELS[inv.role],
      invitedBy: inv.invitedBy.name,
      status: this.effectiveStatus(inv),
      expiresAt: inv.expiresAt,
    };
  }

  /** Aceita o convite com o usuário logado e ativa a empresa na sessão. */
  async accept(user: AuthUser, token: string, meta: RequestMeta) {
    const companyId = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.companyInvitation.findUnique({
        where: { tokenHash: sha256(token) },
        include: { company: { select: { status: true } } },
      });
      if (!inv || inv.status === 'REVOKED' || inv.company.status !== 'ACTIVE') throw notFound('Convite não encontrado');
      if (inv.status === 'ACCEPTED') throw conflict('Este convite já foi utilizado');
      if (this.effectiveStatus(inv) === 'EXPIRED') throw conflict('Este convite expirou. Peça um novo ao responsável.');
      if (inv.email !== user.email) {
        throw forbidden(`Este convite foi enviado para outro e-mail. Entre com a conta ${maskEmail(inv.email)}.`);
      }

      // Reivindica o convite de forma atômica: aceite concorrente falha aqui.
      const claimed = await tx.companyInvitation.updateMany({
        where: { id: inv.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user.userId },
      });
      if (claimed.count !== 1) throw conflict('Este convite já foi utilizado');

      const existing = await tx.companyMember.findUnique({
        where: { companyId_userId: { companyId: inv.companyId, userId: user.userId } },
      });
      if (existing?.status === 'ACTIVE') throw conflict('Você já é membro desta empresa');
      const member = existing
        ? await tx.companyMember.update({
            where: { id: existing.id },
            data: { status: 'ACTIVE', role: inv.role, permissions: inv.permissions, deactivatedAt: null },
          })
        : await tx.companyMember.create({
            data: { companyId: inv.companyId, userId: user.userId, role: inv.role, permissions: inv.permissions },
          });

      await this.audit.log(
        {
          companyId: inv.companyId,
          actorUserId: user.userId,
          action: 'invitation.accepted',
          entityType: 'CompanyMember',
          entityId: member.id,
          after: { role: member.role, invitationId: inv.id },
          meta,
        },
        tx,
      );
      await this.sessions.setActiveCompany(user.sessionId, inv.companyId, tx);
      return inv.companyId;
    });
    return this.auth.accessFor(user.userId, user.sessionId, companyId);
  }

  private async deliver(ctx: TenantContext, invitation: CompanyInvitation, token: string) {
    const inviteUrl = `${this.config.get('WEB_URL')}/invite/${encodeURIComponent(token)}`;
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: ctx.companyId }, select: { tradeName: true } });
    await this.mail.send({
      to: invitation.email,
      subject: `Convite para ${company.tradeName} no RotaGest`,
      text: `Você foi convidado(a) para ${company.tradeName} como ${MEMBER_ROLE_LABELS[invitation.role]}. Aceite em: ${inviteUrl}`,
      actionUrl: inviteUrl,
    });
    return { invitation: this.present(invitation), inviteUrl };
  }

  private async load(tx: Tx, ctx: TenantContext, invitationId: string): Promise<CompanyInvitation> {
    const inv = await tx.companyInvitation.findFirst({ where: { id: invitationId, companyId: ctx.companyId } });
    if (!inv) throw notFound('Convite não encontrado');
    return inv;
  }

  private effectiveStatus(inv: Pick<CompanyInvitation, 'status' | 'expiresAt'>) {
    return inv.status === 'PENDING' && inv.expiresAt <= new Date() ? 'EXPIRED' : inv.status;
  }

  present(inv: CompanyInvitation, invitedByName?: string) {
    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      roleLabel: MEMBER_ROLE_LABELS[inv.role],
      permissions: inv.permissions,
      status: this.effectiveStatus(inv),
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
      invitedBy: invitedByName,
    };
  }
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MEMBER_ROLE_LABELS, resolvePermissions } from '../../domain';
import { conflict, notFound } from '../../common/errors';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { PrismaService, type Tx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PlanLimitsService, lockCompany } from '../subscriptions/plan-limits.service';
import type { UpdateMemberDto } from './dto/membership.dto';
import { assertCanTouchRole, assertKeepsAnOwner, assertNotSelf } from './member-rules';

const MEMBER_SELECT = {
  id: true,
  role: true,
  permissions: true,
  status: true,
  joinedAt: true,
  deactivatedAt: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

type MemberRow = Prisma.CompanyMemberGetPayload<{ select: typeof MEMBER_SELECT }>;

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: PlanLimitsService,
  ) {}

  async list(ctx: TenantContext) {
    const rows = await this.prisma.companyMember.findMany({
      where: { companyId: ctx.companyId },
      select: MEMBER_SELECT,
      orderBy: [{ status: 'asc' }, { joinedAt: 'asc' }],
    });
    return rows.map((m) => this.present(ctx, m));
  }

  async update(ctx: TenantContext, memberId: string, dto: UpdateMemberDto, meta: RequestMeta) {
    assertNotSelf(ctx, memberId);
    return this.prisma.$transaction(async (tx) => {
      await lockCompany(tx, ctx.companyId);
      const before = await this.load(tx, ctx, memberId);
      assertCanTouchRole(ctx, before.role, dto.role);
      if (before.role === 'OWNER' && dto.role && dto.role !== 'OWNER' && before.status === 'ACTIVE') {
        await assertKeepsAnOwner(tx, ctx.companyId, memberId);
      }
      const after = await tx.companyMember.update({
        where: { id: before.id },
        data: { role: dto.role, permissions: dto.permissions },
        select: MEMBER_SELECT,
      });
      await this.audit.log(
        {
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'member.updated',
          entityType: 'CompanyMember',
          entityId: memberId,
          before: { role: before.role, permissions: before.permissions },
          after: { role: after.role, permissions: after.permissions },
          meta,
        },
        tx,
      );
      return this.present(ctx, after);
    });
  }

  async setStatus(ctx: TenantContext, memberId: string, status: 'ACTIVE' | 'INACTIVE', meta: RequestMeta) {
    assertNotSelf(ctx, memberId);
    return this.prisma.$transaction(async (tx) => {
      await lockCompany(tx, ctx.companyId);
      const before = await this.load(tx, ctx, memberId);
      assertCanTouchRole(ctx, before.role);
      if (before.status === status) return this.present(ctx, before);
      if (status === 'INACTIVE' && before.role === 'OWNER') await assertKeepsAnOwner(tx, ctx.companyId, memberId);
      if (status === 'ACTIVE') await this.limits.assertCanAddUsers(tx, ctx.companyId);

      const after = await tx.companyMember.update({
        where: { id: before.id },
        data: { status, deactivatedAt: status === 'INACTIVE' ? new Date() : null },
        select: MEMBER_SELECT,
      });
      await this.audit.log(
        {
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: status === 'INACTIVE' ? 'member.deactivated' : 'member.reactivated',
          entityType: 'CompanyMember',
          entityId: memberId,
          before: { status: before.status },
          after: { status },
          meta,
        },
        tx,
      );
      return this.present(ctx, after);
    });
  }

  /** Remove o vínculo. Se o membro estiver ligado a registros (ex.: motorista), exige desativação. */
  async remove(ctx: TenantContext, memberId: string, meta: RequestMeta): Promise<void> {
    assertNotSelf(ctx, memberId);
    await this.prisma.$transaction(async (tx) => {
      await lockCompany(tx, ctx.companyId);
      const before = await this.load(tx, ctx, memberId);
      assertCanTouchRole(ctx, before.role);
      if (before.role === 'OWNER' && before.status === 'ACTIVE') await assertKeepsAnOwner(tx, ctx.companyId, memberId);
      const linkedDriver = await tx.driver.count({ where: { companyId: ctx.companyId, memberId } });
      if (linkedDriver > 0) throw conflict('Este membro está vinculado a um motorista. Desative o acesso em vez de remover.');

      await tx.companyMember.delete({ where: { id: before.id } });
      await this.audit.log(
        {
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'member.removed',
          entityType: 'CompanyMember',
          entityId: memberId,
          before: { userId: before.user.id, email: before.user.email, role: before.role, status: before.status },
          meta,
        },
        tx,
      );
    });
  }

  /** Busca escopada ao tenant: id de outra empresa resulta em 404. */
  private async load(tx: Tx, ctx: TenantContext, memberId: string): Promise<MemberRow> {
    const member = await tx.companyMember.findFirst({ where: { id: memberId, companyId: ctx.companyId }, select: MEMBER_SELECT });
    if (!member) throw notFound('Membro não encontrado');
    return member;
  }

  private present(ctx: TenantContext, m: MemberRow) {
    return {
      id: m.id,
      role: m.role,
      roleLabel: MEMBER_ROLE_LABELS[m.role],
      extraPermissions: m.permissions,
      effectivePermissions: resolvePermissions(m.role, m.permissions),
      status: m.status,
      joinedAt: m.joinedAt,
      deactivatedAt: m.deactivatedAt,
      user: m.user,
      isMe: m.id === ctx.memberId,
    };
  }
}

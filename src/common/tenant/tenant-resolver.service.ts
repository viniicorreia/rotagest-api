import { Injectable } from '@nestjs/common';
import { resolvePermissions } from '../../domain';
import { PrismaService } from '../../prisma/prisma.service';
import { ErrorCode, forbidden } from '../errors';
import type { TenantContext } from './tenant-context';

/**
 * Resolve e valida o vínculo usuário ↔ empresa. Usado pelo TenantGuard em cada
 * requisição e pelos fluxos que emitem tokens (login, refresh, troca de empresa).
 */
@Injectable()
export class TenantResolver {
  constructor(private readonly prisma: PrismaService) {}

  /** Retorna o contexto ou lança 403 se o vínculo/empresa não estiver ativo. */
  async resolve(userId: string, companyId: string): Promise<TenantContext> {
    const ctx = await this.tryResolve(userId, companyId);
    if (ctx === 'SUSPENDED') throw forbidden('O acesso a esta empresa está suspenso. Fale com o suporte da plataforma.', ErrorCode.COMPANY_SUSPENDED);
    if (!ctx) throw forbidden('Você não tem acesso a esta empresa', ErrorCode.COMPANY_ACCESS_DENIED);
    return ctx;
  }

  async tryResolve(userId: string, companyId: string): Promise<TenantContext | 'SUSPENDED' | null> {
    if (!isUuid(companyId)) return null;
    const member = await this.prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      select: { id: true, role: true, permissions: true, status: true, company: { select: { status: true, subscription: { select: { status: true } } } } },
    });
    if (!member || member.status !== 'ACTIVE') return null;
    if (member.company.status !== 'ACTIVE') return 'SUSPENDED';
    // Assinatura suspensa ou cancelada pela plataforma também bloqueia o acesso; em atraso (PAST_DUE) não.
    const sub = member.company.subscription?.status;
    if (sub === 'SUSPENDED' || sub === 'CANCELED') return 'SUSPENDED';
    return {
      companyId,
      userId,
      memberId: member.id,
      role: member.role,
      permissions: resolvePermissions(member.role, member.permissions),
    };
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

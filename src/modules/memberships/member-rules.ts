import type { MemberRole } from '../../domain';
import { conflict, forbidden } from '../../common/errors';
import type { TenantContext } from '../../common/tenant/tenant-context';
import type { Tx } from '../../prisma/prisma.service';

/** Apenas um OWNER concede, altera ou remove o papel OWNER. */
export function assertCanTouchRole(ctx: TenantContext, ...roles: (MemberRole | undefined)[]): void {
  if (roles.includes('OWNER') && ctx.role !== 'OWNER') {
    throw forbidden('Somente um proprietário pode gerenciar proprietários');
  }
}

export function assertNotSelf(ctx: TenantContext, memberId: string): void {
  if (ctx.memberId === memberId) throw forbidden('Você não pode alterar o seu próprio acesso');
}

/** Impede que a empresa fique sem nenhum OWNER ativo. Chamar com a empresa já travada. */
export async function assertKeepsAnOwner(tx: Tx, companyId: string, removingMemberId: string): Promise<void> {
  const others = await tx.companyMember.count({
    where: { companyId, role: 'OWNER', status: 'ACTIVE', id: { not: removingMemberId } },
  });
  if (others === 0) throw conflict('A empresa precisa de pelo menos um proprietário ativo');
}

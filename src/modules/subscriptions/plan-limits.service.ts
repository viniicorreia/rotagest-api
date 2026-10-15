import { Injectable } from '@nestjs/common';
import { ErrorCode, conflict } from '../../common/errors';
import { PrismaService, type Tx } from '../../prisma/prisma.service';

export interface EffectiveLimits {
  maxUsers: number | null;
  maxVehicles: number | null;
}

/**
 * Limites do plano vêm do banco (Plan + overrides da Subscription), nunca do
 * código. As verificações rodam dentro da transação que cria o recurso, com
 * lock na linha da empresa, para não ultrapassar o limite sob concorrência.
 */
@Injectable()
export class PlanLimitsService {
  constructor(private readonly prisma: PrismaService) {}

  async getLimits(companyId: string, tx?: Tx): Promise<EffectiveLimits> {
    const sub = await (tx ?? this.prisma).subscription.findUnique({
      where: { companyId },
      select: { overrideMaxUsers: true, overrideMaxVehicles: true, plan: { select: { maxUsers: true, maxVehicles: true } } },
    });
    if (!sub) return { maxUsers: null, maxVehicles: null };
    return {
      maxUsers: sub.overrideMaxUsers ?? sub.plan.maxUsers,
      maxVehicles: sub.overrideMaxVehicles ?? sub.plan.maxVehicles,
    };
  }

  /** Usuários = membros ativos + convites pendentes ainda válidos. */
  async countUsers(companyId: string, tx?: Tx): Promise<number> {
    const client = tx ?? this.prisma;
    const [members, invitations] = await Promise.all([
      client.companyMember.count({ where: { companyId, status: 'ACTIVE' } }),
      client.companyInvitation.count({ where: { companyId, status: 'PENDING', expiresAt: { gt: new Date() } } }),
    ]);
    return members + invitations;
  }

  /** Lança 409 PLAN_LIMIT_REACHED se adicionar `adding` usuários ultrapassar o limite. Deve rodar dentro de `tx`. */
  async assertCanAddUsers(tx: Tx, companyId: string, adding = 1): Promise<void> {
    await lockCompany(tx, companyId);
    const { maxUsers } = await this.getLimits(companyId, tx);
    if (maxUsers === null) return;
    const used = await this.countUsers(companyId, tx);
    if (used + adding > maxUsers) {
      throw conflict(
        `Seu plano permite até ${maxUsers} usuário(s), contando convites pendentes. Faça upgrade ou remova acessos.`,
        ErrorCode.PLAN_LIMIT_REACHED,
      );
    }
  }
}

/** Serializa operações limitadas por plano dentro da mesma empresa. */
export async function lockCompany(tx: Tx, companyId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId}::uuid FOR UPDATE`;
}

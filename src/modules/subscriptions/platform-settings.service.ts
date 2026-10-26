import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService, type Tx } from '../../prisma/prisma.service';

export interface EffectiveSettings {
  allowNewCompanies: boolean;
  /** null quando nem a configuração nem DEFAULT_PLAN_CODE apontam para um plano ativo. */
  defaultPlan: { id: string; code: string; name: string } | null;
  trialDays: number;
  supportEmail: string | null;
  updatedAt: Date | null;
}

/**
 * Configurações globais da plataforma. A linha em `platform_settings` vence;
 * sem ela valem DEFAULT_PLAN_CODE e TRIAL_DAYS do ambiente.
 */
@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async get(tx?: Tx): Promise<EffectiveSettings> {
    const client = tx ?? this.prisma;
    const row = await client.platformSettings.findUnique({
      where: { id: 1 },
      include: { defaultPlan: { select: { id: true, code: true, name: true, status: true } } },
    });
    const plan =
      row?.defaultPlan ??
      (await client.plan.findUnique({ where: { code: this.config.get('DEFAULT_PLAN_CODE') }, select: { id: true, code: true, name: true, status: true } }));
    return {
      allowNewCompanies: row?.allowNewCompanies ?? true,
      defaultPlan: plan && plan.status === 'ACTIVE' ? { id: plan.id, code: plan.code, name: plan.name } : null,
      trialDays: row?.trialDays ?? this.config.get('TRIAL_DAYS'),
      supportEmail: row?.supportEmail ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }
}

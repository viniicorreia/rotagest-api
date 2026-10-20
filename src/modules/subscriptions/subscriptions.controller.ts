import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import { PLAN_FEATURES, fromCents, toCents } from '../../domain';
import { BillingService } from '../billing/billing.service';
import { PlatformSettingsService } from './platform-settings.service';
import { PublicPlanListDto, SubscriptionDto } from './subscription-response.dto';
import { notFound } from '../../common/errors';
import type { TenantContext } from '../../common/tenant/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { PlanLimitsService } from './plan-limits.service';

@ApiTags('subscription')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('subscription')
export class SubscriptionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limits: PlanLimitsService,
    private readonly settings: PlatformSettingsService,
    private readonly billing: BillingService,
  ) {}

  @Get()
  @ApiOkResponse({ type: SubscriptionDto })
  @RequirePermissions('subscription:read')
  @ApiOperation({ summary: 'Plano, status da assinatura, limites efetivos e uso atual' })
  async current(@Tenant() ctx: TenantContext) {
    const sub = await this.prisma.subscription.findUnique({
      where: { companyId: ctx.companyId },
      select: {
        status: true,
        trialEndsAt: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        plan: {
          select: {
            code: true,
            name: true,
            description: true,
            price: true,
            currency: true,
            interval: true,
            features: { select: { key: true, enabled: true, limit: true } },
          },
        },
      },
    });
    if (!sub) throw notFound('Assinatura não encontrada');
    const [limits, users, vehicles, settings] = await Promise.all([
      this.limits.getLimits(ctx.companyId),
      this.limits.countUsers(ctx.companyId),
      this.prisma.vehicle.count({ where: { companyId: ctx.companyId, archivedAt: null } }),
      this.settings.get(),
    ]);
    return { ...sub, limits, usage: { users, vehicles }, supportEmail: settings.supportEmail, billing: this.billing.status() };
  }
}

const FEATURE_LABELS = new Map<string, string>(PLAN_FEATURES.map((f) => [f.key, f.label]));

@ApiTags('subscription')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@Controller('plans')
export class PlansController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  @ApiOkResponse({ type: PublicPlanListDto })
  @ApiOperation({ summary: 'Planos ativos e públicos, para comparação e upgrade' })
  async list() {
    const plans = await this.prisma.plan.findMany({
      where: { status: 'ACTIVE', isPublic: true },
      include: { features: { where: { enabled: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return {
      items: plans.map((p) => ({
        code: p.code,
        name: p.name,
        description: p.description,
        price: fromCents(toCents(p.price)),
        currency: p.currency,
        interval: p.interval,
        maxVehicles: p.maxVehicles,
        maxUsers: p.maxUsers,
        features: p.features.map((f) => ({ key: f.key, label: FEATURE_LABELS.get(f.key) ?? f.key })),
      })),
    };
  }
}

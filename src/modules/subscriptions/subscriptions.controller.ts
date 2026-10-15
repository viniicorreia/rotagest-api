import { ApiDefaultResponse } from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/dto/error.dto';
import { ApiOkResponse } from '@nestjs/swagger';
import { SubscriptionDto } from './subscription-response.dto';
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions, Tenant } from '../../common/decorators';
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
    const [limits, users, vehicles] = await Promise.all([
      this.limits.getLimits(ctx.companyId),
      this.limits.countUsers(ctx.companyId),
      this.prisma.vehicle.count({ where: { companyId: ctx.companyId, archivedAt: null } }),
    ]);
    return { ...sub, limits, usage: { users, vehicles } };
  }
}

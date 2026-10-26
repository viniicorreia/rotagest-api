import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, NoTenant, ReqMeta } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import type { AuthUser, RequestMeta } from '../../common/tenant/tenant-context';
import {
  CreatePlanDto,
  ListCompaniesQueryDto,
  ListSubscriptionsQueryDto,
  PlatformCompanyDetailDto,
  PlatformCompanyListDto,
  PlatformOverviewDto,
  PlatformPlanDto,
  PlatformPlanListDto,
  PlatformSettingsDto,
  PlatformSubscriptionDto,
  PlatformSubscriptionListDto,
  SetCompanyStatusDto,
  UpdatePlanDto,
  UpdatePlatformSettingsDto,
  UpdateSubscriptionDto,
} from './platform.dto';
import { PlatformService } from './platform.service';

/** Administração da plataforma SaaS (SUPER_ADMIN). Não exige empresa ativa. */
@ApiTags('platform')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@NoTenant()
@UseGuards(PlatformAdminGuard)
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('overview')
  @ApiOkResponse({ type: PlatformOverviewDto })
  @ApiOperation({ summary: 'Indicadores comerciais da plataforma' })
  overview() {
    return this.platform.overview();
  }

  @Get('companies')
  @ApiOkResponse({ type: PlatformCompanyListDto })
  @ApiOperation({ summary: 'Empresas (dados cadastrais, assinatura e uso; sem dados financeiros)' })
  companies(@Query() q: ListCompaniesQueryDto) {
    return this.platform.listCompanies(q);
  }

  @Get('companies/:id')
  @ApiOkResponse({ type: PlatformCompanyDetailDto })
  company(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getCompany(id);
  }

  @Post('companies/:id/status')
  @HttpCode(200)
  @ApiOkResponse({ type: PlatformCompanyDetailDto })
  @ApiOperation({ summary: 'Ativa, suspende ou cancela a empresa (com justificativa auditada)' })
  setCompanyStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetCompanyStatusDto, @ReqMeta() meta: RequestMeta) {
    return this.platform.setCompanyStatus(user, id, dto, meta);
  }

  @Get('plans')
  @ApiOkResponse({ type: PlatformPlanListDto })
  plans() {
    return this.platform.listPlans();
  }

  @Post('plans')
  @ApiOkResponse({ type: PlatformPlanDto })
  @ApiOperation({ summary: 'Cria um plano' })
  createPlan(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto, @ReqMeta() meta: RequestMeta) {
    return this.platform.createPlan(user, dto, meta);
  }

  @Patch('plans/:id')
  @ApiOkResponse({ type: PlatformPlanDto })
  @ApiOperation({ summary: 'Altera preço, limites, recursos ou arquiva o plano' })
  updatePlan(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto, @ReqMeta() meta: RequestMeta) {
    return this.platform.updatePlan(user, id, dto, meta);
  }

  @Get('subscriptions')
  @ApiOkResponse({ type: PlatformSubscriptionListDto })
  subscriptions(@Query() q: ListSubscriptionsQueryDto) {
    return this.platform.listSubscriptions(q);
  }

  @Patch('subscriptions/:id')
  @ApiOkResponse({ type: PlatformSubscriptionDto })
  @ApiOperation({ summary: 'Ativação administrativa: plano, status, datas e limites negociados (com justificativa)' })
  updateSubscription(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubscriptionDto, @ReqMeta() meta: RequestMeta) {
    return this.platform.updateSubscription(user, id, dto, meta);
  }

  @Get('settings')
  @ApiOkResponse({ type: PlatformSettingsDto })
  settings() {
    return this.platform.getSettings();
  }

  @Patch('settings')
  @ApiOkResponse({ type: PlatformSettingsDto })
  updateSettings(@CurrentUser() user: AuthUser, @Body() dto: UpdatePlatformSettingsDto, @ReqMeta() meta: RequestMeta) {
    return this.platform.updateSettings(user, dto, meta);
  }
}

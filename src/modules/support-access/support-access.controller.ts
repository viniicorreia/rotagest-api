import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, NoTenant, ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import { PlatformAdminGuard } from '../../common/guards/platform-admin.guard';
import type { AuthUser, RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { TokenResponseDto } from '../auth/dto/auth.dto';
import { CreateSupportGrantDto, SupportAccessLogEntryDto, SupportAccessOverviewDto, SupportGrantDto } from './support-access.dto';
import { SupportAccessService } from './support-access.service';

/** Autorizações dadas pelo dono da empresa ao suporte da plataforma. */
@ApiTags('support-access')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('support-access')
export class SupportAccessController {
  constructor(private readonly support: SupportAccessService) {}

  @Get()
  @ApiOkResponse({ type: SupportAccessOverviewDto })
  @RequirePermissions('support:grant')
  overview(@Tenant() ctx: TenantContext) {
    return this.support.overview(ctx);
  }

  @Post()
  @ApiOkResponse({ type: SupportGrantDto })
  @RequirePermissions('support:grant')
  @ApiOperation({ summary: 'Autoriza o suporte a ver os dados da empresa (somente leitura, até 72 h)' })
  grant(@Tenant() ctx: TenantContext, @Body() dto: CreateSupportGrantDto, @ReqMeta() meta: RequestMeta) {
    return this.support.grant(ctx, dto, meta);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOkResponse({ type: SupportGrantDto })
  @RequirePermissions('support:grant')
  revoke(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.support.revoke(ctx, id, meta);
  }

  @Get(':id/log')
  @ApiOkResponse({ type: [SupportAccessLogEntryDto] })
  @RequirePermissions('support:grant')
  @ApiOperation({ summary: 'O que o suporte consultou com esta autorização (últimas 200 leituras)' })
  log(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.log(ctx, id);
  }
}

/** Entrada e saída do modo suporte (SUPER_ADMIN). */
@ApiTags('platform')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@NoTenant()
@UseGuards(PlatformAdminGuard)
@Controller('platform')
export class SupportSessionController {
  constructor(private readonly support: SupportAccessService) {}

  @Post('companies/:id/support-session')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenResponseDto })
  @ApiOperation({ summary: 'Abre a empresa em modo suporte (exige autorização vigente do dono)' })
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.support.startSession(user, id, meta);
  }

  @Post('support-session/end')
  @HttpCode(200)
  @ApiOkResponse({ type: TokenResponseDto })
  @ApiOperation({ summary: 'Sai do modo suporte e volta ao painel da plataforma' })
  end(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.support.endSession(user, meta);
  }
}

import { ApiDefaultResponse } from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/dto/error.dto';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';
import { TokenResponseDto } from '../auth/dto/auth.dto';
import { InvitationDto, InvitationPreviewDto, InviteResultDto } from './dto/membership-response.dto';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthRateLimit, CurrentUser, NoTenant, Public, ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import type { AuthUser, RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { InviteMemberDto } from './dto/membership.dto';
import { InvitationsService } from './invitations.service';

@ApiTags('invitations')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @ApiBearerAuth()
  @Get()
  @ApiOkResponse({ type: [InvitationDto] })
  @RequirePermissions('members:manage')
  list(@Tenant() ctx: TenantContext) {
    return this.invitations.list(ctx);
  }

  @ApiBearerAuth()
  @Post()
  @ApiCreatedResponse({ type: InviteResultDto })
  @RequirePermissions('members:manage')
  @ApiOperation({ summary: 'Convida uma pessoa por e-mail (respeita o limite de usuários do plano)' })
  create(@Tenant() ctx: TenantContext, @Body() dto: InviteMemberDto, @ReqMeta() meta: RequestMeta) {
    return this.invitations.create(ctx, dto, meta);
  }

  @ApiBearerAuth()
  @Post(':id/resend')
  @ApiOkResponse({ type: InviteResultDto })
  @HttpCode(200)
  @RequirePermissions('members:manage')
  resend(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.invitations.resend(ctx, id, meta);
  }

  @ApiBearerAuth()
  @Post(':id/revoke')
  @ApiNoContentResponse()
  @HttpCode(204)
  @RequirePermissions('members:manage')
  async revoke(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.invitations.revoke(ctx, id, meta);
  }

  @Public()
  @AuthRateLimit()
  @Get('token/:token')
  @ApiOkResponse({ type: InvitationPreviewDto })
  @ApiOperation({ summary: 'Dados públicos do convite para a tela de aceite' })
  preview(@Param('token') token: string) {
    return this.invitations.preview(token);
  }

  @NoTenant()
  @ApiBearerAuth()
  @AuthRateLimit()
  @Post('token/:token/accept')
  @ApiOkResponse({ type: TokenResponseDto })
  @HttpCode(200)
  @ApiOperation({ summary: 'Aceita o convite com o usuário logado e ativa a empresa' })
  accept(@CurrentUser() user: AuthUser, @Param('token') token: string, @ReqMeta() meta: RequestMeta) {
    return this.invitations.accept(user, token, meta);
  }
}

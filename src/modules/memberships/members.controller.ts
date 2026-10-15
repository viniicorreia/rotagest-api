import { ApiDefaultResponse } from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/dto/error.dto';
import { ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';
import { MemberDto } from './dto/membership-response.dto';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { UpdateMemberDto } from './dto/membership.dto';
import { MembershipsService } from './memberships.service';

@ApiTags('members')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembershipsService) {}

  @Get()
  @ApiOkResponse({ type: [MemberDto] })
  @RequirePermissions('members:read')
  list(@Tenant() ctx: TenantContext) {
    return this.members.list(ctx);
  }

  @Patch(':id')
  @ApiOkResponse({ type: MemberDto })
  @RequirePermissions('members:manage')
  @ApiOperation({ summary: 'Altera papel e/ou permissões extras de um membro' })
  update(
    @Tenant() ctx: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMemberDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.members.update(ctx, id, dto, meta);
  }

  @Post(':id/deactivate')
  @ApiOkResponse({ type: MemberDto })
  @HttpCode(200)
  @RequirePermissions('members:manage')
  deactivate(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.members.setStatus(ctx, id, 'INACTIVE', meta);
  }

  @Post(':id/reactivate')
  @ApiOkResponse({ type: MemberDto })
  @HttpCode(200)
  @RequirePermissions('members:manage')
  reactivate(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.members.setStatus(ctx, id, 'ACTIVE', meta);
  }

  @Delete(':id')
  @ApiNoContentResponse()
  @HttpCode(204)
  @RequirePermissions('members:manage')
  @ApiOperation({ summary: 'Remove o acesso do membro à empresa' })
  async remove(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.members.remove(ctx, id, meta);
  }
}

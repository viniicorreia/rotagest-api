import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { CancelObligationDto, SettleDto } from '../obligations/obligations.dto';
import { CreateReceivableDto, CreateReceivableResultDto, ListReceivablesQueryDto, ReceivableDetailDto, ReceivableListDto, ReceivableSettlementResultDto, UpdateReceivableDto } from './receivables.dto';
import { ReceivablesService } from './receivables.service';

@ApiTags('receivables')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('receivables')
export class ReceivablesController {
  constructor(private readonly receivables: ReceivablesService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: ReceivableListDto })
  @ApiOperation({ summary: 'Contas a receber com filtros, paginação e totais do filtro' })
  list(@Tenant() ctx: TenantContext, @Query() q: ListReceivablesQueryDto) {
    return this.receivables.list(ctx, q);
  }

  @Get(':id')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: ReceivableDetailDto })
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.receivables.get(ctx, id);
  }

  @Post()
  @RequirePermissions('finance:manage')
  @ApiCreatedResponse({ type: CreateReceivableResultDto })
  @ApiOperation({ summary: 'Cria receita avulsa, parcelada ou recorrente (opcionalmente já recebida)' })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreateReceivableDto, @ReqMeta() meta: RequestMeta) {
    return this.receivables.create(ctx, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions('finance:manage')
  @ApiOkResponse({ type: ReceivableDetailDto })
  update(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReceivableDto, @ReqMeta() meta: RequestMeta) {
    return this.receivables.update(ctx, id, dto, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('finance:manage')
  @ApiOkResponse({ type: ReceivableDetailDto })
  @ApiOperation({ summary: 'Cancela (sem apagar). Exige estornar recebimentos antes.' })
  cancel(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelObligationDto, @ReqMeta() meta: RequestMeta) {
    return this.receivables.cancel(ctx, id, dto, meta);
  }

  @Post(':id/settlements')
  @RequirePermissions('finance:manage')
  @ApiCreatedResponse({ type: ReceivableSettlementResultDto })
  @ApiOperation({ summary: 'Registra recebimento total ou parcial (idempotente pela idempotencyKey)' })
  receive(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleDto, @ReqMeta() meta: RequestMeta) {
    return this.receivables.receive(ctx, id, dto, meta);
  }
}

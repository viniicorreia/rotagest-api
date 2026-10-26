import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { CancelObligationDto, SettleDto } from '../obligations/obligations.dto';
import { CreatePayableDto, CreatePayableResultDto, ListPayablesQueryDto, PayableDetailDto, PayableListDto, PayableSettlementResultDto, UpdatePayableDto } from './payables.dto';
import { PayablesService } from './payables.service';

@ApiTags('payables')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('payables')
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: PayableListDto })
  @ApiOperation({ summary: 'Contas a pagar com filtros, paginação e totais do filtro' })
  list(@Tenant() ctx: TenantContext, @Query() q: ListPayablesQueryDto) {
    return this.payables.list(ctx, q);
  }

  @Get(':id')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: PayableDetailDto })
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.payables.get(ctx, id);
  }

  @Post()
  @RequirePermissions('finance:manage')
  @ApiCreatedResponse({ type: CreatePayableResultDto })
  @ApiOperation({ summary: 'Cria despesa avulsa, parcelada ou recorrente (opcionalmente já paga)' })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreatePayableDto, @ReqMeta() meta: RequestMeta) {
    return this.payables.create(ctx, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions('finance:manage')
  @ApiOkResponse({ type: PayableDetailDto })
  update(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePayableDto, @ReqMeta() meta: RequestMeta) {
    return this.payables.update(ctx, id, dto, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('finance:manage')
  @ApiOkResponse({ type: PayableDetailDto })
  @ApiOperation({ summary: 'Cancela (sem apagar). Exige estornar pagamentos antes.' })
  cancel(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelObligationDto, @ReqMeta() meta: RequestMeta) {
    return this.payables.cancel(ctx, id, dto, meta);
  }

  @Post(':id/settlements')
  @RequirePermissions('finance:manage')
  @ApiCreatedResponse({ type: PayableSettlementResultDto })
  @ApiOperation({ summary: 'Registra pagamento total ou parcial (idempotente pela idempotencyKey)' })
  pay(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleDto, @ReqMeta() meta: RequestMeta) {
    return this.payables.pay(ctx, id, dto, meta);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiDefaultResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequireAnyPermission, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import {
  BillingPreviewDto,
  BillingPreviewQueryDto,
  BillingResultDto,
  CreateBillingDto,
  CreateDailyLogDto,
  DailyLogDto,
  DailyLogListDto,
  ListDailyLogsQueryDto,
  UpdateDailyLogDto,
} from './mileage.dto';
import { MileageService } from './mileage.service';

@ApiTags('daily-logs')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('daily-logs')
export class MileageController {
  constructor(private readonly mileage: MileageService) {}

  @Get()
  @RequireAnyPermission('fleet:read', 'assignments:own')
  @ApiOkResponse({ type: DailyLogListDto })
  @ApiOperation({ summary: 'Registros diários de km; motorista vê só os próprios; valores só com finance:read' })
  list(@Tenant() ctx: TenantContext, @Query() q: ListDailyLogsQueryDto) {
    return this.mileage.list(ctx, q);
  }

  @Post()
  @RequireAnyPermission('fleet:manage', 'assignments:own')
  @ApiCreatedResponse({ type: DailyLogDto })
  @ApiOperation({ summary: 'Registra os km rodados por um veículo num dia (um registro por veículo por dia)' })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreateDailyLogDto, @ReqMeta() meta: RequestMeta) {
    return this.mileage.create(ctx, dto, meta);
  }

  @Get('billing')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: BillingPreviewDto })
  @ApiOperation({ summary: 'Quanto há a faturar por veículo no mês (km × R$/km)' })
  preview(@Tenant() ctx: TenantContext, @Query() q: BillingPreviewQueryDto) {
    return this.mileage.billingPreview(ctx, q);
  }

  @Post('billing')
  @RequirePermissions('finance:manage')
  @ApiCreatedResponse({ type: BillingResultDto })
  @ApiOperation({ summary: 'Gera contas a receber com os km ainda não faturados do mês (uma por veículo)' })
  bill(@Tenant() ctx: TenantContext, @Body() dto: CreateBillingDto, @ReqMeta() meta: RequestMeta) {
    return this.mileage.bill(ctx, dto, meta);
  }

  @Patch(':id')
  @RequireAnyPermission('fleet:manage', 'assignments:own')
  @ApiOkResponse({ type: DailyLogDto })
  update(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDailyLogDto, @ReqMeta() meta: RequestMeta) {
    return this.mileage.update(ctx, id, dto, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireAnyPermission('fleet:manage', 'assignments:own')
  @ApiNoContentResponse()
  async remove(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.mileage.remove(ctx, id, meta);
  }
}

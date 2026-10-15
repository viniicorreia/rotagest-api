import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiNoContentResponse, ApiOkResponse, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { CreateVehicleDto, ListVehiclesQueryDto, UpdateVehicleDto, VehicleDetailDto, VehicleDto, VehicleListDto, VehicleSummaryQueryDto } from './dto/vehicle.dto';
import { VehiclesService } from './vehicles.service';

@ApiTags('vehicles')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @RequirePermissions('fleet:read')
  @ApiOkResponse({ type: VehicleListDto })
  @ApiOperation({ summary: 'Lista veículos e o uso do limite do plano' })
  list(@Tenant() ctx: TenantContext, @Query() q: ListVehiclesQueryDto) {
    return this.vehicles.list(ctx, q);
  }

  @Get(':id')
  @RequirePermissions('fleet:read')
  @ApiOkResponse({ type: VehicleDetailDto })
  @ApiOperation({ summary: 'Detalhes do veículo; com finance:read inclui o resultado gerencial (competência) e a evolução mensal' })
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: VehicleSummaryQueryDto) {
    return this.vehicles.get(ctx, id, q);
  }

  @Post()
  @RequirePermissions('fleet:manage')
  @ApiCreatedResponse({ type: VehicleDto })
  @ApiOperation({ summary: 'Cadastra veículo (respeita o limite de veículos do plano)' })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreateVehicleDto, @ReqMeta() meta: RequestMeta) {
    return this.vehicles.create(ctx, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions('fleet:manage')
  @ApiOkResponse({ type: VehicleDto })
  update(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVehicleDto, @ReqMeta() meta: RequestMeta) {
    return this.vehicles.update(ctx, id, dto, meta);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermissions('fleet:manage')
  @ApiOkResponse({ type: VehicleDto })
  @ApiOperation({ summary: 'Arquiva o veículo (preserva o histórico e libera a vaga do plano)' })
  archive(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.vehicles.archive(ctx, id, meta);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermissions('fleet:manage')
  @ApiOkResponse({ type: VehicleDto })
  @ApiOperation({ summary: 'Reativa um veículo arquivado (respeita o limite do plano)' })
  restore(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.vehicles.restore(ctx, id, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('fleet:manage')
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Exclui definitivamente um veículo sem histórico; com histórico, use arquivar' })
  async remove(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.vehicles.remove(ctx, id, meta);
  }
}

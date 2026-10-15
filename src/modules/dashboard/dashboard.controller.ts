import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { TenantContext } from '../../common/tenant/tenant-context';
import { DashboardDto, DashboardQueryDto } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: DashboardDto })
  @ApiOperation({ summary: 'Indicadores financeiros da empresa ativa (caixa e competência rotulados), com filtros de período, veículo e categoria' })
  get(@Tenant() ctx: TenantContext, @Query() q: DashboardQueryDto) {
    return this.dashboard.get(ctx, q);
  }
}

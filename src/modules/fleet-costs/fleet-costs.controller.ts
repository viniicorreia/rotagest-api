import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { PageQueryDto } from '../../common/validation';
import {
  CancelCostDto,
  CostSummaryDto,
  CostSummaryQueryDto,
  CreateDriverExpenseDto,
  CreateFuelingDto,
  CreateMaintenanceDto,
  DriverExpenseDto,
  DriverExpenseListDto,
  ExpenseCategoryListDto,
  FuelingDto,
  FuelingListDto,
  ListExpenseApprovalsQueryDto,
  ListFuelingsQueryDto,
  ListMaintenancesQueryDto,
  MaintenanceDto,
  MaintenanceListDto,
  RejectExpenseDto,
} from './fleet-costs.dto';
import { FleetCostsService } from './fleet-costs.service';

@ApiTags('fleet-costs')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller()
export class FleetCostsController {
  constructor(private readonly costs: FleetCostsService) {}

  @Get('maintenances')
  @RequirePermissions('fleet:read', 'finance:read')
  @ApiOkResponse({ type: MaintenanceListDto })
  listMaintenances(@Tenant() ctx: TenantContext, @Query() q: ListMaintenancesQueryDto) {
    return this.costs.listMaintenances(ctx, q);
  }

  @Get('maintenances/:id')
  @RequirePermissions('fleet:read', 'finance:read')
  @ApiOkResponse({ type: MaintenanceDto })
  getMaintenance(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.costs.getMaintenance(ctx, id);
  }

  @Post('maintenances')
  @RequirePermissions('fleet:manage', 'finance:manage')
  @ApiCreatedResponse({ type: MaintenanceDto })
  @ApiOperation({ summary: 'Registra manutenção e gera a conta a pagar ligada ao veículo (opcionalmente já paga)' })
  createMaintenance(@Tenant() ctx: TenantContext, @Body() dto: CreateMaintenanceDto, @ReqMeta() meta: RequestMeta) {
    return this.costs.createMaintenance(ctx, dto, meta);
  }

  @Post('maintenances/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('fleet:manage', 'finance:manage')
  @ApiOkResponse({ type: MaintenanceDto })
  @ApiOperation({ summary: 'Cancela a conta da manutenção (estorne pagamentos antes)' })
  cancelMaintenance(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelCostDto, @ReqMeta() meta: RequestMeta) {
    return this.costs.cancelMaintenance(ctx, id, dto, meta);
  }

  @Get('fuelings')
  @RequirePermissions('fleet:read', 'finance:read')
  @ApiOkResponse({ type: FuelingListDto })
  listFuelings(@Tenant() ctx: TenantContext, @Query() q: ListFuelingsQueryDto) {
    return this.costs.listFuelings(ctx, q);
  }

  @Post('fuelings')
  @RequirePermissions('fleet:manage', 'finance:manage')
  @ApiCreatedResponse({ type: FuelingDto })
  @ApiOperation({ summary: 'Registra abastecimento (litros × preço) e gera a conta a pagar' })
  createFueling(@Tenant() ctx: TenantContext, @Body() dto: CreateFuelingDto, @ReqMeta() meta: RequestMeta) {
    return this.costs.createFueling(ctx, dto, meta);
  }

  @Post('fuelings/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('fleet:manage', 'finance:manage')
  @ApiOkResponse({ type: FuelingDto })
  cancelFueling(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelCostDto, @ReqMeta() meta: RequestMeta) {
    return this.costs.cancelFueling(ctx, id, dto, meta);
  }

  @Get('fleet-costs/summary')
  @RequirePermissions('fleet:read', 'finance:read')
  @ApiOkResponse({ type: CostSummaryDto })
  @ApiOperation({ summary: 'Por veículo no mês: km, valor do km, combustível, manutenção, km/l e custo por km' })
  summary(@Tenant() ctx: TenantContext, @Query() q: CostSummaryQueryDto) {
    return this.costs.summary(ctx, q);
  }

  @Get('my/expense-categories')
  @RequirePermissions('expenses:own')
  @ApiOkResponse({ type: ExpenseCategoryListDto })
  myCategories(@Tenant() ctx: TenantContext) {
    return this.costs.myExpenseCategories(ctx);
  }

  @Get('my/expenses')
  @RequirePermissions('expenses:own')
  @ApiOkResponse({ type: DriverExpenseListDto })
  listMine(@Tenant() ctx: TenantContext, @Query() q: PageQueryDto) {
    return this.costs.listMyExpenses(ctx, q);
  }

  @Post('my/expenses')
  @RequirePermissions('expenses:own')
  @ApiCreatedResponse({ type: DriverExpenseDto })
  @ApiOperation({ summary: 'Motorista envia uma despesa; fica aguardando aprovação' })
  createMine(@Tenant() ctx: TenantContext, @Body() dto: CreateDriverExpenseDto, @ReqMeta() meta: RequestMeta) {
    return this.costs.createMyExpense(ctx, dto, meta);
  }

  @Post('my/expenses/:id/withdraw')
  @HttpCode(200)
  @RequirePermissions('expenses:own')
  @ApiOkResponse({ type: DriverExpenseDto })
  withdrawMine(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.costs.withdrawMyExpense(ctx, id, meta);
  }

  @Get('expense-approvals')
  @RequirePermissions('expenses:approve')
  @ApiOkResponse({ type: DriverExpenseListDto })
  listApprovals(@Tenant() ctx: TenantContext, @Query() q: ListExpenseApprovalsQueryDto) {
    return this.costs.listApprovals(ctx, q);
  }

  @Post('expense-approvals/:id/approve')
  @HttpCode(200)
  @RequirePermissions('expenses:approve')
  @ApiOkResponse({ type: DriverExpenseDto })
  approve(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.costs.approve(ctx, id, meta);
  }

  @Post('expense-approvals/:id/reject')
  @HttpCode(200)
  @RequirePermissions('expenses:approve')
  @ApiOkResponse({ type: DriverExpenseDto })
  reject(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectExpenseDto, @ReqMeta() meta: RequestMeta) {
    return this.costs.reject(ctx, id, dto, meta);
  }
}

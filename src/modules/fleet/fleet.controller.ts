import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiDefaultResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import {
  AssignmentDto,
  CreateAssignmentDto,
  CreateDriverDto,
  CreateRouteDto,
  DriverDto,
  EndAssignmentDto,
  ListAssignmentsQueryDto,
  ListFleetQueryDto,
  MyAssignmentsDto,
  RouteDto,
  UpdateDriverDto,
  UpdateRouteDto,
} from './fleet.dto';
import { FleetService } from './fleet.service';

@ApiTags('drivers')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('drivers')
export class DriversController {
  constructor(private readonly fleet: FleetService) {}

  @Get()
  @RequirePermissions('fleet:read')
  @ApiOkResponse({ type: [DriverDto] })
  list(@Tenant() ctx: TenantContext, @Query() q: ListFleetQueryDto) {
    return this.fleet.listDrivers(ctx, q);
  }

  @Post()
  @RequirePermissions('fleet:manage')
  @ApiCreatedResponse({ type: DriverDto })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreateDriverDto, @ReqMeta() meta: RequestMeta) {
    return this.fleet.createDriver(ctx, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions('fleet:manage')
  @ApiOkResponse({ type: DriverDto })
  update(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDriverDto, @ReqMeta() meta: RequestMeta) {
    return this.fleet.updateDriver(ctx, id, dto, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('fleet:manage')
  @ApiNoContentResponse()
  @ApiOperation({ summary: 'Exclui motorista sem histórico; com histórico, marque como inativo' })
  async remove(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.fleet.removeDriver(ctx, id, meta);
  }

  @Post(':id/anonymize')
  @HttpCode(200)
  @RequirePermissions('fleet:manage')
  @ApiOkResponse({ type: DriverDto })
  @ApiOperation({ summary: 'Remove os dados pessoais de um motorista inativo (LGPD), mantendo o histórico' })
  anonymize(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.fleet.anonymizeDriver(ctx, id, meta);
  }
}

@ApiTags('routes')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('routes')
export class RoutesController {
  constructor(private readonly fleet: FleetService) {}

  @Get()
  @RequirePermissions('fleet:read')
  @ApiOkResponse({ type: [RouteDto] })
  list(@Tenant() ctx: TenantContext, @Query() q: ListFleetQueryDto) {
    return this.fleet.listRoutes(ctx, q);
  }

  @Post()
  @RequirePermissions('fleet:manage')
  @ApiCreatedResponse({ type: RouteDto })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreateRouteDto, @ReqMeta() meta: RequestMeta) {
    return this.fleet.createRoute(ctx, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions('fleet:manage')
  @ApiOkResponse({ type: RouteDto })
  update(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRouteDto, @ReqMeta() meta: RequestMeta) {
    return this.fleet.updateRoute(ctx, id, dto, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('fleet:manage')
  @ApiNoContentResponse()
  async remove(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.fleet.removeRoute(ctx, id, meta);
  }
}

@ApiTags('assignments')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly fleet: FleetService) {}

  @Get()
  @RequirePermissions('fleet:read')
  @ApiOkResponse({ type: [AssignmentDto] })
  list(@Tenant() ctx: TenantContext, @Query() q: ListAssignmentsQueryDto) {
    return this.fleet.listAssignments(ctx, q);
  }

  @Get('mine')
  @RequirePermissions('assignments:own')
  @ApiOkResponse({ type: MyAssignmentsDto })
  @ApiOperation({ summary: 'Portal do motorista: rotas e veículos de hoje do usuário logado' })
  mine(@Tenant() ctx: TenantContext) {
    return this.fleet.mine(ctx);
  }

  @Post()
  @RequirePermissions('fleet:manage')
  @ApiCreatedResponse({ type: AssignmentDto })
  @ApiOperation({ summary: 'Atribui veículo e/ou motorista a uma rota a partir de uma data' })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreateAssignmentDto, @ReqMeta() meta: RequestMeta) {
    return this.fleet.createAssignment(ctx, dto, meta);
  }

  @Post(':id/end')
  @HttpCode(200)
  @RequirePermissions('fleet:manage')
  @ApiOkResponse({ type: AssignmentDto })
  @ApiOperation({ summary: 'Encerra a atribuição numa data (o histórico é mantido)' })
  end(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EndAssignmentDto, @ReqMeta() meta: RequestMeta) {
    return this.fleet.endAssignment(ctx, id, dto, meta);
  }
}

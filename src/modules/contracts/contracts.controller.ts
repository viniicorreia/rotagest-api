import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiDefaultResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import {
  ContractDetailDto,
  ContractDto,
  ContractorDto,
  ContractStatusDto,
  CreateContractDto,
  CreateContractorDto,
  ListContractsQueryDto,
  UpdateContractDto,
  UpdateContractorDto,
} from './contracts.dto';
import { ContractsService } from './contracts.service';

@ApiTags('contractors')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('contractors')
export class ContractorsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @RequirePermissions('contracts:read')
  @ApiOkResponse({ type: [ContractorDto] })
  list(@Tenant() ctx: TenantContext) {
    return this.contracts.listContractors(ctx);
  }

  @Post()
  @RequirePermissions('contracts:manage')
  @ApiCreatedResponse({ type: ContractorDto })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreateContractorDto, @ReqMeta() meta: RequestMeta) {
    return this.contracts.createContractor(ctx, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions('contracts:manage')
  @ApiOkResponse({ type: ContractorDto })
  update(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContractorDto, @ReqMeta() meta: RequestMeta) {
    return this.contracts.updateContractor(ctx, id, dto, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('contracts:manage')
  @ApiNoContentResponse()
  async remove(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    await this.contracts.removeContractor(ctx, id, meta);
  }
}

@ApiTags('contracts')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get()
  @RequirePermissions('contracts:read')
  @ApiOkResponse({ type: [ContractDto] })
  list(@Tenant() ctx: TenantContext, @Query() q: ListContractsQueryDto) {
    return this.contracts.list(ctx, q);
  }

  @Get(':id')
  @RequirePermissions('contracts:read')
  @ApiOkResponse({ type: ContractDetailDto })
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.contracts.get(ctx, id);
  }

  @Post()
  @RequirePermissions('contracts:manage')
  @ApiCreatedResponse({ type: ContractDto })
  @ApiOperation({ summary: 'Cria o contrato como rascunho; ativar gera as contas a receber' })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreateContractDto, @ReqMeta() meta: RequestMeta) {
    return this.contracts.create(ctx, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions('contracts:manage')
  @ApiOkResponse({ type: ContractDto })
  @ApiOperation({ summary: 'Altera o contrato; vale para as competências ainda não geradas' })
  update(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateContractDto, @ReqMeta() meta: RequestMeta) {
    return this.contracts.update(ctx, id, dto, meta);
  }

  @Post(':id/status')
  @HttpCode(200)
  @RequirePermissions('contracts:manage')
  @ApiOkResponse({ type: ContractDto })
  @ApiOperation({ summary: 'Ativa, suspende, encerra ou cancela; encerrar/cancelar cancela as contas futuras sem recebimento' })
  status(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ContractStatusDto, @ReqMeta() meta: RequestMeta) {
    return this.contracts.changeStatus(ctx, id, dto, meta);
  }
}

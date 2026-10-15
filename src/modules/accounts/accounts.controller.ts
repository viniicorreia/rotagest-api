import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import {
  AccountDto,
  AccountListDto,
  AdjustmentDto,
  AdjustmentResultDto,
  CreateAccountDto,
  CreateTransferDto,
  ListAccountsQueryDto,
  ListTransfersQueryDto,
  ReverseDto,
  StatementDto,
  StatementQueryDto,
  TransferDto,
  UpdateAccountDto,
} from './accounts.dto';
import { AccountsService } from './accounts.service';

@ApiTags('accounts')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: AccountListDto })
  @ApiOperation({ summary: 'Contas financeiras com saldo atual calculado pelo razão' })
  list(@Tenant() ctx: TenantContext, @Query() q: ListAccountsQueryDto) {
    return this.accounts.list(ctx, q);
  }

  @Get(':id')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: AccountDto })
  get(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(ctx, id);
  }

  @Get(':id/statement')
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: StatementDto })
  @ApiOperation({ summary: 'Extrato da conta no período, com saldo anterior e saldo após cada lançamento' })
  statement(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Query() q: StatementQueryDto) {
    return this.accounts.statement(ctx, id, q);
  }

  @Post()
  @RequirePermissions('accounts:manage')
  @ApiCreatedResponse({ type: AccountDto })
  @ApiOperation({ summary: 'Cria conta (corrente, poupança, caixa ou outra) com saldo inicial' })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreateAccountDto, @ReqMeta() meta: RequestMeta) {
    return this.accounts.create(ctx, dto, meta);
  }

  @Patch(':id')
  @RequirePermissions('accounts:manage')
  @ApiOkResponse({ type: AccountDto })
  update(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto, @ReqMeta() meta: RequestMeta) {
    return this.accounts.update(ctx, id, dto, meta);
  }

  @Post(':id/adjustments')
  @RequirePermissions('accounts:adjust')
  @ApiCreatedResponse({ type: AdjustmentResultDto })
  @ApiOperation({ summary: 'Ajuste autorizado de saldo, com justificativa e auditoria' })
  adjust(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustmentDto, @ReqMeta() meta: RequestMeta) {
    return this.accounts.adjust(ctx, id, dto, meta);
  }
}

@ApiTags('transfers')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('transfers')
export class TransfersController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: [TransferDto] })
  list(@Tenant() ctx: TenantContext, @Query() q: ListTransfersQueryDto) {
    return this.accounts.listTransfers(ctx, q);
  }

  @Post()
  @RequirePermissions('accounts:manage')
  @ApiCreatedResponse({ type: TransferDto })
  @ApiOperation({ summary: 'Transferência entre contas da empresa (idempotente; não é receita nem despesa)' })
  create(@Tenant() ctx: TenantContext, @Body() dto: CreateTransferDto, @ReqMeta() meta: RequestMeta) {
    return this.accounts.transfer(ctx, dto, meta);
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermissions('accounts:manage')
  @ApiOkResponse({ type: TransferDto })
  @ApiOperation({ summary: 'Estorna a transferência com lançamentos opostos (nada é apagado)' })
  reverse(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseDto, @ReqMeta() meta: RequestMeta) {
    return this.accounts.reverseTransfer(ctx, id, dto, meta);
  }
}

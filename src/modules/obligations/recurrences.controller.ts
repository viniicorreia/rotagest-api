import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { RecurrenceRuleDto, UpdateRecurrenceDto } from './obligations.dto';
import { RecurrenceService } from './recurrence.service';

class ListRecurrencesQueryDto {
  @ApiPropertyOptional({ enum: ['PAYABLE', 'RECEIVABLE'], enumName: 'RecurrenceTarget' })
  @IsOptional()
  @IsIn(['PAYABLE', 'RECEIVABLE'])
  target?: 'PAYABLE' | 'RECEIVABLE';
}

@ApiTags('recurrences')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('recurrences')
export class RecurrencesController {
  constructor(private readonly recurrence: RecurrenceService) {}

  @Get()
  @RequirePermissions('finance:read')
  @ApiOkResponse({ type: [RecurrenceRuleDto] })
  list(@Tenant() ctx: TenantContext, @Query() q: ListRecurrencesQueryDto) {
    return this.recurrence.list(ctx, q.target);
  }

  @Patch(':id')
  @RequirePermissions('finance:manage')
  @ApiOkResponse({ type: RecurrenceRuleDto })
  @ApiOperation({ summary: 'Altera descrição, valor ou dia de vencimento das próximas ocorrências (as já geradas não mudam)' })
  update(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRecurrenceDto, @ReqMeta() meta: RequestMeta) {
    return this.recurrence.update(ctx, id, dto, meta);
  }

  @Post(':id/stop')
  @HttpCode(200)
  @RequirePermissions('finance:manage')
  @ApiOkResponse({ type: RecurrenceRuleDto })
  @ApiOperation({ summary: 'Encerra a recorrência; lançamentos já gerados continuam' })
  stop(@Tenant() ctx: TenantContext, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.recurrence.stop(ctx, id, meta);
  }
}

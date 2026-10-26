import { Body, Controller, Get, HttpCode, Param, Post, Query, Res, type PipeTransform } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReqMeta, RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import { badRequest } from '../../common/errors';
import type { RequestMeta, TenantContext } from '../../common/tenant/tenant-context';
import { MONTH_PATTERN } from '../../domain';
import { toPdf, toXlsx } from '../reports/report-export';
import { ClosingDetailDto, ClosingExportQueryDto, ClosingListDto, ClosingSnapshotDto, ConfirmClosingDto, ListClosingsQueryDto, ReopenClosingDto } from './closings.dto';
import { ClosingsService } from './closings.service';

class MonthPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!MONTH_PATTERN.test(value)) throw badRequest('Mês inválido (use AAAA-MM)');
    return value;
  }
}

@ApiTags('closings')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('closings')
export class ClosingsController {
  constructor(private readonly closings: ClosingsService) {}

  @Get()
  @RequirePermissions('reports:read')
  @ApiOkResponse({ type: ClosingListDto })
  @ApiOperation({ summary: 'Situação do fechamento dos 12 meses do ano' })
  list(@Tenant() ctx: TenantContext, @Query() q: ListClosingsQueryDto) {
    return this.closings.list(ctx, q.year);
  }

  @Get(':month')
  @RequirePermissions('reports:read')
  @ApiParam({ name: 'month', example: '2026-09' })
  @ApiOkResponse({ type: ClosingDetailDto })
  get(@Tenant() ctx: TenantContext, @Param('month', MonthPipe) month: string) {
    return this.closings.get(ctx, month);
  }

  @Get(':month/preview')
  @RequirePermissions('closing:manage')
  @ApiParam({ name: 'month', example: '2026-09' })
  @ApiOkResponse({ type: ClosingSnapshotDto })
  @ApiOperation({ summary: 'Prévia do fechamento (não grava nada)' })
  preview(@Tenant() ctx: TenantContext, @Param('month', MonthPipe) month: string) {
    return this.closings.preview(ctx, month);
  }

  @Post(':month')
  @RequirePermissions('closing:manage')
  @ApiParam({ name: 'month', example: '2026-09' })
  @ApiOkResponse({ type: ClosingDetailDto })
  @ApiOperation({ summary: 'Confirma o fechamento: grava o snapshot e bloqueia lançamentos do mês' })
  @HttpCode(200)
  close(@Tenant() ctx: TenantContext, @Param('month', MonthPipe) month: string, @Body() dto: ConfirmClosingDto, @ReqMeta() meta: RequestMeta) {
    return this.closings.close(ctx, month, dto, meta);
  }

  @Post(':month/reopen')
  @RequirePermissions('closing:reopen')
  @ApiParam({ name: 'month', example: '2026-09' })
  @ApiOkResponse({ type: ClosingDetailDto })
  @ApiOperation({ summary: 'Reabre o mês com justificativa (auditado com o snapshot anterior)' })
  @HttpCode(200)
  reopen(@Tenant() ctx: TenantContext, @Param('month', MonthPipe) month: string, @Body() dto: ReopenClosingDto, @ReqMeta() meta: RequestMeta) {
    return this.closings.reopen(ctx, month, dto, meta);
  }

  @Get(':month/export')
  @RequirePermissions('reports:read')
  @ApiParam({ name: 'month', example: '2026-09' })
  @ApiProduces('application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOkResponse({ description: 'Fechamento (ou prévia) em PDF ou Excel' })
  async export(@Tenant() ctx: TenantContext, @Param('month', MonthPipe) month: string, @Query() q: ClosingExportQueryDto, @Res() res: Response) {
    const { report, company } = await this.closings.exportable(ctx, month);
    const file = q.format === 'pdf' ? await toPdf(report, company) : await toXlsx(report, company);
    res.setHeader('Content-Type', q.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="fechamento-${month}.${q.format}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file);
  }
}

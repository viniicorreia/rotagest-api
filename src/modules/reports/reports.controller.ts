import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiDefaultResponse, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions, Tenant } from '../../common/decorators';
import { ApiErrorDto } from '../../common/dto/error.dto';
import type { TenantContext } from '../../common/tenant/tenant-context';
import { toPdf, toXlsx } from './report-export';
import { ExportQueryDto, ReportCatalogDto, ReportDto, ReportKeyParamDto, ReportQueryDto } from './reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiDefaultResponse({ type: ApiErrorDto, description: 'Erro (formato padrão)' })
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions('reports:read')
  @ApiOkResponse({ type: ReportCatalogDto })
  catalog() {
    return this.reports.catalog();
  }

  @Get(':key')
  @RequirePermissions('reports:read')
  @ApiOkResponse({ type: ReportDto })
  @ApiOperation({ summary: 'Relatório da empresa ativa com filtros e comparativo opcional' })
  get(@Tenant() ctx: TenantContext, @Param() { key }: ReportKeyParamDto, @Query() q: ReportQueryDto) {
    return this.reports.build(ctx, key, q);
  }

  @Get(':key/export')
  @RequirePermissions('reports:read')
  @ApiProduces('application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOkResponse({ description: 'Arquivo PDF ou Excel com os mesmos números do relatório' })
  async export(@Tenant() ctx: TenantContext, @Param() { key }: ReportKeyParamDto, @Query() q: ExportQueryDto, @Res() res: Response) {
    const report = await this.reports.build(ctx, key, q);
    const company = await this.reports.companyName(ctx.companyId);
    const file = q.format === 'pdf' ? await toPdf(report, company) : await toXlsx(report, company);
    const name = `${key}-${report.from}${report.to !== report.from ? `_${report.to}` : ''}.${q.format}`;
    res.setHeader('Content-Type', q.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file);
  }
}

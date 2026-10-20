import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { IsMonth, OptionalMonthProperty, QueryBoolean } from '../../common/validation';

export const REPORT_KEYS = [
  'cash-flow',
  'revenue-by-contract',
  'expenses-by-category',
  'result-by-vehicle',
  'result-by-route',
  'result-by-period',
  'payables',
  'receivables',
  'fuel',
  'maintenance',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];
export const ReportKeyEnum = { enum: REPORT_KEYS, enumName: 'ReportKey' } as const;

export const REPORT_TITLES: Record<ReportKey, string> = {
  'cash-flow': 'Fluxo de caixa',
  'revenue-by-contract': 'Receitas por contrato',
  'expenses-by-category': 'Despesas por categoria',
  'result-by-vehicle': 'Resultado por veículo',
  'result-by-route': 'Resultado por rota',
  'result-by-period': 'Resultado por período',
  payables: 'Contas a pagar',
  receivables: 'Contas a receber',
  fuel: 'Gastos com combustível',
  maintenance: 'Custos de manutenção',
};

export const MAINTENANCE_LABELS: Record<string, string> = {
  PREVENTIVE: 'Preventiva',
  CORRECTIVE: 'Corretiva',
  OIL_CHANGE: 'Troca de óleo',
  TIRES: 'Pneus',
  MECHANICAL: 'Mecânica',
  ELECTRICAL: 'Elétrica',
  OTHER: 'Outros',
};

export class ReportKeyParamDto {
  @ApiProperty(ReportKeyEnum)
  @IsIn(REPORT_KEYS)
  key: ReportKey;
}

export class ReportQueryDto {
  @OptionalMonthProperty('Mês inicial (padrão: mês atual)')
  @IsOptional()
  @IsMonth()
  from?: string;

  @OptionalMonthProperty('Mês final (padrão: o inicial; até 24 meses)')
  @IsOptional()
  @IsMonth()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() vehicleId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() routeId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() contractId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Fluxo de caixa de uma conta' }) @IsOptional() @IsUUID() accountId?: string;

  @ApiPropertyOptional({ enum: ['OPEN', 'OVERDUE', 'SETTLED'], enumName: 'ReportStatusFilter', description: 'Contas a pagar/receber' })
  @IsOptional()
  @IsIn(['OPEN', 'OVERDUE', 'SETTLED'])
  status?: 'OPEN' | 'OVERDUE' | 'SETTLED';

  @ApiPropertyOptional({ type: Boolean, description: 'Inclui os totais do período anterior de mesmo tamanho' })
  @IsOptional()
  @QueryBoolean()
  compare?: boolean;
}

export class ExportQueryDto extends ReportQueryDto {
  @ApiProperty({ enum: ['pdf', 'xlsx'] })
  @IsIn(['pdf', 'xlsx'])
  format: 'pdf' | 'xlsx';
}

export class ReportCatalogItemDto {
  @ApiProperty(ReportKeyEnum) key: ReportKey;
  @ApiProperty() title: string;
}

export class ReportCatalogDto {
  @ApiProperty({ type: [ReportCatalogItemDto] }) items: ReportCatalogItemDto[];
}

export class ReportColumnDto {
  @ApiProperty() key: string;
  @ApiProperty() label: string;
  @ApiProperty({ enum: ['text', 'money', 'number', 'percent', 'date', 'month'], enumName: 'ReportColumnType' }) type: 'text' | 'money' | 'number' | 'percent' | 'date' | 'month';
  @ApiPropertyOptional() sum?: boolean;
}

const CELLS: { type: 'object'; additionalProperties: SchemaObject } = { type: 'object', additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }], nullable: true } };

export class ReportSectionDto {
  @ApiProperty() title: string;
  @ApiProperty({ type: [ReportColumnDto] }) columns: ReportColumnDto[];
  @ApiProperty({ type: 'array', items: CELLS, description: 'Valores por coluna: dinheiro em string "1234.56", datas "AAAA-MM-DD", meses "AAAA-MM", percentuais "12.34"' })
  rows: Record<string, string | number | null>[];
  @ApiProperty({ ...CELLS, nullable: true }) totals: Record<string, string | number | null> | null;
}

export class ReportComparisonDto {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty(CELLS) totals: Record<string, string | number | null>;
}

export class ReportDto {
  @ApiProperty(ReportKeyEnum) key: ReportKey;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ['CASH', 'ACCRUAL', 'DUE', 'OPERATIONAL'], enumName: 'ReportRegime' }) regime: 'CASH' | 'ACCRUAL' | 'DUE' | 'OPERATIONAL';
  @ApiProperty({ example: '2026-10' }) from: string;
  @ApiProperty({ example: '2026-10' }) to: string;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } }) filters: Record<string, string>;
  @ApiProperty({ type: [ReportSectionDto] }) sections: ReportSectionDto[];
  @ApiProperty({ type: [String] }) notes: string[];
  @ApiProperty({ type: ReportComparisonDto, nullable: true }) comparison: ReportComparisonDto | null;
}

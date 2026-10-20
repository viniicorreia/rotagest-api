import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { trimOrUndefined } from '../../common/validation';
import { ReportSectionDto } from '../reports/reports.dto';

export class ListClosingsQueryDto {
  @ApiPropertyOptional({ minimum: 2000, maximum: 2100, description: 'Ano (padrão: o atual)' })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}

export class ConfirmClosingDto {
  @ApiPropertyOptional({ description: 'Versão vista na prévia; se outra pessoa fechar antes, a confirmação falha (409)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}

export class ReopenClosingDto {
  @ApiProperty({ minLength: 10, example: 'Nota fiscal de outubro lançada com valor errado' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class ClosingExportQueryDto {
  @ApiProperty({ enum: ['pdf', 'xlsx'] })
  @IsIn(['pdf', 'xlsx'])
  format: 'pdf' | 'xlsx';
}

export class ClosingTotalsDto {
  @ApiProperty() revenue: string;
  @ApiProperty() expense: string;
  @ApiProperty({ description: 'Resultado gerencial (competência)' }) result: string;
  @ApiProperty() received: string;
  @ApiProperty() paid: string;
  @ApiProperty({ description: 'Resultado de caixa' }) cashResult: string;
  @ApiProperty({ description: 'Saldo das contas no último dia do mês' }) balance: string;
}

export class ClosingPendingDto {
  @ApiProperty() payablesOpenCount: number;
  @ApiProperty() payablesOpen: string;
  @ApiProperty() receivablesOpenCount: number;
  @ApiProperty() receivablesOpen: string;
  @ApiProperty({ description: 'Despesas de motorista do mês aguardando aprovação' }) pendingApprovals: number;
  @ApiProperty({ description: 'Dias de km do mês com valor ainda não faturados' }) unbilledKmDays: number;
  @ApiProperty() unbilledKmAmount: string;
}

export class ClosingSnapshotDto {
  @ApiProperty({ example: '2026-09' }) month: string;
  @ApiProperty({ type: String, format: 'date-time' }) generatedAt: string;
  @ApiProperty({ type: ClosingTotalsDto }) totals: ClosingTotalsDto;
  @ApiProperty({ type: ClosingPendingDto }) pending: ClosingPendingDto;
  @ApiProperty({ type: [ReportSectionDto] }) sections: ReportSectionDto[];
  @ApiProperty({ type: [String] }) warnings: string[];
}

class UserRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
}

export class ClosingDto {
  @ApiProperty({ example: '2026-09' }) month: string;
  @ApiProperty({ enum: ['OPEN', 'CLOSED', 'REOPENED'], enumName: 'ClosingState' }) status: 'OPEN' | 'CLOSED' | 'REOPENED';
  @ApiProperty({ description: '0 = nunca fechado' }) version: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) closedAt: Date | null;
  @ApiProperty({ type: UserRefDto, nullable: true }) closedBy: UserRefDto | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reopenedAt: Date | null;
  @ApiProperty({ type: UserRefDto, nullable: true }) reopenedBy: UserRefDto | null;
  @ApiProperty({ type: String, nullable: true }) reopenReason: string | null;
  @ApiProperty({ description: 'O mês já terminou e pode ser fechado' }) closable: boolean;
}

export class ClosingListDto {
  @ApiProperty() year: number;
  @ApiProperty({ type: [ClosingDto] }) items: ClosingDto[];
}

export class ClosingDetailDto extends ClosingDto {
  @ApiProperty({ type: ClosingSnapshotDto, nullable: true, description: 'Valores gravados no fechamento' }) snapshot: ClosingSnapshotDto | null;
}

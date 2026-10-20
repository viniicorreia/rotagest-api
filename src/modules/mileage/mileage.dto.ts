import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { IsDateOnly, IsMonth, MonthProperty, OptionalDateProperty, QueryBoolean, trimOrNull } from '../../common/validation';
import { KM_PATTERN } from '../../domain';
import { RefDto, VehicleRefDto } from '../fleet/fleet.dto';

export class CreateDailyLogDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  vehicleId: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-20' })
  @IsDateOnly()
  date: string;

  @ApiPropertyOptional({ example: '120.5', description: 'km rodados no dia (1 casa). Pode ser omitido se informar os hodômetros.' })
  @IsOptional()
  @IsString()
  @Matches(KM_PATTERN, { message: 'kmDriven deve estar no formato 120.5' })
  kmDriven?: string;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Hodômetro na saída' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  odometerStart?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Hodômetro na chegada' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  odometerEnd?: number | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  routeId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Ignorado para motoristas (vale o cadastro deles)' })
  @IsOptional()
  @IsUUID()
  driverId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class UpdateDailyLogDto {
  @ApiPropertyOptional({ example: '120.5' })
  @IsOptional()
  @IsString()
  @Matches(KM_PATTERN, { message: 'kmDriven deve estar no formato 120.5' })
  kmDriven?: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  odometerStart?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  odometerEnd?: number | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  routeId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  driverId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class ListDailyLogsQueryDto {
  @OptionalDateProperty('Início (padrão: 1º dia do mês atual)')
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @OptionalDateProperty('Fim (padrão: hoje)')
  @IsOptional()
  @IsDateOnly()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({ description: 'true = só faturados; false = só a faturar' })
  @IsOptional()
  @QueryBoolean()
  billed?: boolean;
}

export class DailyLogDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: VehicleRefDto }) vehicle: VehicleRefDto;
  @ApiProperty({ type: String, format: 'date' }) date: string;
  @ApiProperty({ example: '120.5' }) kmDriven: string;
  @ApiProperty({ type: Number, nullable: true }) odometerStart: number | null;
  @ApiProperty({ type: Number, nullable: true }) odometerEnd: number | null;
  @ApiProperty({ type: RefDto, nullable: true }) route: RefDto | null;
  @ApiProperty({ type: RefDto, nullable: true }) driver: RefDto | null;
  @ApiProperty({ type: String, nullable: true, description: 'R$/km aplicado; null sem finance:read ou sem taxa no veículo' }) ratePerKm: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'km × taxa; null sem finance:read ou sem taxa' }) amount: string | null;
  @ApiProperty({ description: 'Já virou conta a receber (não pode mais ser alterado)' }) billed: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) receivableId: string | null;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ description: 'O usuário logado pode editar ou excluir' }) editable: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class DailyLogSummaryDto {
  @ApiProperty() days: number;
  @ApiProperty({ example: '2450.5' }) km: string;
  @ApiProperty({ type: String, nullable: true, description: 'null sem finance:read' }) amount: string | null;
  @ApiProperty({ type: String, nullable: true }) unbilledAmount: string | null;
  @ApiProperty({ description: 'Dias sem taxa definida no veículo (não entram no valor)' }) missingRateDays: number;
}

export class DailyLogListDto {
  @ApiProperty({ type: [DailyLogDto] }) items: DailyLogDto[];
  @ApiProperty({ type: DailyLogSummaryDto }) summary: DailyLogSummaryDto;
}

export class BillingPreviewQueryDto {
  @MonthProperty('Mês dos km rodados (AAAA-MM)')
  @IsMonth()
  month: string;
}

export class BillingPreviewRowDto {
  @ApiProperty({ type: VehicleRefDto }) vehicle: VehicleRefDto;
  @ApiProperty({ type: String, nullable: true, description: 'Taxa atual do veículo' }) ratePerKm: string | null;
  @ApiProperty({ description: 'Dias a faturar' }) days: number;
  @ApiProperty() km: string;
  @ApiProperty({ description: 'Valor a faturar (dias sem taxa ficam de fora)' }) amount: string;
  @ApiProperty() missingRateDays: number;
  @ApiProperty({ description: 'Valor já faturado no mês' }) billedAmount: string;
  @ApiProperty() billedDays: number;
}

export class BillingPreviewDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ type: [BillingPreviewRowDto] }) vehicles: BillingPreviewRowDto[];
  @ApiProperty() totalAmount: string;
}

export class CreateBillingDto {
  @MonthProperty('Mês dos km rodados; vira a competência da conta a receber')
  @IsMonth()
  month: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-11-05' })
  @IsDateOnly()
  dueDate: string;

  @ApiProperty({ type: [String], format: 'uuid', description: 'Veículos a faturar (uma conta a receber por veículo)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  vehicleIds: string[];

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'Categoria de receita (padrão: Contratos)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class BillingResultItemDto {
  @ApiProperty({ type: VehicleRefDto }) vehicle: VehicleRefDto;
  @ApiProperty({ format: 'uuid' }) receivableId: string;
  @ApiProperty() description: string;
  @ApiProperty() days: number;
  @ApiProperty() km: string;
  @ApiProperty() amount: string;
}

export class BillingResultDto {
  @ApiProperty({ type: [BillingResultItemDto] }) items: BillingResultItemDto[];
}

import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import { isValidPlate, normalizePlate } from '../../../domain';
import { IsMonth, QueryBoolean, trimOrNull, trimOrUndefined } from '../../../common/validation';

export const VEHICLE_STATUSES = ['ACTIVE', 'MAINTENANCE', 'INACTIVE'] as const;
export type VehicleStatusValue = (typeof VEHICLE_STATUSES)[number];
export const VehicleStatusEnum = { enum: VEHICLE_STATUSES, enumName: 'VehicleStatus' } as const;

@ValidatorConstraint({ name: 'plate' })
class PlateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isValidPlate(value);
  }
  defaultMessage() {
    return 'Placa inválida (use ABC1234 ou ABC1D23)';
  }
}

export class CreateVehicleDto {
  @ApiProperty({ example: 'Van 01' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @ApiProperty({ example: 'ABC1D23', description: 'Placa antiga ou Mercosul; hífen e minúsculas são aceitos' })
  @Transform(({ value }) => (typeof value === 'string' ? normalizePlate(value) : value))
  @Validate(PlateConstraint)
  plate: string;

  @ApiPropertyOptional({ example: 'Mercedes-Benz', nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string | null;

  @ApiPropertyOptional({ example: 'Sprinter 416', nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  model?: string | null;

  @ApiPropertyOptional({ example: 2022, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  year?: number | null;

  @ApiPropertyOptional({ example: 85000, description: 'Quilometragem atual' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  odometerKm?: number;

  @ApiPropertyOptional(VehicleStatusEnum)
  @IsOptional()
  @IsEnum(VEHICLE_STATUSES)
  status?: VehicleStatusValue;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {}

export class ListVehiclesQueryDto {
  @ApiPropertyOptional(VehicleStatusEnum)
  @IsOptional()
  @IsEnum(VEHICLE_STATUSES)
  status?: VehicleStatusValue;

  @ApiPropertyOptional({ description: 'Busca por nome ou placa' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;

  @ApiPropertyOptional({ description: 'Inclui veículos arquivados', default: false })
  @IsOptional()
  @QueryBoolean()
  archived?: boolean;
}

export class VehicleSummaryQueryDto {
  @ApiPropertyOptional({ description: 'Competência inicial (AAAA-MM). Padrão: 11 meses antes do mês atual' })
  @IsOptional()
  @IsMonth()
  from?: string;

  @ApiPropertyOptional({ description: 'Competência final (AAAA-MM). Padrão: mês atual' })
  @IsOptional()
  @IsMonth()
  to?: string;
}

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------

export class VehicleDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Sem hífen, maiúsculas' }) plate: string;
  @ApiProperty({ type: String, nullable: true }) brand: string | null;
  @ApiProperty({ type: String, nullable: true }) model: string | null;
  @ApiProperty({ type: Number, nullable: true }) year: number | null;
  @ApiProperty() odometerKm: number;
  @ApiProperty(VehicleStatusEnum) status: VehicleStatusValue;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class VehicleUsageDto {
  @ApiProperty({ description: 'Veículos não arquivados' }) used: number;
  @ApiProperty({ type: Number, nullable: true, description: 'null = ilimitado' }) limit: number | null;
}

export class VehicleListDto {
  @ApiProperty({ type: [VehicleDto] }) items: VehicleDto[];
  @ApiProperty({ type: VehicleUsageDto }) usage: VehicleUsageDto;
}

export class VehicleMonthResultDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ example: '12000.00' }) revenue: string;
  @ApiProperty({ example: '3500.00' }) directCost: string;
  @ApiProperty({ example: '200.00' }) sharedCost: string;
  @ApiProperty({ example: '8300.00' }) result: string;
}

export class VehicleResultDto {
  @ApiProperty({ example: '2026-01' }) from: string;
  @ApiProperty({ example: '2026-10' }) to: string;
  @ApiProperty({ description: 'Regime de competência gerencial' }) regime: 'ACCRUAL';
  @ApiProperty({ description: 'Receitas atribuídas ao veículo' }) revenue: string;
  @ApiProperty({ description: 'Despesas lançadas diretamente no veículo' }) directCost: string;
  @ApiProperty({ description: 'Parcela do veículo em despesas rateadas' }) sharedCost: string;
  @ApiProperty({ description: 'Receitas − despesas (resultado gerencial, não é lucro contábil)' }) result: string;
  @ApiProperty({ type: [VehicleMonthResultDto] }) months: VehicleMonthResultDto[];
}

export class VehicleDetailDto extends VehicleDto {
  @ApiProperty({ type: VehicleResultDto, nullable: true, description: 'null sem a permissão finance:read' }) financial: VehicleResultDto | null;
  @ApiProperty({ description: 'Possui lançamentos financeiros (não pode ser excluído, só arquivado)' }) hasHistory: boolean;
}

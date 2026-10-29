import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, Validate, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import { IsDateOnly, OptionalDateProperty, QueryBoolean, trimOrNull, trimOrUndefined } from '../../common/validation';
import { isValidCpf, onlyDigits } from '../../domain';

export const RECORD_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RecordStatusValue = (typeof RECORD_STATUSES)[number];
const RecordStatusEnum = { enum: RECORD_STATUSES, enumName: 'RecordStatus' } as const;

export const EMPLOYMENT_TYPES = ['EMPLOYEE', 'CONTRACTOR', 'PARTNER', 'OTHER'] as const;
export type EmploymentTypeValue = (typeof EMPLOYMENT_TYPES)[number];
const EmploymentTypeEnum = { enum: EMPLOYMENT_TYPES, enumName: 'EmploymentType' } as const;

export const TRANSPORT_TYPES = ['SCHOOL', 'MUNICIPAL', 'CORPORATE', 'CHARTER', 'INTERCITY', 'OTHER'] as const;
export type TransportTypeValue = (typeof TRANSPORT_TYPES)[number];
const TransportTypeEnum = { enum: TRANSPORT_TYPES, enumName: 'TransportType' } as const;

@ValidatorConstraint({ name: 'cpf' })
class CpfConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return typeof value === 'string' && isValidCpf(value);
  }
  defaultMessage() {
    return 'CPF inválido';
  }
}

// ---------------------------------------------------------------------------
// Motoristas
// ---------------------------------------------------------------------------

export class CreateDriverDto {
  @ApiProperty({ example: 'José da Silva' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '52998224725', description: 'CPF (opcional); pontos e traço são aceitos' })
  // Vazio vira null: o CPF pode ficar para depois.
  @Transform(({ value }) => (typeof value === 'string' ? onlyDigits(value) || null : value))
  @IsOptional()
  @Validate(CpfConstraint)
  document?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @OptionalDateProperty('Data de admissão')
  @IsOptional()
  @IsDateOnly()
  hiredAt?: string | null;

  @ApiPropertyOptional(EmploymentTypeEnum)
  @IsOptional()
  @IsEnum(EMPLOYMENT_TYPES)
  employmentType?: EmploymentTypeValue;

  @ApiPropertyOptional(RecordStatusEnum)
  @IsOptional()
  @IsEnum(RECORD_STATUSES)
  status?: RecordStatusValue;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Membro da empresa (usuário) que acessa o portal do motorista' })
  @IsOptional()
  @IsUUID()
  memberId?: string | null;
}

export class UpdateDriverDto extends PartialType(CreateDriverDto) {}

export class ListFleetQueryDto {
  @ApiPropertyOptional(RecordStatusEnum)
  @IsOptional()
  @IsEnum(RECORD_STATUSES)
  status?: RecordStatusValue;

  @ApiPropertyOptional()
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;
}

export class RefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
}

export class VehicleRefDto extends RefDto {
  @ApiProperty() plate: string;
}

export class DriverDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) document: string | null;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) hiredAt: string | null;
  @ApiProperty(EmploymentTypeEnum) employmentType: EmploymentTypeValue;
  @ApiProperty(RecordStatusEnum) status: RecordStatusValue;
  @ApiProperty({ description: 'Dados pessoais removidos (LGPD); o cadastro não pode mais ser editado' }) anonymized: boolean;
  @ApiProperty({ type: RefDto, nullable: true, description: 'Usuário vinculado (portal do motorista)' }) member: RefDto | null;
  @ApiProperty({ type: [String], description: 'Rotas em que está atribuído hoje' }) currentRoutes: string[];
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

export class CreateRouteDto {
  @ApiProperty({ example: 'Escola Municipal Centro — manhã' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional(TransportTypeEnum)
  @IsOptional()
  @IsEnum(TRANSPORT_TYPES)
  transportType?: TransportTypeValue;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Zona Norte' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  region?: string | null;

  @ApiPropertyOptional(RecordStatusEnum)
  @IsOptional()
  @IsEnum(RECORD_STATUSES)
  status?: RecordStatusValue;
}

export class UpdateRouteDto extends PartialType(CreateRouteDto) {}

export class AssignmentSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: VehicleRefDto, nullable: true }) vehicle: VehicleRefDto | null;
  @ApiProperty({ type: RefDto, nullable: true }) driver: RefDto | null;
  @ApiProperty({ type: String, format: 'date' }) startDate: string;
  @ApiProperty({ type: String, format: 'date', nullable: true }) endDate: string | null;
}

export class RouteDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty(TransportTypeEnum) transportType: TransportTypeValue;
  @ApiProperty({ type: String, nullable: true }) region: string | null;
  @ApiProperty(RecordStatusEnum) status: RecordStatusValue;
  @ApiProperty({ type: [AssignmentSummaryDto], description: 'Atribuições vigentes hoje' }) current: AssignmentSummaryDto[];
}

// ---------------------------------------------------------------------------
// Atribuições
// ---------------------------------------------------------------------------

export class CreateAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  routeId: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  driverId?: string | null;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-01' })
  @IsDateOnly()
  startDate: string;

  @OptionalDateProperty('Último dia (vazio = sem data para terminar)')
  @IsOptional()
  @IsDateOnly()
  endDate?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class EndAssignmentDto {
  @ApiProperty({ type: String, format: 'date', description: 'Último dia da atribuição' })
  @IsDateOnly()
  endDate: string;
}

export class ListAssignmentsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  routeId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiPropertyOptional({ description: 'Só as vigentes hoje', default: false })
  @IsOptional()
  @QueryBoolean()
  current?: boolean;
}

export class AssignmentDto extends AssignmentSummaryDto {
  @ApiProperty({ type: RefDto }) route: RefDto;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ description: 'Vigente hoje' }) active: boolean;
}

export class MyAssignmentsDto {
  @ApiProperty({ type: RefDto, nullable: true, description: 'Cadastro de motorista ligado ao seu usuário; null se não houver' }) driver: RefDto | null;
  @ApiProperty({ type: [AssignmentDto], description: 'Atribuições vigentes hoje' }) assignments: AssignmentDto[];
  @ApiProperty({ type: [VehicleRefDto], description: 'Veículos em que você pode registrar km hoje' }) vehicles: VehicleRefDto[];
}

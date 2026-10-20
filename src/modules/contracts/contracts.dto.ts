import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { IsDateOnly, IsMoney, MoneyProperty, OptionalDateProperty, trimOrNull, trimOrUndefined } from '../../common/validation';
import { onlyDigits } from '../../domain';
import { RefDto, VehicleRefDto } from '../fleet/fleet.dto';
import { PERCENT_PATTERN } from '../obligations/allocation';

export const CONTRACTOR_KINDS = ['SCHOOL', 'CITY_HALL', 'PRIVATE_COMPANY', 'INDIVIDUAL', 'OTHER'] as const;
export type ContractorKindValue = (typeof CONTRACTOR_KINDS)[number];
const ContractorKindEnum = { enum: CONTRACTOR_KINDS, enumName: 'ContractorKind' } as const;

export const BILLING_TYPES = ['MONTHLY', 'FIXED_PERIOD', 'VARIABLE'] as const;
export type BillingTypeValue = (typeof BILLING_TYPES)[number];
const BillingTypeEnum = { enum: BILLING_TYPES, enumName: 'ContractBillingType' } as const;

export const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'ENDED', 'CANCELED'] as const;
export type ContractStatusValue = (typeof CONTRACT_STATUSES)[number];
const ContractStatusEnum = { enum: CONTRACT_STATUSES, enumName: 'ContractStatus' } as const;

// ---------------------------------------------------------------------------
// Contratantes
// ---------------------------------------------------------------------------

export class CreateContractorDto {
  @ApiProperty({ example: 'Prefeitura de Campinas' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional(ContractorKindEnum)
  @IsOptional()
  @IsEnum(CONTRACTOR_KINDS)
  kind?: ContractorKindValue;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'CPF ou CNPJ (opcional)' })
  @Transform(({ value }) => (typeof value === 'string' ? onlyDigits(value) || null : value))
  @IsOptional()
  @Matches(/^(\d{11}|\d{14})$/, { message: 'Documento deve ser CPF (11 dígitos) ou CNPJ (14 dígitos)' })
  document?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'], enumName: 'RecordStatus' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class UpdateContractorDto extends PartialType(CreateContractorDto) {}

export class ContractorDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty(ContractorKindEnum) kind: ContractorKindValue;
  @ApiProperty({ type: String, nullable: true }) document: string | null;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'], enumName: 'RecordStatus' }) status: 'ACTIVE' | 'INACTIVE';
  @ApiProperty({ description: 'Contratos ativos' }) activeContracts: number;
}

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

export class ContractVehicleInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  vehicleId: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '50', description: 'Participação do veículo na receita (soma 100). Vazio em todos = partes iguais.' })
  @IsOptional()
  @IsString()
  @Matches(PERCENT_PATTERN, { message: 'sharePercent deve estar no formato 33.3333' })
  sharePercent?: string | null;
}

export class CreateContractDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  contractorId: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '012/2026' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(40)
  number?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ ...BillingTypeEnum, default: 'MONTHLY', description: 'MONTHLY e FIXED_PERIOD geram uma conta a receber por mês; VARIABLE é faturado por km ou manualmente' })
  @IsOptional()
  @IsEnum(BILLING_TYPES)
  billingType?: BillingTypeValue;

  @MoneyProperty('Valor mensal (em VARIABLE, valor de referência)')
  @IsMoney({ allowZero: true })
  amount: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-02-01' })
  @IsDateOnly()
  startDate: string;

  @OptionalDateProperty('Fim (obrigatório em FIXED_PERIOD)')
  @IsOptional()
  @IsDateOnly()
  endDate?: string | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 31, default: 10, description: 'Dia do vencimento' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 3, default: 1, description: 'Meses depois da competência para vencer (out → vence em nov = 1)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  dueMonthOffset?: number;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Categoria de receita (padrão: Contratos)' })
  @IsOptional()
  @IsUUID()
  revenueCategoryId?: string | null;

  @ApiPropertyOptional({ type: [ContractVehicleInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ContractVehicleInputDto)
  vehicles?: ContractVehicleInputDto[];

  @ApiPropertyOptional({ type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  routeIds?: string[];
}

export class UpdateContractDto extends PartialType(CreateContractDto) {}

export class ContractStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED', 'ENDED', 'CANCELED'], enumName: 'ContractStatusChange' })
  @IsIn(['ACTIVE', 'SUSPENDED', 'ENDED', 'CANCELED'])
  status: 'ACTIVE' | 'SUSPENDED' | 'ENDED' | 'CANCELED';

  @OptionalDateProperty('Último dia, ao encerrar (padrão: hoje)')
  @IsOptional()
  @IsDateOnly()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Motivo (cancelamento das contas futuras em aberto)' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListContractsQueryDto {
  @ApiPropertyOptional(ContractStatusEnum)
  @IsOptional()
  @IsEnum(CONTRACT_STATUSES)
  status?: ContractStatusValue;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  contractorId?: string;
}

export class ContractVehicleDto {
  @ApiProperty({ type: VehicleRefDto }) vehicle: VehicleRefDto;
  @ApiProperty({ type: String, nullable: true }) sharePercent: string | null;
}

export class ContractReceivableDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() competence: string;
  @ApiProperty({ type: String, format: 'date' }) dueDate: string;
  @ApiProperty() amount: string;
  @ApiProperty() receivedAmount: string;
  @ApiProperty() status: string;
}

export class ContractDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: RefDto }) contractor: RefDto;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty(BillingTypeEnum) billingType: BillingTypeValue;
  @ApiProperty() amount: string;
  @ApiProperty({ type: String, format: 'date' }) startDate: string;
  @ApiProperty({ type: String, format: 'date', nullable: true }) endDate: string | null;
  @ApiProperty({ type: Number, nullable: true }) dueDay: number | null;
  @ApiProperty() dueMonthOffset: number;
  @ApiProperty({ type: RefDto, nullable: true }) revenueCategory: RefDto | null;
  @ApiProperty(ContractStatusEnum) status: ContractStatusValue;
  @ApiProperty({ type: [ContractVehicleDto] }) vehicles: ContractVehicleDto[];
  @ApiProperty({ type: [RefDto] }) routes: RefDto[];
}

export class ContractDetailDto extends ContractDto {
  @ApiProperty({ type: [ContractReceivableDto], description: 'Contas a receber geradas (mais recentes primeiro)' }) receivables: ContractReceivableDto[];
}

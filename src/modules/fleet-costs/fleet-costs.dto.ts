import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { IsDateOnly, IsMoney, IsMonth, MoneyProperty, MonthProperty, OptionalDateProperty, OptionalMoneyProperty, OptionalMonthProperty, PageQueryDto, trimOrNull, trimOrUndefined } from '../../common/validation';
import { LITERS_PATTERN, PRICE_PER_LITER_PATTERN } from '../../domain';
import { RefDto, VehicleRefDto } from '../fleet/fleet.dto';
import { AttachmentDto, CategoryRefDto, SettleNowDto } from '../obligations/obligations.dto';
import { PayableDto } from '../payables/payables.dto';

export const MAINTENANCE_TYPES = ['PREVENTIVE', 'CORRECTIVE', 'OIL_CHANGE', 'TIRES', 'MECHANICAL', 'ELECTRICAL', 'OTHER'] as const;
export type MaintenanceTypeValue = (typeof MAINTENANCE_TYPES)[number];
export const MaintenanceTypeEnum = { enum: MAINTENANCE_TYPES, enumName: 'MaintenanceType' } as const;
export const FUEL_TYPES = ['DIESEL', 'DIESEL_S10', 'GASOLINE', 'ETHANOL', 'CNG', 'OTHER'] as const;
export type FuelTypeValue = (typeof FUEL_TYPES)[number];
export const FuelTypeEnum = { enum: FUEL_TYPES, enumName: 'FuelType' } as const;

// ---------------------------------------------------------------------------
// Manutenção
// ---------------------------------------------------------------------------

export class CreateMaintenanceDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  vehicleId: string;

  @ApiProperty(MaintenanceTypeEnum)
  @IsEnum(MAINTENANCE_TYPES)
  type: MaintenanceTypeValue;

  @ApiProperty({ example: 'Troca de óleo e filtros' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-15' })
  @IsDateOnly()
  date: string;

  @MoneyProperty('Valor do serviço (gera a conta a pagar)', '850.00')
  @IsMoney()
  amount: string;

  @OptionalDateProperty('Vencimento da conta (padrão: a data do serviço)')
  @IsOptional()
  @IsDateOnly()
  dueDate?: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: 'Categoria de despesa (padrão: Manutenção; Pneus para o tipo TIRES)' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  odometerKm?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Oficina do João' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @ApiPropertyOptional({ type: SettleNowDto, description: 'Informe para lançar já pago' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettleNowDto)
  settleNow?: SettleNowDto;
}

export class ListMaintenancesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @OptionalMonthProperty('Mês do serviço')
  @IsOptional()
  @IsMonth()
  month?: string;
}

export class CancelCostDto {
  @ApiProperty({ minLength: 3, example: 'Lançado em duplicidade' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

class CostPayableRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELED'], enumName: 'PayableStatus' }) status: string;
  @ApiProperty({ enum: ['APPROVED', 'PENDING_APPROVAL', 'REJECTED'], enumName: 'ApprovalStatus' }) approvalStatus: string;
  @ApiProperty() paidAmount: string;
  @ApiProperty({ format: 'date' }) dueDate: string;
}

export class MaintenanceDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: VehicleRefDto }) vehicle: VehicleRefDto;
  @ApiProperty(MaintenanceTypeEnum) type: MaintenanceTypeValue;
  @ApiProperty() description: string;
  @ApiProperty({ format: 'date' }) date: string;
  @ApiProperty() amount: string;
  @ApiProperty({ type: Number, nullable: true }) odometerKm: number | null;
  @ApiProperty({ type: String, nullable: true }) supplierName: string | null;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ type: CostPayableRefDto, nullable: true }) payable: CostPayableRefDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class MaintenanceListDto {
  @ApiProperty({ type: [MaintenanceDto] }) items: MaintenanceDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty({ description: 'Soma dos não cancelados no filtro' }) amount: string;
}

// ---------------------------------------------------------------------------
// Abastecimento
// ---------------------------------------------------------------------------

export class FuelInputDto {
  @ApiProperty({ ...FuelTypeEnum, default: 'DIESEL' })
  @IsOptional()
  @IsEnum(FUEL_TYPES)
  fuelType?: FuelTypeValue;

  @ApiProperty({ example: '45.320', description: 'Litros (até 3 casas)' })
  @IsString()
  @Matches(LITERS_PATTERN, { message: 'liters deve estar no formato 45.320' })
  liters: string;

  @ApiProperty({ example: '6.099', description: 'Preço por litro (até 4 casas)' })
  @IsString()
  @Matches(PRICE_PER_LITER_PATTERN, { message: 'pricePerLiter deve estar no formato 6.099' })
  pricePerLiter: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9_999_999)
  odometerKm?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Posto Central' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  station?: string | null;
}

export class CreateFuelingDto extends FuelInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  vehicleId: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-15' })
  @IsDateOnly()
  date: string;

  @OptionalMoneyProperty('Total da nota, quando difere de litros × preço por arredondamento da bomba', '276.41')
  @IsOptional()
  @IsMoney()
  amount?: string;

  @OptionalDateProperty('Vencimento da conta (padrão: a data do abastecimento)')
  @IsOptional()
  @IsDateOnly()
  dueDate?: string;

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

  @ApiPropertyOptional({ type: SettleNowDto, description: 'Informe para lançar já pago' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettleNowDto)
  settleNow?: SettleNowDto;
}

export class ListFuelingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @OptionalMonthProperty('Mês do abastecimento')
  @IsOptional()
  @IsMonth()
  month?: string;
}

export class FuelingDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ type: VehicleRefDto }) vehicle: VehicleRefDto;
  @ApiProperty({ type: RefDto, nullable: true }) driver: RefDto | null;
  @ApiProperty(FuelTypeEnum) fuelType: FuelTypeValue;
  @ApiProperty({ format: 'date' }) date: string;
  @ApiProperty() liters: string;
  @ApiProperty() pricePerLiter: string;
  @ApiProperty() amount: string;
  @ApiProperty({ type: Number, nullable: true }) odometerKm: number | null;
  @ApiProperty({ type: String, nullable: true }) station: string | null;
  @ApiProperty({ type: CostPayableRefDto }) payable: CostPayableRefDto;
}

export class FuelingListDto {
  @ApiProperty({ type: [FuelingDto] }) items: FuelingDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty() liters: string;
  @ApiProperty() amount: string;
}

// ---------------------------------------------------------------------------
// Resumo por veículo
// ---------------------------------------------------------------------------

export class CostSummaryQueryDto {
  @MonthProperty()
  @IsMonth()
  month: string;
}

export class VehicleCostRowDto {
  @ApiProperty({ type: VehicleRefDto }) vehicle: VehicleRefDto;
  @ApiProperty({ description: 'km rodados (registro diário)' }) km: string;
  @ApiProperty({ description: 'Valor do km rodado (km × R$/km)' }) kmRevenue: string;
  @ApiProperty() liters: string;
  @ApiProperty() fuelCost: string;
  @ApiProperty() maintenanceCost: string;
  @ApiProperty({ type: String, nullable: true, description: 'km por litro no mês' }) kmPerLiter: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Custo (combustível + manutenção) por km, 4 casas' }) costPerKm: string | null;
}

export class CostSummaryDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ type: [VehicleCostRowDto] }) vehicles: VehicleCostRowDto[];
}

// ---------------------------------------------------------------------------
// Despesas do motorista e aprovação
// ---------------------------------------------------------------------------

export class CreateDriverExpenseDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-10-15' })
  @IsDateOnly()
  date: string;

  @ApiProperty({ format: 'uuid', description: 'Categoria de despesa' })
  @IsUUID()
  categoryId: string;

  @MoneyProperty(undefined, '120.00')
  @IsMoney()
  amount: string;

  @ApiProperty({ example: 'Borracharia na rota' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Veículo em que o motorista está escalado na data' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierName?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @ApiPropertyOptional({ type: FuelInputDto, description: 'Detalhe de abastecimento (exige veículo)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => FuelInputDto)
  fuel?: FuelInputDto;
}

export const APPROVAL_FILTERS = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'] as const;

export class ListExpenseApprovalsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: APPROVAL_FILTERS, enumName: 'ApprovalStatus', default: 'PENDING_APPROVAL' })
  @IsOptional()
  @IsIn(APPROVAL_FILTERS)
  status?: (typeof APPROVAL_FILTERS)[number];
}

export class RejectExpenseDto {
  @ApiProperty({ minLength: 3, example: 'Sem comprovante legível' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class DriverExpenseDto extends PayableDto {
  @ApiProperty({ type: RefDto, nullable: true }) driver: RefDto | null;
  @ApiProperty({ type: FuelingDto, nullable: true }) fuel: Omit<FuelingDto, 'payable'> | null;
  @ApiProperty({ type: [AttachmentDto] }) attachments: AttachmentDto[];
}

export class DriverExpenseListDto {
  @ApiProperty({ type: [DriverExpenseDto] }) items: DriverExpenseDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}

export class ExpenseCategoryListDto {
  @ApiProperty({ type: [CategoryRefDto] }) items: CategoryRefDto[];
}

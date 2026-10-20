import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { DateProperty, IsDateOnly, IsMoney, IsMonth, MoneyProperty, MonthProperty, OptionalDateProperty, OptionalMoneyProperty, OptionalMonthProperty, trimOrNull, trimOrUndefined } from '../../common/validation';
import {
  AllocationDto,
  AttachmentDto,
  CategoryRefDto,
  EntryKindEnum,
  ObligationQueryDto,
  ObligationSummaryDto,
  RecurrenceInputDto,
  SettlementDto,
  SettleNowDto,
  SplitInputDto,
  VehicleRefDto,
  type EntryKindValue,
} from '../obligations/obligations.dto';

export const RECEIVABLE_STATUSES = ['PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELED'] as const;
export type ReceivableStatusValue = (typeof RECEIVABLE_STATUSES)[number];
export const ReceivableStatusEnum = { enum: RECEIVABLE_STATUSES, enumName: 'ReceivableStatus' } as const;
export const RECEIVABLE_FILTERS = [...RECEIVABLE_STATUSES, 'OPEN', 'OVERDUE'] as const;
export const ReceivableFilterEnum = { enum: RECEIVABLE_FILTERS, enumName: 'ReceivableStatusFilter' } as const;

export class CreateReceivableDto extends SplitInputDto {
  @ApiProperty({ example: 'Contrato Escola Municipal — outubro' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description: string;

  @ApiProperty({ format: 'uuid', description: 'Categoria de receita ativa' })
  @IsUUID()
  categoryId: string;

  @MoneyProperty('Valor; em receita parcelada é o valor TOTAL, dividido entre as parcelas')
  @IsMoney()
  amount: string;

  @MonthProperty('Competência (mês a que a receita pertence)')
  @IsMonth()
  competence: string;

  @DateProperty('Vencimento (da primeira parcela/ocorrência)')
  @IsDateOnly()
  dueDate: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Veículo: a receita é atribuída 100% a ele' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;


  @ApiPropertyOptional({ nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;

  @ApiPropertyOptional({ ...EntryKindEnum, default: 'SINGLE' })
  @IsOptional()
  @IsIn(['SINGLE', 'RECURRING', 'INSTALLMENT'])
  kind?: EntryKindValue;

  @ApiPropertyOptional({ minimum: 2, maximum: 120, description: 'Obrigatório quando kind = INSTALLMENT' })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(120)
  installmentCount?: number;

  @ApiPropertyOptional({ type: RecurrenceInputDto, description: 'Obrigatório quando kind = RECURRING' })
  @IsOptional()
  @ValidateNested()
  @Type(() => RecurrenceInputDto)
  recurrence?: RecurrenceInputDto;

  @ApiPropertyOptional({ type: SettleNowDto, description: 'Lançar já recebido (somente kind = SINGLE)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettleNowDto)
  settleNow?: SettleNowDto;
}

export class UpdateReceivableDto extends SplitInputDto {
  @ApiPropertyOptional()
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @OptionalMoneyProperty('Não pode ficar abaixo do valor já recebido')
  @IsOptional()
  @IsMoney()
  amount?: string;

  @OptionalMonthProperty()
  @IsOptional()
  @IsMonth()
  competence?: string;

  @OptionalDateProperty()
  @IsOptional()
  @IsDateOnly()
  dueDate?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;


  @ApiPropertyOptional({ nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class ListReceivablesQueryDto extends ObligationQueryDto {
  @ApiPropertyOptional({ ...ReceivableFilterEnum, description: 'OPEN = pendente ou parcial; OVERDUE = em aberto e vencida' })
  @IsOptional()
  @IsIn(RECEIVABLE_FILTERS)
  status?: (typeof RECEIVABLE_FILTERS)[number];
}

export class ReceivableDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() description: string;
  @ApiProperty({ type: CategoryRefDto }) category: CategoryRefDto;
  @ApiProperty() amount: string;
  @ApiProperty() receivedAmount: string;
  @ApiProperty({ description: 'Saldo em aberto = valor − recebido' }) openAmount: string;
  @ApiProperty({ example: '2026-10' }) competence: string;
  @ApiProperty({ format: 'date' }) dueDate: string;
  @ApiProperty(ReceivableStatusEnum) status: ReceivableStatusValue;
  @ApiProperty({ description: 'Derivado: em aberto e vencimento antes de hoje' }) overdue: boolean;
  @ApiProperty(EntryKindEnum) kind: EntryKindValue;
  @ApiProperty({ type: Number, nullable: true }) installmentNumber: number | null;
  @ApiProperty({ type: Number, nullable: true }) installmentCount: number | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) installmentGroupId: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) recurrenceRuleId: string | null;
  @ApiProperty({ type: VehicleRefDto, nullable: true }) vehicle: VehicleRefDto | null;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) canceledAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null;
  @ApiProperty() attachmentsCount: number;
  @ApiProperty({ description: 'Quantos veículos dividem o valor (0 = sem rateio)' }) splitVehicles: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class ReceivableDetailDto extends ReceivableDto {
  @ApiProperty({ type: [SettlementDto] }) settlements: SettlementDto[];
  @ApiProperty({ type: [AttachmentDto] }) attachments: AttachmentDto[];
  @ApiProperty({ type: [AllocationDto] }) allocations: AllocationDto[];
}

export class ReceivableListDto {
  @ApiProperty({ type: [ReceivableDto] }) items: ReceivableDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty({ type: ObligationSummaryDto, description: 'Totais de todo o filtro (não só da página)' }) summary: ObligationSummaryDto;
}

export class CreateReceivableResultDto {
  @ApiProperty({ type: [ReceivableDto], description: 'Obrigações criadas (1 avulsa, n parcelas ou as ocorrências já geradas da recorrência)' })
  items: ReceivableDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) recurrenceRuleId: string | null;
}

export class ReceivableSettlementResultDto {
  @ApiProperty({ type: SettlementDto }) settlement: SettlementDto;
  @ApiProperty({ type: ReceivableDto }) receivable: ReceivableDto;
}

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
  VehicleRefDto,
  type EntryKindValue,
} from '../obligations/obligations.dto';

export const PAYABLE_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELED'] as const;
export type PayableStatusValue = (typeof PAYABLE_STATUSES)[number];
export const PayableStatusEnum = { enum: PAYABLE_STATUSES, enumName: 'PayableStatus' } as const;
export const PAYABLE_FILTERS = [...PAYABLE_STATUSES, 'OPEN', 'OVERDUE'] as const;
export const PayableFilterEnum = { enum: PAYABLE_FILTERS, enumName: 'PayableStatusFilter' } as const;

export class CreatePayableDto {
  @ApiProperty({ example: 'Seguro da Van 01' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description: string;

  @ApiProperty({ format: 'uuid', description: 'Categoria de despesa ativa' })
  @IsUUID()
  categoryId: string;

  @MoneyProperty('Valor; em despesa parcelada é o valor TOTAL, dividido entre as parcelas')
  @IsMoney()
  amount: string;

  @MonthProperty('Competência (mês a que a despesa pertence)')
  @IsMonth()
  competence: string;

  @DateProperty('Vencimento (da primeira parcela/ocorrência)')
  @IsDateOnly()
  dueDate: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Veículo: a despesa é alocada 100% nele (custo direto)' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Auto Peças Central' })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  supplierName?: string | null;

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

  @ApiPropertyOptional({ type: SettleNowDto, description: 'Lançar já pago (somente kind = SINGLE)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => SettleNowDto)
  settleNow?: SettleNowDto;
}

export class UpdatePayableDto {
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

  @OptionalMoneyProperty('Não pode ficar abaixo do valor já pago')
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
  @MaxLength(120)
  supplierName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}

export class ListPayablesQueryDto extends ObligationQueryDto {
  @ApiPropertyOptional({ ...PayableFilterEnum, description: 'OPEN = pendente ou parcial; OVERDUE = em aberto e vencida' })
  @IsOptional()
  @IsIn(PAYABLE_FILTERS)
  status?: (typeof PAYABLE_FILTERS)[number];
}

export class PayableDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() description: string;
  @ApiProperty({ type: CategoryRefDto }) category: CategoryRefDto;
  @ApiProperty() amount: string;
  @ApiProperty() paidAmount: string;
  @ApiProperty({ description: 'Saldo em aberto = valor − pago' }) openAmount: string;
  @ApiProperty({ example: '2026-10' }) competence: string;
  @ApiProperty({ format: 'date' }) dueDate: string;
  @ApiProperty(PayableStatusEnum) status: PayableStatusValue;
  @ApiProperty({ description: 'Derivado: em aberto e vencimento antes de hoje' }) overdue: boolean;
  @ApiProperty(EntryKindEnum) kind: EntryKindValue;
  @ApiProperty({ type: Number, nullable: true }) installmentNumber: number | null;
  @ApiProperty({ type: Number, nullable: true }) installmentCount: number | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) installmentGroupId: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) recurrenceRuleId: string | null;
  @ApiProperty({ type: VehicleRefDto, nullable: true }) vehicle: VehicleRefDto | null;
  @ApiProperty({ type: String, nullable: true }) supplierName: string | null;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ enum: ['APPROVED', 'PENDING_APPROVAL', 'REJECTED'], enumName: 'ApprovalStatus' }) approvalStatus: 'APPROVED' | 'PENDING_APPROVAL' | 'REJECTED';
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) canceledAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) cancelReason: string | null;
  @ApiProperty() attachmentsCount: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class PayableDetailDto extends PayableDto {
  @ApiProperty({ type: [SettlementDto] }) settlements: SettlementDto[];
  @ApiProperty({ type: [AttachmentDto] }) attachments: AttachmentDto[];
  @ApiProperty({ type: [AllocationDto] }) allocations: AllocationDto[];
}

export class PayableListDto {
  @ApiProperty({ type: [PayableDto] }) items: PayableDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty({ type: ObligationSummaryDto, description: 'Totais de todo o filtro (não só da página)' }) summary: ObligationSummaryDto;
}

export class CreatePayableResultDto {
  @ApiProperty({ type: [PayableDto], description: 'Obrigações criadas (1 avulsa, n parcelas ou as ocorrências já geradas da recorrência)' })
  items: PayableDto[];
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) recurrenceRuleId: string | null;
}

export class PayableSettlementResultDto {
  @ApiProperty({ type: SettlementDto }) settlement: SettlementDto;
  @ApiProperty({ type: PayableDto }) payable: PayableDto;
}

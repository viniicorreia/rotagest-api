import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  IsDateOnly,
  IsMoney,
  IsMonth,
  OptionalDateProperty,
  OptionalMoneyProperty,
  OptionalMonthProperty,
  PageQueryDto,
  trimOrNull,
  trimOrUndefined,
} from '../../common/validation';
import { CategoryTypeEnum } from '../categories/categories.dto';

export const PAYMENT_METHODS = ['PIX', 'CASH', 'TRANSFER', 'DEPOSIT', 'BOLETO', 'CARD', 'OTHER'] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];
export const PaymentMethodEnum = { enum: PAYMENT_METHODS, enumName: 'PaymentMethod' } as const;
export const EntryKindEnum = { enum: ['SINGLE', 'RECURRING', 'INSTALLMENT'], enumName: 'EntryKind' } as const;
export type EntryKindValue = 'SINGLE' | 'RECURRING' | 'INSTALLMENT';
export const RecurrenceFrequencyEnum = { enum: ['MONTHLY', 'YEARLY'], enumName: 'RecurrenceFrequency' } as const;
export const SettlementTypeEnum = { enum: ['PAYMENT', 'RECEIPT'], enumName: 'SettlementType' } as const;
export const CancelScopeEnum = { enum: ['ONE', 'THIS_AND_FUTURE'], enumName: 'CancelScope' } as const;

// ---------------------------------------------------------------------------
// Entradas compartilhadas
// ---------------------------------------------------------------------------

export class RecurrenceInputDto {
  @ApiProperty(RecurrenceFrequencyEnum)
  @IsIn(['MONTHLY', 'YEARLY'])
  frequency: 'MONTHLY' | 'YEARLY';

  @OptionalMonthProperty('Última competência (inclusive). Sem fim se omitido')
  @IsOptional()
  @IsMonth()
  endMonth?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 360, description: 'Número máximo de ocorrências' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(360)
  maxOccurrences?: number;
}

export class SettleNowDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  accountId: string;

  @OptionalDateProperty('Data efetiva (padrão: hoje; não pode ser futura)')
  @IsOptional()
  @IsDateOnly()
  settledAt?: string;

  @ApiProperty(PaymentMethodEnum)
  @IsEnum(PAYMENT_METHODS)
  method: PaymentMethodValue;

  @ApiProperty({ description: 'Chave gerada pelo cliente por tentativa' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

export class SettleDto extends SettleNowDto {
  @OptionalMoneyProperty('Valor desta liquidação (padrão: todo o saldo em aberto). Parcial é permitido.')
  @IsOptional()
  @IsMoney()
  amount?: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}

export class CancelObligationDto {
  @ApiProperty({ minLength: 3, example: 'Lançado em duplicidade' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @ApiPropertyOptional({ ...CancelScopeEnum, default: 'ONE', description: 'THIS_AND_FUTURE cancela também as parcelas/ocorrências seguintes em aberto (e encerra a recorrência)' })
  @IsOptional()
  @IsIn(['ONE', 'THIS_AND_FUTURE'])
  scope?: 'ONE' | 'THIS_AND_FUTURE';
}

export class ReverseSettlementDto {
  @ApiProperty({ minLength: 10, example: 'Pagamento registrado na conta errada' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

/** Filtros comuns de listagem de contas a pagar/receber. */
export class ObligationQueryDto extends PageQueryDto {
  @OptionalDateProperty('Vencimento a partir de')
  @IsOptional()
  @IsDateOnly()
  dueFrom?: string;

  @OptionalDateProperty('Vencimento até')
  @IsOptional()
  @IsDateOnly()
  dueTo?: string;

  @OptionalMonthProperty('Competência a partir de')
  @IsOptional()
  @IsMonth()
  competenceFrom?: string;

  @OptionalMonthProperty('Competência até')
  @IsOptional()
  @IsMonth()
  competenceTo?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({ description: 'Busca na descrição' })
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

// ---------------------------------------------------------------------------
// Respostas compartilhadas
// ---------------------------------------------------------------------------

export class CategoryRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty(CategoryTypeEnum) type: 'INCOME' | 'EXPENSE';
  @ApiProperty({ type: String, nullable: true }) systemKey: string | null;
}

export class VehicleRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() plate: string;
}

export class AccountRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
}

export class SettlementDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty(SettlementTypeEnum) type: 'PAYMENT' | 'RECEIPT';
  @ApiProperty() amount: string;
  @ApiProperty({ format: 'date', description: 'Data efetiva (caixa)' }) settledAt: string;
  @ApiProperty(PaymentMethodEnum) method: PaymentMethodValue;
  @ApiProperty({ type: AccountRefDto }) account: AccountRefDto;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reversedAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) reversalReason: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) payableId: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) receivableId: string | null;
}

export class AttachmentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() originalName: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) settlementId: string | null;
}

export class AllocationDto {
  @ApiProperty({ type: VehicleRefDto, nullable: true }) vehicle: VehicleRefDto | null;
  @ApiProperty({ enum: ['DIRECT', 'EQUAL', 'PERCENT', 'FIXED', 'REVENUE_PROPORTIONAL'], enumName: 'AllocationMethod' }) method: string;
  @ApiProperty() amount: string;
}

export class ObligationSummaryDto {
  @ApiProperty({ description: 'Valor total (sem canceladas)' }) amount: string;
  @ApiProperty({ description: 'Já liquidado' }) settled: string;
  @ApiProperty({ description: 'Saldo em aberto' }) open: string;
  @ApiProperty({ description: 'Saldo em aberto vencido' }) overdue: string;
  @ApiProperty() overdueCount: number;
}

export class RecurrenceRuleDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['PAYABLE', 'RECEIVABLE'], enumName: 'RecurrenceTarget' }) target: 'PAYABLE' | 'RECEIVABLE';
  @ApiProperty(RecurrenceFrequencyEnum) frequency: 'MONTHLY' | 'YEARLY';
  @ApiProperty() description: string;
  @ApiProperty() amount: string;
  @ApiProperty({ example: '2026-08' }) startMonth: string;
  @ApiProperty({ type: String, nullable: true, example: '2027-07' }) endMonth: string | null;
  @ApiProperty({ type: Number, nullable: true }) maxOccurrences: number | null;
  @ApiProperty() dueDay: number;
  @ApiProperty({ type: String, nullable: true, example: '2026-11' }) lastGeneratedMonth: string | null;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'], enumName: 'RecordStatus' }) status: 'ACTIVE' | 'INACTIVE';
  @ApiProperty({ type: CategoryRefDto }) category: CategoryRefDto;
}

export class UpdateRecurrenceDto {
  @ApiPropertyOptional()
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description?: string;

  @OptionalMoneyProperty('Novo valor para as próximas ocorrências ainda não geradas')
  @IsOptional()
  @IsMoney()
  amount?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number;
}


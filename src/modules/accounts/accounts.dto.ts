import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import {
  DateProperty,
  IsDateOnly,
  IsMoney,
  MoneyProperty,
  OptionalDateProperty,
  QueryBoolean,
  trimOrNull,
  trimOrUndefined,
} from '../../common/validation';
import { RecordStatusEnum } from '../categories/categories.dto';

export const ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'CASH', 'OTHER'] as const;
export type AccountTypeValue = (typeof ACCOUNT_TYPES)[number];
export const AccountTypeEnum = { enum: ACCOUNT_TYPES, enumName: 'FinancialAccountType' } as const;
export const DirectionEnum = { enum: ['IN', 'OUT'], enumName: 'TransactionDirection' } as const;
export const TransactionKindEnum = {
  enum: ['OPENING_BALANCE', 'SETTLEMENT', 'TRANSFER', 'ADJUSTMENT', 'REVERSAL'],
  enumName: 'TransactionKind',
} as const;

/** Saldo inicial pode ser negativo (conta no cheque especial). */
const SIGNED_MONEY = /^-?\d{1,12}(\.\d{1,2})?$/;

export class CreateAccountDto {
  @ApiProperty({ example: 'Banco do Brasil' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiProperty(AccountTypeEnum)
  @IsEnum(ACCOUNT_TYPES)
  type: AccountTypeValue;

  @ApiPropertyOptional({ example: 'Banco do Brasil', nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  bankName?: string | null;

  @ApiProperty({ type: String, example: '2500.00', pattern: SIGNED_MONEY.source, description: 'Saldo na data do saldo inicial; pode ser negativo' })
  @Matches(SIGNED_MONEY, { message: 'openingBalance deve estar no formato 1234.56' })
  openingBalance: string;

  @DateProperty('Data do saldo inicial (não pode ser futura)')
  @IsDateOnly()
  openingBalanceDate: string;
}

export class UpdateAccountDto {
  @ApiPropertyOptional()
  @Transform(trimOrUndefined)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional(AccountTypeEnum)
  @IsOptional()
  @IsEnum(ACCOUNT_TYPES)
  type?: AccountTypeValue;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  bankName?: string | null;

  @ApiPropertyOptional({ ...RecordStatusEnum, description: 'Só é possível desativar uma conta com saldo zero' })
  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ type: String, example: '2500.00', pattern: SIGNED_MONEY.source })
  @IsOptional()
  @Matches(SIGNED_MONEY, { message: 'openingBalance deve estar no formato 1234.56' })
  openingBalance?: string;

  @OptionalDateProperty()
  @IsOptional()
  @IsDateOnly()
  openingBalanceDate?: string;
}

export class ListAccountsQueryDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @QueryBoolean()
  includeInactive?: boolean;
}

export class StatementQueryDto {
  @OptionalDateProperty('Início (padrão: 1º dia do mês atual)')
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @OptionalDateProperty('Fim (padrão: hoje)')
  @IsOptional()
  @IsDateOnly()
  to?: string;
}

export class AdjustmentDto {
  @ApiProperty(DirectionEnum)
  @IsEnum(['IN', 'OUT'])
  direction: 'IN' | 'OUT';

  @MoneyProperty()
  @IsMoney()
  amount: string;

  @DateProperty()
  @IsDateOnly()
  occurredAt: string;

  @ApiProperty({ minLength: 10, example: 'Diferença de conciliação com o extrato de outubro' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class CreateTransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  fromAccountId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  toAccountId: string;

  @MoneyProperty()
  @IsMoney()
  amount: string;

  @DateProperty('Data da transferência (não pode ser futura)')
  @IsDateOnly()
  transferredAt: string;

  @ApiPropertyOptional({ nullable: true })
  @Transform(trimOrNull)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string | null;

  @ApiProperty({ description: 'Chave gerada pelo cliente por tentativa; repetir a chave não duplica a transferência', example: 'c0a8012e-7f3b-4c55-9a3e-2f1d6b8e9a10' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}

export class ReverseDto {
  @ApiProperty({ minLength: 10, example: 'Lançado na conta errada' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

export class ListTransfersQueryDto extends StatementQueryDto {}

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------

export class AccountDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty(AccountTypeEnum) type: AccountTypeValue;
  @ApiProperty({ type: String, nullable: true }) bankName: string | null;
  @ApiProperty({ example: '2500.00' }) openingBalance: string;
  @ApiProperty({ format: 'date' }) openingBalanceDate: string;
  @ApiProperty(RecordStatusEnum) status: 'ACTIVE' | 'INACTIVE';
  @ApiProperty({ example: '3120.45', description: 'Saldo atual = Σ entradas − Σ saídas do razão' }) balance: string;
}

export class AccountListDto {
  @ApiProperty({ type: [AccountDto] }) items: AccountDto[];
  @ApiProperty({ example: '5120.45', description: 'Soma dos saldos das contas ativas' }) totalBalance: string;
}

export class StatementEntryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'date' }) occurredAt: string;
  @ApiProperty(TransactionKindEnum) kind: 'OPENING_BALANCE' | 'SETTLEMENT' | 'TRANSFER' | 'ADJUSTMENT' | 'REVERSAL';
  @ApiProperty(DirectionEnum) direction: 'IN' | 'OUT';
  @ApiProperty() amount: string;
  @ApiProperty() description: string;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ description: 'Saldo da conta depois deste lançamento' }) balanceAfter: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) settlementId: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) transferId: string | null;
  @ApiProperty({ description: 'Este lançamento já foi estornado' }) reversed: boolean;
}

export class StatementDto {
  @ApiProperty({ type: AccountDto }) account: AccountDto;
  @ApiProperty({ format: 'date' }) from: string;
  @ApiProperty({ format: 'date' }) to: string;
  @ApiProperty({ description: 'Saldo antes de `from`' }) openingBalance: string;
  @ApiProperty({ description: 'Saldo ao fim de `to`' }) closingBalance: string;
  @ApiProperty() totalIn: string;
  @ApiProperty() totalOut: string;
  @ApiProperty({ type: [StatementEntryDto] }) entries: StatementEntryDto[];
}

export class TransferDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) fromAccountId: string;
  @ApiProperty() fromAccountName: string;
  @ApiProperty({ format: 'uuid' }) toAccountId: string;
  @ApiProperty() toAccountName: string;
  @ApiProperty() amount: string;
  @ApiProperty({ format: 'date' }) transferredAt: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reversedAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class AdjustmentResultDto {
  @ApiProperty({ type: StatementEntryDto }) entry: StatementEntryDto;
  @ApiProperty({ description: 'Saldo atual da conta depois do ajuste' }) balance: string;
}

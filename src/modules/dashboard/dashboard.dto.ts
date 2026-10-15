import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { IsMonth, OptionalMonthProperty } from '../../common/validation';
import { AccountTypeEnum, type AccountTypeValue } from '../accounts/accounts.dto';

export class DashboardQueryDto {
  @OptionalMonthProperty('Competência/mês inicial (padrão: mês atual)')
  @IsOptional()
  @IsMonth()
  from?: string;

  @OptionalMonthProperty('Competência/mês final (padrão: igual ao inicial)')
  @IsOptional()
  @IsMonth()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Considera só o que foi atribuído a este veículo' })
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export class AccountBalanceDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty(AccountTypeEnum) type: AccountTypeValue;
  @ApiProperty() balance: string;
}

export class BalancesDto {
  @ApiProperty({ description: 'Saldo total das contas ativas hoje (sempre da empresa, sem filtros)' }) total: string;
  @ApiProperty({ type: [AccountBalanceDto] }) accounts: AccountBalanceDto[];
}

export class CashDto {
  @ApiProperty({ description: 'Regime de caixa: recebimentos e pagamentos efetivos no período' }) regime: 'CASH';
  @ApiProperty() received: string;
  @ApiProperty() paid: string;
  @ApiProperty({ description: 'Recebido − pago' }) result: string;
}

export class AccrualDto {
  @ApiProperty({ description: 'Competência gerencial: receitas e despesas previstas do período' }) regime: 'ACCRUAL';
  @ApiProperty() revenue: string;
  @ApiProperty() expense: string;
  @ApiProperty({ description: 'Resultado gerencial (não é lucro líquido contábil)' }) result: string;
}

export class OpenObligationsDto {
  @ApiProperty({ description: 'Saldo em aberto (todas as datas)' }) open: string;
  @ApiProperty() openCount: number;
  @ApiProperty({ description: 'Em aberto e vencido' }) overdue: string;
  @ApiProperty() overdueCount: number;
  @ApiProperty({ description: 'Vence de hoje até 7 dias' }) dueSoon: string;
  @ApiProperty() dueSoonCount: number;
}

export class VehicleResultRowDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'null = não alocado a veículo' }) vehicleId: string | null;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) plate: string | null;
  @ApiProperty() revenue: string;
  @ApiProperty() cost: string;
  @ApiProperty() result: string;
}

export class VehiclesSummaryDto {
  @ApiProperty() active: number;
  @ApiProperty({ description: 'Custo médio por veículo ativo no período (competência)' }) costPerVehicle: string;
  @ApiProperty({ type: [VehicleResultRowDto], description: 'Resultado por veículo; inclui a linha "Não alocado" quando houver' })
  results: VehicleResultRowDto[];
}

export class MonthlyPointDto {
  @ApiProperty({ example: '2026-10' }) month: string;
  @ApiProperty({ description: 'Caixa: recebido' }) cashIn: string;
  @ApiProperty({ description: 'Caixa: pago' }) cashOut: string;
  @ApiProperty({ description: 'Competência: receitas' }) revenue: string;
  @ApiProperty({ description: 'Competência: despesas' }) expense: string;
  @ApiProperty({ description: 'Competência: manutenção, peças, pneus e borracharia' }) maintenance: string;
  @ApiProperty({ description: 'Competência: combustível' }) fuel: string;
}

export class CategoryAmountDto {
  @ApiProperty({ format: 'uuid' }) categoryId: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) systemKey: string | null;
  @ApiProperty() amount: string;
}

export class DashboardDto {
  @ApiProperty({ example: '2026-10' }) from: string;
  @ApiProperty({ example: '2026-10' }) to: string;
  @ApiProperty({ type: BalancesDto }) balances: BalancesDto;
  @ApiProperty({ type: CashDto }) cash: CashDto;
  @ApiProperty({ type: AccrualDto }) accrual: AccrualDto;
  @ApiProperty({ type: OpenObligationsDto }) payables: OpenObligationsDto;
  @ApiProperty({ type: OpenObligationsDto }) receivables: OpenObligationsDto;
  @ApiProperty({ type: VehiclesSummaryDto }) vehicles: VehiclesSummaryDto;
  @ApiProperty({ type: [MonthlyPointDto], description: 'Até 12 meses terminando em `to`' }) monthly: MonthlyPointDto[];
  @ApiProperty({ type: [CategoryAmountDto], description: 'Despesas do período por categoria (competência)' }) expensesByCategory: CategoryAmountDto[];
}

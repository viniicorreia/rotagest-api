import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionStatusEnum } from '../../common/dto/enums';

export class PlanFeatureDto {
  @ApiProperty() key: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty({ type: Number, nullable: true }) limit: number | null;
}

export class PlanSummaryDto {
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: String, description: 'Decimal serializado como texto', example: '49.9' }) price: string;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'], enumName: 'BillingInterval' }) interval: 'MONTHLY' | 'YEARLY';
  @ApiProperty({ type: [PlanFeatureDto] }) features: PlanFeatureDto[];
}

export class PlanLimitsDto {
  @ApiProperty({ type: Number, nullable: true, description: 'null = ilimitado' }) maxUsers: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'null = ilimitado' }) maxVehicles: number | null;
}

export class PlanUsageDto {
  @ApiProperty({ description: 'Membros ativos + convites pendentes' }) users: number;
  @ApiProperty() vehicles: number;
}

export class SubscriptionBillingDto {
  @ApiProperty({ description: 'Há gateway de pagamento integrado; sem ele, a mudança de plano é feita pela plataforma' }) configured: boolean;
  @ApiProperty({ type: String, nullable: true }) provider: string | null;
}

export class SubscriptionDto {
  @ApiProperty(SubscriptionStatusEnum) status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'SUSPENDED';
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) trialEndsAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) currentPeriodStart: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) currentPeriodEnd: Date | null;
  @ApiProperty({ type: PlanSummaryDto }) plan: PlanSummaryDto;
  @ApiProperty({ type: PlanLimitsDto }) limits: PlanLimitsDto;
  @ApiProperty({ type: PlanUsageDto }) usage: PlanUsageDto;
  @ApiProperty({ type: String, nullable: true, description: 'Contato da plataforma para mudar de plano' }) supportEmail: string | null;
  @ApiProperty({ type: SubscriptionBillingDto }) billing: SubscriptionBillingDto;
}

export class PublicPlanFeatureDto {
  @ApiProperty() key: string;
  @ApiProperty() label: string;
}

export class PublicPlanDto {
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: String, example: '149.90' }) price: string;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: ['MONTHLY', 'YEARLY'], enumName: 'BillingInterval' }) interval: 'MONTHLY' | 'YEARLY';
  @ApiProperty({ type: Number, nullable: true, description: 'null = ilimitado' }) maxVehicles: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'null = ilimitado' }) maxUsers: number | null;
  @ApiProperty({ type: [PublicPlanFeatureDto] }) features: PublicPlanFeatureDto[];
}

export class PublicPlanListDto {
  @ApiProperty({ type: [PublicPlanDto] }) items: PublicPlanDto[];
}

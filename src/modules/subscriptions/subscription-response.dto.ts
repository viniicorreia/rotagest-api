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

export class SubscriptionDto {
  @ApiProperty(SubscriptionStatusEnum) status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'SUSPENDED';
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) trialEndsAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) currentPeriodStart: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) currentPeriodEnd: Date | null;
  @ApiProperty({ type: PlanSummaryDto }) plan: PlanSummaryDto;
  @ApiProperty({ type: PlanLimitsDto }) limits: PlanLimitsDto;
  @ApiProperty({ type: PlanUsageDto }) usage: PlanUsageDto;
}

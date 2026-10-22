import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CompanyStatusEnum, SubscriptionStatusEnum } from '../../common/dto/enums';
import { IsDateOnly, IsMoney, MoneyProperty, OptionalMoneyProperty, PageQueryDto, QueryBoolean, trimOrNull, trimOrUndefined } from '../../common/validation';
import { PLAN_FEATURE_KEYS } from '../../domain';

const COMPANY_STATUSES = ['ACTIVE', 'SUSPENDED', 'CANCELED'] as const;
const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'SUSPENDED'] as const;
type CompanyStatus = (typeof COMPANY_STATUSES)[number];
type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
const IntervalEnum = { enum: ['MONTHLY', 'YEARLY'], enumName: 'BillingInterval' } as const;
const PlanStatusEnum = { enum: ['ACTIVE', 'ARCHIVED'], enumName: 'PlanStatus' } as const;

/** Inteiro positivo ou null (= ilimitado / sem exceção). */
const NullableLimit = (description: string) => ApiPropertyOptional({ type: Number, nullable: true, minimum: 1, description });

export class ReasonDto {
  @ApiProperty({ minLength: 10, maxLength: 500, example: 'Pagamento não identificado após três avisos' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

// ---------------------------------------------------------------------------
// Empresas
// ---------------------------------------------------------------------------

export class ListCompaniesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Nome, razão social, documento ou e-mail' })
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional(CompanyStatusEnum)
  @IsOptional()
  @IsIn(COMPANY_STATUSES)
  status?: CompanyStatus;
}

export class SetCompanyStatusDto extends ReasonDto {
  @ApiProperty(CompanyStatusEnum)
  @IsIn(COMPANY_STATUSES)
  status: CompanyStatus;
}

export class PlatformPlanRefDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

export class PlatformSubscriptionSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty(SubscriptionStatusEnum) status: SubscriptionStatus;
  @ApiProperty({ type: PlatformPlanRefDto }) plan: PlatformPlanRefDto;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) trialEndsAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) currentPeriodEnd: Date | null;
}

export class PlatformUsageDto {
  @ApiProperty({ description: 'Membros ativos + convites pendentes' }) users: number;
  @ApiProperty({ description: 'Veículos não arquivados' }) vehicles: number;
  @ApiProperty({ type: Number, nullable: true }) maxUsers: number | null;
  @ApiProperty({ type: Number, nullable: true }) maxVehicles: number | null;
}

export class PlatformCompanyDto {
  @ApiProperty() id: string;
  @ApiProperty() tradeName: string;
  @ApiProperty({ type: String, nullable: true }) legalName: string | null;
  @ApiProperty() document: string;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, nullable: true }) city: string | null;
  @ApiProperty({ type: String, nullable: true }) state: string | null;
  @ApiProperty(CompanyStatusEnum) status: CompanyStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: PlatformSubscriptionSummaryDto, nullable: true }) subscription: PlatformSubscriptionSummaryDto | null;
  @ApiProperty({ type: PlatformUsageDto }) usage: PlatformUsageDto;
}

export class PlatformCompanyListDto {
  @ApiProperty({ type: [PlatformCompanyDto] }) items: PlatformCompanyDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}

export class PlatformPersonDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
}

export class PlatformAuditEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() action: string;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ type: PlatformPersonDto, nullable: true }) actor: PlatformPersonDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) before: unknown;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) after: unknown;
}

export class PlatformSupportAccessDto {
  @ApiProperty({ format: 'date-time' }) expiresAt: Date;
  @ApiProperty() reason: string;
}

export class PlatformCompanyDetailDto extends PlatformCompanyDto {
  @ApiProperty({ type: [PlatformPersonDto], description: 'Proprietários (OWNER) ativos' }) owners: PlatformPersonDto[];
  @ApiProperty({ type: PlatformSupportAccessDto, nullable: true, description: 'Autorização vigente do dono para o suporte ver os dados' })
  supportAccess: PlatformSupportAccessDto | null;
  @ApiProperty({ type: [PlatformAuditEntryDto], description: 'Ações da plataforma e do gateway sobre esta empresa' }) history: PlatformAuditEntryDto[];
}

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

export class PlanFeatureInputDto {
  @ApiProperty({ enum: PLAN_FEATURE_KEYS, enumName: 'PlanFeatureKey' })
  @IsIn(PLAN_FEATURE_KEYS)
  key: string;

  @ApiProperty()
  @IsBoolean()
  enabled: boolean;
}

export class CreatePlanDto {
  @ApiProperty({ example: 'frota-50', description: 'Identificador único (minúsculas, números e hífen)' })
  @Transform(trimOrUndefined)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'Use minúsculas, números e hífen' })
  @MaxLength(40)
  code: string;

  @ApiProperty({ example: 'Frota 50' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @MoneyProperty('Preço por período', '149.90')
  @IsMoney({ allowZero: true })
  price: string;

  @ApiProperty(IntervalEnum)
  @IsIn(['MONTHLY', 'YEARLY'])
  interval: 'MONTHLY' | 'YEARLY';

  @NullableLimit('Limite de veículos ativos; null = ilimitado')
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100000)
  maxVehicles?: number | null;

  @NullableLimit('Limite de usuários (membros + convites); null = ilimitado')
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100000)
  maxUsers?: number | null;

  @ApiPropertyOptional({ default: true, description: 'Aparece na lista de planos para as empresas' })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiPropertyOptional({ type: [PlanFeatureInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PLAN_FEATURE_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => PlanFeatureInputDto)
  features?: PlanFeatureInputDto[];
}

export class UpdatePlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @OptionalMoneyProperty('Preço por período', '149.90')
  @IsOptional()
  @IsMoney({ allowZero: true })
  price?: string;

  @ApiPropertyOptional(IntervalEnum)
  @IsOptional()
  @IsIn(['MONTHLY', 'YEARLY'])
  interval?: 'MONTHLY' | 'YEARLY';

  @NullableLimit('Limite de veículos ativos; null = ilimitado')
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100000)
  maxVehicles?: number | null;

  @NullableLimit('Limite de usuários; null = ilimitado')
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100000)
  maxUsers?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiPropertyOptional(PlanStatusEnum)
  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';

  @ApiPropertyOptional({ type: [PlanFeatureInputDto], description: 'Substitui a lista de recursos' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(PLAN_FEATURE_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => PlanFeatureInputDto)
  features?: PlanFeatureInputDto[];
}

export class PlatformPlanFeatureDto {
  @ApiProperty() key: string;
  @ApiProperty() label: string;
  @ApiProperty() enabled: boolean;
}

export class PlatformPlanDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @MoneyProperty() price: string;
  @ApiProperty() currency: string;
  @ApiProperty(IntervalEnum) interval: 'MONTHLY' | 'YEARLY';
  @ApiProperty({ type: Number, nullable: true }) maxVehicles: number | null;
  @ApiProperty({ type: Number, nullable: true }) maxUsers: number | null;
  @ApiProperty(PlanStatusEnum) status: 'ACTIVE' | 'ARCHIVED';
  @ApiProperty() isPublic: boolean;
  @ApiProperty() sortOrder: number;
  @ApiProperty({ type: [PlatformPlanFeatureDto] }) features: PlatformPlanFeatureDto[];
  @ApiProperty({ description: 'Assinaturas que usam o plano (exceto canceladas)' }) subscriptions: number;
  @ApiProperty({ description: 'Plano padrão para novas empresas' }) isDefault: boolean;
}

export class PlatformPlanListDto {
  @ApiProperty({ type: [PlatformPlanDto] }) items: PlatformPlanDto[];
  @ApiProperty({ type: [PlatformPlanFeatureDto], description: 'Catálogo de recursos disponíveis' }) catalog: PlatformPlanFeatureDto[];
}

// ---------------------------------------------------------------------------
// Assinaturas
// ---------------------------------------------------------------------------

export class ListSubscriptionsQueryDto extends PageQueryDto {
  @ApiPropertyOptional(SubscriptionStatusEnum)
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  status?: SubscriptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ description: 'Só testes que terminam nos próximos 7 dias ou já terminaram' })
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  trialEnding?: boolean;
}

export class UpdateSubscriptionDto extends ReasonDto {
  @ApiPropertyOptional({ description: 'Troca de plano (só planos ativos)' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional(SubscriptionStatusEnum)
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES)
  status?: SubscriptionStatus;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: '2026-11-15', description: 'Fim do período de teste; null limpa' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateOnly()
  trialEndsAt?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: '2026-11-15', description: 'Fim do período pago atual; null limpa' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateOnly()
  currentPeriodEnd?: string | null;

  @NullableLimit('Exceção negociada de veículos; null = vale o do plano')
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100000)
  overrideMaxVehicles?: number | null;

  @NullableLimit('Exceção negociada de usuários; null = vale o do plano')
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  @Max(100000)
  overrideMaxUsers?: number | null;
}

export class PlatformCompanyRefDto {
  @ApiProperty() id: string;
  @ApiProperty() tradeName: string;
  @ApiProperty(CompanyStatusEnum) status: CompanyStatus;
}

export class PlatformSubscriptionDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: PlatformCompanyRefDto }) company: PlatformCompanyRefDto;
  @ApiProperty({ type: PlatformPlanRefDto }) plan: PlatformPlanRefDto;
  @ApiProperty(SubscriptionStatusEnum) status: SubscriptionStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) trialEndsAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) currentPeriodStart: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) currentPeriodEnd: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) canceledAt: Date | null;
  @ApiProperty({ type: Number, nullable: true }) overrideMaxVehicles: number | null;
  @ApiProperty({ type: Number, nullable: true }) overrideMaxUsers: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'Gateway que cobra esta assinatura, quando integrado' }) externalProvider: string | null;
  @ApiProperty({ type: PlatformUsageDto }) usage: PlatformUsageDto;
  @ApiProperty({ type: [String], description: 'Avisos, como uso acima dos limites após troca de plano' }) warnings: string[];
}

export class PlatformSubscriptionListDto {
  @ApiProperty({ type: [PlatformSubscriptionDto] }) items: PlatformSubscriptionDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}

// ---------------------------------------------------------------------------
// Configurações e indicadores
// ---------------------------------------------------------------------------

export class UpdatePlatformSettingsDto {
  @ApiPropertyOptional({ description: 'Permite que novos usuários criem empresas (onboarding)' })
  @IsOptional()
  @IsBoolean()
  allowNewCompanies?: boolean;

  @ApiPropertyOptional({ description: 'Plano das novas empresas (precisa estar ativo)' })
  @IsOptional()
  @IsUUID()
  defaultPlanId?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 90, description: 'Dias de teste; 0 = começa ativa' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  trialDays?: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Contato mostrado às empresas para mudar de plano' })
  @IsOptional()
  @Transform(trimOrNull)
  @ValidateIf((_, v) => v !== null)
  @IsEmail()
  @MaxLength(160)
  supportEmail?: string | null;
}

export class BillingStatusDto {
  @ApiProperty({ description: 'Há gateway de pagamento integrado e ativo' }) configured: boolean;
  @ApiProperty({ type: String, nullable: true }) provider: string | null;
}

export class PlatformSettingsDto {
  @ApiProperty() allowNewCompanies: boolean;
  @ApiProperty({ type: PlatformPlanRefDto, nullable: true }) defaultPlan: PlatformPlanRefDto | null;
  @ApiProperty() trialDays: number;
  @ApiProperty({ type: String, nullable: true }) supportEmail: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: Date | null;
  @ApiProperty({ type: BillingStatusDto }) billing: BillingStatusDto;
}

export class StatusCountDto {
  @ApiProperty() status: string;
  @ApiProperty() count: number;
}

export class PlanCountDto {
  @ApiProperty() planId: string;
  @ApiProperty() name: string;
  @ApiProperty() count: number;
}

export class PlatformOverviewDto {
  @ApiProperty() companies: number;
  @ApiProperty({ type: [StatusCountDto] }) companiesByStatus: StatusCountDto[];
  @ApiProperty({ type: [StatusCountDto] }) subscriptionsByStatus: StatusCountDto[];
  @ApiProperty({ type: [PlanCountDto], description: 'Assinaturas não canceladas por plano' }) subscriptionsByPlan: PlanCountDto[];
  @MoneyProperty('Receita recorrente mensal contratada (assinaturas ativas; anuais divididas por 12)') mrr: string;
  @ApiProperty({ description: 'Empresas criadas nos últimos 30 dias' }) newCompanies30d: number;
  @ApiProperty({ description: 'Testes que terminam nos próximos 7 dias' }) trialsEnding7d: number;
  @ApiProperty({ description: 'Assinaturas com pagamento em atraso' }) pastDue: number;
  @ApiProperty({ description: 'Veículos ativos em todas as empresas' }) vehicles: number;
  @ApiProperty({ description: 'Membros ativos em todas as empresas' }) members: number;
  @ApiProperty({ type: BillingStatusDto }) billing: BillingStatusDto;
}

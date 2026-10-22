import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { trimOrUndefined } from '../../common/validation';

export const SUPPORT_MAX_HOURS = 72;

export class CreateSupportGrantDto {
  @ApiProperty({ minimum: 1, maximum: SUPPORT_MAX_HOURS, description: 'Por quantas horas o suporte pode ver os dados', example: 24 })
  @IsInt()
  @Min(1)
  @Max(SUPPORT_MAX_HOURS)
  hours: number;

  @ApiProperty({ minLength: 10, maxLength: 500, example: 'Conferir o relatório de setembro que não fecha' })
  @Transform(trimOrUndefined)
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}

const SupportGrantStatusEnum = { enum: ['ACTIVE', 'EXPIRED', 'REVOKED'], enumName: 'SupportGrantStatus' } as const;

export class SupportPersonDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
}

export class SupportGrantDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty(SupportGrantStatusEnum) status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  @ApiProperty() reason: string;
  @ApiProperty({ format: 'date-time' }) createdAt: Date;
  @ApiProperty({ format: 'date-time' }) expiresAt: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revokedAt: Date | null;
  @ApiProperty({ type: SupportPersonDto }) grantedBy: SupportPersonDto;
  @ApiProperty({ type: SupportPersonDto, nullable: true }) revokedBy: SupportPersonDto | null;
  @ApiProperty({ description: 'Quantas leituras o suporte fez com esta autorização' }) accessCount: number;
}

export class SupportAccessOverviewDto {
  @ApiProperty({ type: SupportGrantDto, nullable: true }) active: SupportGrantDto | null;
  @ApiProperty({ type: [SupportGrantDto], description: 'Últimas 20 autorizações' }) grants: SupportGrantDto[];
  @ApiProperty({ type: String, nullable: true, description: 'E-mail de suporte da plataforma' }) supportEmail: string | null;
}

export class SupportAccessLogEntryDto {
  @ApiProperty({ format: 'date-time' }) at: Date;
  @ApiProperty({ type: String, nullable: true }) actorName: string | null;
  @ApiProperty({ example: 'GET' }) method: string;
  @ApiProperty({ example: '/api/v1/reports/vehicle-result' }) path: string;
}

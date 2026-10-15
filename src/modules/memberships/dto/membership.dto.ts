import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsEmail, IsEnum, IsIn, IsOptional, MaxLength } from 'class-validator';
import { GRANTABLE_PERMISSIONS, MEMBER_ROLES, type MemberRole } from '../../../domain';

export class InviteMemberDto {
  @ApiProperty({ example: 'motorista@exemplo.com' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'E-mail inválido' })
  @MaxLength(254)
  email: string;

  @ApiProperty({ enum: MEMBER_ROLES })
  @IsEnum(MEMBER_ROLES, { message: 'Papel inválido' })
  role: MemberRole;

  @ApiPropertyOptional({ enum: GRANTABLE_PERMISSIONS, isArray: true, description: 'Permissões extras (ex.: gestor configurável)' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(GRANTABLE_PERMISSIONS.length)
  @IsIn(GRANTABLE_PERMISSIONS as unknown as string[], { each: true, message: 'Permissão inválida' })
  permissions?: string[];
}

export class UpdateMemberDto {
  @ApiPropertyOptional({ enum: MEMBER_ROLES })
  @IsOptional()
  @IsEnum(MEMBER_ROLES, { message: 'Papel inválido' })
  role?: MemberRole;

  @ApiPropertyOptional({ enum: GRANTABLE_PERMISSIONS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(GRANTABLE_PERMISSIONS.length)
  @IsIn(GRANTABLE_PERMISSIONS as unknown as string[], { each: true, message: 'Permissão inválida' })
  permissions?: string[];
}

import { ApiProperty } from '@nestjs/swagger';
import type { MemberRole, Permission } from '../../../domain';
import { CompanyStatusEnum, MemberRoleEnum, PermissionEnum } from '../../../common/dto/enums';

export class MeUserDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: ['USER', 'SUPER_ADMIN'], enumName: 'PlatformRole' }) platformRole: 'USER' | 'SUPER_ADMIN';
}

export class MeCompanyDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() tradeName: string;
  @ApiProperty(CompanyStatusEnum) status: 'ACTIVE' | 'SUSPENDED' | 'CANCELED';
  @ApiProperty(MemberRoleEnum) role: MemberRole;
  @ApiProperty() roleLabel: string;
}

export class ActiveCompanyDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() tradeName: string;
  @ApiProperty(MemberRoleEnum) role: MemberRole;
  @ApiProperty({ ...PermissionEnum, isArray: true }) permissions: Permission[];
}

export class MeResponseDto {
  @ApiProperty({ type: MeUserDto }) user: MeUserDto;
  @ApiProperty({ type: [MeCompanyDto] }) companies: MeCompanyDto[];
  @ApiProperty({ type: ActiveCompanyDto, nullable: true }) activeCompany: ActiveCompanyDto | null;
}

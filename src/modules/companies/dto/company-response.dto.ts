import { ApiProperty } from '@nestjs/swagger';
import type { MemberRole, Permission } from '../../../domain';
import { CompanyStatusEnum, MemberRoleEnum, PermissionEnum, PersonTypeEnum } from '../../../common/dto/enums';
import { TokenResponseDto } from '../../auth/dto/auth.dto';

export class CompanyDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() tradeName: string;
  @ApiProperty({ type: String, nullable: true }) legalName: string | null;
  @ApiProperty(PersonTypeEnum) personType: 'INDIVIDUAL' | 'COMPANY';
  @ApiProperty({ description: 'Somente dígitos' }) document: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: String, nullable: true }) email: string | null;
  @ApiProperty({ type: String, nullable: true }) address: string | null;
  @ApiProperty({ type: String, nullable: true }) city: string | null;
  @ApiProperty({ type: String, nullable: true }) state: string | null;
  @ApiProperty({ type: String, nullable: true }) postalCode: string | null;
  @ApiProperty(CompanyStatusEnum) status: 'ACTIVE' | 'SUSPENDED' | 'CANCELED';
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class CurrentCompanyDto extends CompanyDto {
  @ApiProperty(MemberRoleEnum) myRole: MemberRole;
  @ApiProperty() myRoleLabel: string;
  @ApiProperty({ ...PermissionEnum, isArray: true }) myPermissions: readonly Permission[];
}

export class CreateCompanyResponseDto extends TokenResponseDto {
  @ApiProperty({ type: CompanyDto }) company: CompanyDto;
}

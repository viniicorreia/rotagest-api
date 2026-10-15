import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { MemberRole, Permission } from '../../../domain';
import { InvitationStatusEnum, MemberRoleEnum, MemberStatusEnum, PermissionEnum } from '../../../common/dto/enums';

export class MemberUserDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
}

export class MemberDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty(MemberRoleEnum) role: MemberRole;
  @ApiProperty() roleLabel: string;
  @ApiProperty({ type: [String] }) extraPermissions: string[];
  @ApiProperty({ ...PermissionEnum, isArray: true }) effectivePermissions: Permission[];
  @ApiProperty(MemberStatusEnum) status: 'ACTIVE' | 'INACTIVE';
  @ApiProperty({ type: String, format: 'date-time' }) joinedAt: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) deactivatedAt: Date | null;
  @ApiProperty({ type: MemberUserDto }) user: MemberUserDto;
  @ApiProperty() isMe: boolean;
}

export class InvitationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() email: string;
  @ApiProperty(MemberRoleEnum) role: MemberRole;
  @ApiProperty() roleLabel: string;
  @ApiProperty({ type: [String] }) permissions: string[];
  @ApiProperty(InvitationStatusEnum) status: 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED';
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiPropertyOptional() invitedBy?: string;
}

export class InviteResultDto {
  @ApiProperty({ type: InvitationDto }) invitation: InvitationDto;
  @ApiProperty({ description: 'Link de aceite, para compartilhar também por outros canais' }) inviteUrl: string;
}

export class InvitationPreviewDto {
  @ApiProperty() companyName: string;
  @ApiProperty() email: string;
  @ApiProperty(MemberRoleEnum) role: MemberRole;
  @ApiProperty() roleLabel: string;
  @ApiProperty() invitedBy: string;
  @ApiProperty(InvitationStatusEnum) status: 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED';
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt: Date;
}

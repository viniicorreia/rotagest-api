import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { MemberRoleEnum, PermissionEnum } from '../../common/dto/enums';
import {
  GRANTABLE_PERMISSIONS,
  MEMBER_ROLE_DESCRIPTIONS,
  MEMBER_ROLE_LABELS,
  MEMBER_ROLES,
  PERMISSION_LABELS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type MemberRole,
  type Permission,
} from '../../domain';

class RoleInfoDto {
  @ApiProperty(MemberRoleEnum) key: MemberRole;
  @ApiProperty() label: string;
  @ApiProperty() description: string;
  @ApiProperty({ ...PermissionEnum, isArray: true }) permissions: readonly Permission[];
}

class PermissionInfoDto {
  @ApiProperty(PermissionEnum) key: Permission;
  @ApiProperty() label: string;
  @ApiProperty({ description: 'Pode ser concedida como permissão extra a um membro' }) grantable: boolean;
}

export class AccessControlDto {
  @ApiProperty({ type: [RoleInfoDto] }) roles: RoleInfoDto[];
  @ApiProperty({ type: [PermissionInfoDto] }) permissions: PermissionInfoDto[];
}

/**
 * Catálogo de papéis e permissões. É a fonte para o frontend montar telas de
 * acesso sem duplicar regras; a autorização continua sendo feita só aqui na API.
 */
@ApiTags('meta')
@Controller('meta')
export class MetaController {
  @Public()
  @Get('access-control')
  @ApiOperation({ summary: 'Papéis, rótulos e permissões disponíveis' })
  @ApiOkResponse({ type: AccessControlDto })
  accessControl(): AccessControlDto {
    return {
      roles: MEMBER_ROLES.map((key) => ({
        key,
        label: MEMBER_ROLE_LABELS[key],
        description: MEMBER_ROLE_DESCRIPTIONS[key],
        permissions: ROLE_PERMISSIONS[key],
      })),
      permissions: PERMISSIONS.map((key) => ({ key, label: PERMISSION_LABELS[key], grantable: GRANTABLE_PERMISSIONS.includes(key) })),
    };
  }
}

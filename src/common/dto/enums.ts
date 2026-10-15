import { MEMBER_ROLES, PERMISSIONS } from '../../domain';

/** Enums nomeados no OpenAPI, para que o frontend gere tipos reutilizáveis. */
export const MemberRoleEnum = { enum: MEMBER_ROLES, enumName: 'MemberRole' } as const;
export const PermissionEnum = { enum: PERMISSIONS, enumName: 'Permission' } as const;
export const PersonTypeEnum = { enum: ['INDIVIDUAL', 'COMPANY'], enumName: 'PersonType' } as const;
export const CompanyStatusEnum = { enum: ['ACTIVE', 'SUSPENDED', 'CANCELED'], enumName: 'CompanyStatus' } as const;
export const MemberStatusEnum = { enum: ['ACTIVE', 'INACTIVE'], enumName: 'MemberStatus' } as const;
export const InvitationStatusEnum = { enum: ['PENDING', 'EXPIRED', 'ACCEPTED', 'REVOKED'], enumName: 'InvitationStatus' } as const;
export const SubscriptionStatusEnum = {
  enum: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'SUSPENDED'],
  enumName: 'SubscriptionStatus',
} as const;

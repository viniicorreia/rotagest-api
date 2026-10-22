import type { MemberRole } from './roles';

/**
 * Catálogo de permissões (recurso:ação). Fonte única para API e frontend.
 * Ver docs/ARCHITECTURE.md §7.4.
 */
export const PERMISSIONS = [
  'company:read',
  'company:update',
  'members:read',
  'members:manage',
  'subscription:read',
  'fleet:read',
  'fleet:manage',
  'contracts:read',
  'contracts:manage',
  'finance:read',
  'finance:manage',
  'accounts:manage',
  'accounts:adjust',
  'expenses:approve',
  'expenses:own',
  'assignments:own',
  'maintenance:manage',
  'reports:read',
  'closing:manage',
  'closing:reopen',
  'settings:manage',
  'support:grant',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const OWNER: readonly Permission[] = PERMISSIONS;

const MANAGER: readonly Permission[] = [
  'company:read',
  'members:read',
  'fleet:read',
  'fleet:manage',
  'contracts:read',
  'contracts:manage',
  'expenses:approve',
  'expenses:own',
  'assignments:own',
  'maintenance:manage',
];

const FINANCIAL: readonly Permission[] = [
  'company:read',
  'fleet:read',
  'contracts:read',
  'finance:read',
  'finance:manage',
  'accounts:manage',
  'expenses:approve',
  'expenses:own',
  'assignments:own',
  'reports:read',
  'closing:manage',
];

const DRIVER: readonly Permission[] = ['company:read', 'expenses:own', 'assignments:own'];

export const ROLE_PERMISSIONS: Readonly<Record<MemberRole, readonly Permission[]>> = {
  OWNER,
  MANAGER,
  FINANCIAL,
  DRIVER,
};

/**
 * Permissões que podem ser concedidas como extras a um membro (ex.: MANAGER
 * configurável). Permissões estruturais do proprietário ficam de fora: gestão
 * de membros, configurações, reabertura de fechamento e ajustes de saldo.
 */
export const GRANTABLE_PERMISSIONS: readonly Permission[] = [
  'members:read',
  'fleet:read',
  'fleet:manage',
  'contracts:read',
  'contracts:manage',
  'finance:read',
  'finance:manage',
  'accounts:manage',
  'expenses:approve',
  'maintenance:manage',
  'reports:read',
  'closing:manage',
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'company:read': 'Ver dados da empresa',
  'company:update': 'Editar dados da empresa',
  'members:read': 'Ver membros',
  'members:manage': 'Gerenciar membros e convites',
  'subscription:read': 'Ver assinatura',
  'fleet:read': 'Ver veículos, motoristas e rotas',
  'fleet:manage': 'Gerenciar veículos, motoristas e rotas',
  'contracts:read': 'Ver contratos',
  'contracts:manage': 'Gerenciar contratos',
  'finance:read': 'Ver receitas e despesas',
  'finance:manage': 'Lançar receitas, despesas, pagamentos e recebimentos',
  'accounts:manage': 'Gerenciar contas financeiras e transferências',
  'accounts:adjust': 'Ajustar saldos',
  'expenses:approve': 'Aprovar gastos de motoristas',
  'expenses:own': 'Registrar os próprios gastos',
  'assignments:own': 'Ver as próprias atribuições',
  'maintenance:manage': 'Gerenciar manutenções',
  'reports:read': 'Ver relatórios',
  'closing:manage': 'Realizar fechamento mensal',
  'closing:reopen': 'Reabrir fechamento mensal',
  'settings:manage': 'Gerenciar configurações',
  'support:grant': 'Autorizar o acesso do suporte',
};

/**
 * Permissões do suporte da plataforma dentro de uma empresa que autorizou o
 * acesso: só leitura (o TenantGuard também recusa qualquer método de escrita).
 */
export const SUPPORT_PERMISSIONS: readonly Permission[] = [
  'company:read',
  'members:read',
  'subscription:read',
  'fleet:read',
  'contracts:read',
  'finance:read',
  'reports:read',
];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Permissões efetivas = papel ∪ extras concedíveis (extras inválidos são ignorados). */
export function resolvePermissions(role: MemberRole, extras: readonly string[] = []): Permission[] {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role]);
  for (const extra of extras) {
    if (isPermission(extra) && GRANTABLE_PERMISSIONS.includes(extra)) set.add(extra);
  }
  return PERMISSIONS.filter((p) => set.has(p));
}

export function hasPermissions(granted: readonly string[], required: readonly Permission[]): boolean {
  return required.every((p) => granted.includes(p));
}

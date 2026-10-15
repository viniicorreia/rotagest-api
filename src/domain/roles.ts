export const MEMBER_ROLES = ['OWNER', 'MANAGER', 'FINANCIAL', 'DRIVER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const PLATFORM_ROLES = ['USER', 'SUPER_ADMIN'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  OWNER: 'Proprietário',
  MANAGER: 'Gestor',
  FINANCIAL: 'Financeiro',
  DRIVER: 'Motorista',
};

export const MEMBER_ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  OWNER: 'Acesso total à empresa, inclusive membros, fechamentos e configurações.',
  MANAGER: 'Gestão operacional da frota, rotas e contratos. Permissões extras configuráveis.',
  FINANCIAL: 'Receitas, despesas, contas financeiras e relatórios.',
  DRIVER: 'Consulta suas atribuições e registra os próprios gastos com comprovante.',
};

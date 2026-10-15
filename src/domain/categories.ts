/**
 * Categorias padrão criadas para toda empresa (systemKey estável). Elas não
 * podem ser renomeadas, só desativadas; a empresa cria as próprias à vontade.
 */
export interface DefaultCategory {
  systemKey: string;
  name: string;
  type: 'INCOME' | 'EXPENSE';
}

export const DEFAULT_EXPENSE_CATEGORIES: readonly DefaultCategory[] = [
  { systemKey: 'FUEL', name: 'Combustível', type: 'EXPENSE' },
  { systemKey: 'MAINTENANCE', name: 'Manutenção', type: 'EXPENSE' },
  { systemKey: 'PARTS', name: 'Peças', type: 'EXPENSE' },
  { systemKey: 'TIRES', name: 'Pneus', type: 'EXPENSE' },
  { systemKey: 'TIRE_REPAIR', name: 'Borracharia', type: 'EXPENSE' },
  { systemKey: 'SALARY', name: 'Salário', type: 'EXPENSE' },
  { systemKey: 'TRACKER', name: 'Rastreador', type: 'EXPENSE' },
  { systemKey: 'ACCOUNTING', name: 'Contabilidade', type: 'EXPENSE' },
  { systemKey: 'BANK_FEES', name: 'Tarifas bancárias', type: 'EXPENSE' },
  { systemKey: 'INSURANCE', name: 'Seguro', type: 'EXPENSE' },
  { systemKey: 'TAXES', name: 'Impostos', type: 'EXPENSE' },
  { systemKey: 'LICENSING', name: 'Licenciamento', type: 'EXPENSE' },
  { systemKey: 'WASHING', name: 'Lavagem', type: 'EXPENSE' },
  { systemKey: 'TOLL', name: 'Pedágio', type: 'EXPENSE' },
  { systemKey: 'OTHER_EXPENSE', name: 'Outras', type: 'EXPENSE' },
];

export const DEFAULT_INCOME_CATEGORIES: readonly DefaultCategory[] = [
  { systemKey: 'CONTRACT', name: 'Contratos', type: 'INCOME' },
  { systemKey: 'CHARTER', name: 'Fretamentos e serviços avulsos', type: 'INCOME' },
  { systemKey: 'OTHER_INCOME', name: 'Outras receitas', type: 'INCOME' },
];

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [...DEFAULT_EXPENSE_CATEGORIES, ...DEFAULT_INCOME_CATEGORIES];

/** Categorias somadas como "custos de manutenção" no dashboard. */
export const MAINTENANCE_CATEGORY_KEYS = ['MAINTENANCE', 'PARTS', 'TIRES', 'TIRE_REPAIR'] as const;
export const FUEL_CATEGORY_KEYS = ['FUEL'] as const;

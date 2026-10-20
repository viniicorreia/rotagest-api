/**
 * Recursos que um plano pode habilitar. A lista vive no código porque cada
 * chave precisa de suporte na aplicação; quais planos têm cada recurso fica no
 * banco (PlanFeature) e é editado no painel da plataforma.
 */
export const PLAN_FEATURES = [
  { key: 'reports.basic', label: 'Relatórios na tela' },
  { key: 'reports.export', label: 'Exportação de relatórios em PDF e Excel' },
  { key: 'allocations', label: 'Rateio de despesas entre veículos' },
  { key: 'support.priority', label: 'Suporte prioritário' },
] as const;

export type PlanFeatureKey = (typeof PLAN_FEATURES)[number]['key'];
export const PLAN_FEATURE_KEYS = PLAN_FEATURES.map((f) => f.key) as PlanFeatureKey[];

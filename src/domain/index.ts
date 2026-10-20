/**
 * Regras de domínio puras (sem I/O): papéis, permissões e documentos.
 * O frontend obtém o catálogo de papéis/permissões pela rota GET /api/v1/meta/access-control.
 */
export * from './roles';
export * from './permissions';
export * from './documents';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export * from './money';
export * from './calendar';
export * from './plates';
export * from './categories';
export * from './mileage';

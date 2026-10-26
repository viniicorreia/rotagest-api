import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Contexto que o PrismaService repassa ao PostgreSQL em cada transação
 * (`app.company_id` e `app.bypass`), usado pelas políticas de RLS
 * (docs/ARCHITECTURE.md §5.7).
 *
 * - Toda requisição HTTP começa com `{ companyId: null, bypass: false }`:
 *   sem empresa, as tabelas com `companyId` não devolvem nem aceitam linhas.
 * - O TenantGuard preenche `companyId` com a empresa ativa do token antes de
 *   validar o vínculo (o próprio vínculo é lido sob RLS).
 * - Rotas `@Public()`/`@NoTenant()` (login, onboarding, painel da plataforma,
 *   webhooks) ligam `bypass`: elas não operam dentro de uma empresa e cada
 *   serviço filtra explicitamente.
 * - Fora de uma requisição (seed, scripts, testes) não há contexto e o acesso
 *   é irrestrito, como o do dono do banco.
 */
export interface DbContext {
  companyId: string | null;
  bypass: boolean;
}

const storage = new AsyncLocalStorage<DbContext>();

export function currentDbContext(): DbContext {
  return storage.getStore() ?? { companyId: null, bypass: true };
}

/** Middleware global: abre o contexto da requisição. */
export function dbContextMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  storage.run({ companyId: null, bypass: false }, () => next());
}

/** Executa `fn` com um contexto próprio (jobs e testes). */
export function runWithDbContext<T>(ctx: DbContext, fn: () => T): T {
  return storage.run({ ...ctx }, fn);
}

/** Altera o contexto da requisição corrente; sem contexto não faz nada. */
export function setDbContext(patch: Partial<DbContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

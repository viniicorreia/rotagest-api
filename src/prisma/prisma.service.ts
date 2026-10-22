import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { currentDbContext } from '../common/tenant/db-context';

export type Tx = Prisma.TransactionClient;

const MODEL_DELEGATES = new Set<string | symbol>(
  Object.values(Prisma.ModelName).map((name) => name.charAt(0).toLowerCase() + name.slice(1)),
);
const RAW_METHODS = new Set<string | symbol>(['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe']);

/** Repassa o contexto da requisição ao PostgreSQL, válido só até o fim da transação. */
function setContextSql(client: PrismaClient | Tx) {
  const { companyId, bypass } = currentDbContext();
  return client.$executeRaw`SELECT set_config('app.company_id', ${companyId ?? ''}, true), set_config('app.bypass', ${bypass ? 'on' : 'off'}, true)`;
}

/**
 * Cliente Prisma com Row-Level Security (docs/ARCHITECTURE.md §5.7).
 *
 * Toda operação roda numa transação que começa com `set_config(..., true)`:
 * - operações de modelo e SQL avulso: cada uma em sua própria transação curta;
 * - `$transaction(fn)`: o contexto é gravado uma vez, no início, e `fn` recebe
 *   o cliente da transação sem embrulho extra.
 * A forma em lista de `$transaction([...])` não é suportada (não é usada).
 *
 * O filtro por `companyId` nos serviços continua obrigatório; o RLS é a segunda
 * barreira, para que um filtro esquecido nunca exponha dados de outra empresa.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    const base: PrismaClient = this;
    const scoped = base.$extends({
      query: {
        $allModels: {
          async $allOperations({ args, query }) {
            const [, result] = await base.$transaction([setContextSql(base), query(args)]);
            return result;
          },
        },
      },
    });

    const transaction = (arg: unknown, options?: Parameters<PrismaClient['$transaction']>[1]) => {
      if (typeof arg !== 'function') throw new Error('Use $transaction(async (tx) => ...): a forma em lista não grava o contexto de RLS.');
      return base.$transaction(async (tx) => {
        await setContextSql(tx);
        return (arg as (tx: Tx) => unknown)(tx);
      }, options);
    };

    return new Proxy(this, {
      get(target, prop) {
        if (prop === '$transaction') return transaction;
        if (MODEL_DELEGATES.has(prop)) return (scoped as unknown as Record<string | symbol, unknown>)[prop];
        if (RAW_METHODS.has(prop)) {
          return (...args: unknown[]) =>
            base.$transaction(async (tx) => {
              await setContextSql(tx);
              return (tx as unknown as Record<string, (...a: unknown[]) => unknown>)[prop as string](...args);
            });
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  async onModuleInit(): Promise<void> {
    const maxAttempts = 5;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.$connect();
        return;
      } catch (err) {
        if (attempt >= maxAttempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

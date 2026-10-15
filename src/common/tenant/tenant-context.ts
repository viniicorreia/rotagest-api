import type { MemberRole, Permission } from '../../domain';

/** Usuário autenticado, resolvido pelo JwtAuthGuard. */
export interface AuthUser {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  platformRole: 'USER' | 'SUPER_ADMIN';
  /** Empresa ativa declarada no token; só é confiável depois do TenantGuard. */
  claimedCompanyId: string | null;
}

/**
 * Contexto do tenant, resolvido EXCLUSIVAMENTE no backend pelo TenantGuard a
 * partir do token + vínculo ativo no banco. Serviços de negócio recebem este
 * objeto e o usam como única origem de companyId.
 */
export interface TenantContext {
  readonly companyId: string;
  readonly userId: string;
  readonly memberId: string;
  readonly role: MemberRole;
  readonly permissions: readonly Permission[];
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      tenant?: TenantContext;
    }
  }
}

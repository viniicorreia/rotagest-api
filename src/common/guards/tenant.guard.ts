import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuditService } from '../../modules/audit/audit.service';
import { IS_PUBLIC, NO_TENANT } from '../decorators';
import { ErrorCode, forbidden, unauthorized } from '../errors';
import { setDbContext } from '../tenant/db-context';
import { isUuid, TenantResolver } from '../tenant/tenant-resolver.service';

/**
 * Global: resolve o TenantContext a partir da empresa ativa do token,
 * revalidando o vínculo no banco a cada requisição. Nunca usa companyId vindo
 * de body, query ou params.
 *
 * Também define o contexto do RLS: rotas sem empresa ignoram as políticas
 * (cada serviço filtra explicitamente); as demais só enxergam a empresa ativa.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: TenantResolver,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) ||
      this.reflector.getAllAndOverride<boolean>(NO_TENANT, targets)
    ) {
      setDbContext({ bypass: true });
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.authUser;
    if (!user) throw unauthorized();
    if (!user.claimedCompanyId) throw forbidden('Selecione uma empresa', ErrorCode.NO_ACTIVE_COMPANY);

    // O vínculo é lido já sob RLS, restrito à empresa reivindicada pelo token.
    if (isUuid(user.claimedCompanyId)) setDbContext({ companyId: user.claimedCompanyId });
    const tenant = await this.resolver.resolve(user.userId, user.claimedCompanyId, { allowSupport: true });
    if (tenant.support) {
      if (!['GET', 'HEAD'].includes(req.method)) throw forbidden('O acesso de suporte é somente leitura.', ErrorCode.SUPPORT_READ_ONLY);
      // Cada leitura do suporte fica registrada e aparece para o dono.
      await this.audit.log({
        companyId: tenant.companyId,
        actorUserId: user.userId,
        action: 'support.request',
        entityType: 'SupportGrant',
        entityId: tenant.support.grantId,
        after: { method: req.method, path: req.originalUrl.split('?')[0] },
        meta: { ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) },
      });
    }
    req.tenant = tenant;
    return true;
  }
}

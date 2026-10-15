import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC, NO_TENANT } from '../decorators';
import { ErrorCode, forbidden, unauthorized } from '../errors';
import { TenantResolver } from '../tenant/tenant-resolver.service';

/**
 * Global: resolve o TenantContext a partir da empresa ativa do token,
 * revalidando o vínculo no banco a cada requisição. Nunca usa companyId vindo
 * de body, query ou params.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: TenantResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(NO_TENANT, targets)) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.authUser;
    if (!user) throw unauthorized();
    if (!user.claimedCompanyId) throw forbidden('Selecione uma empresa', ErrorCode.NO_ACTIVE_COMPANY);

    req.tenant = await this.resolver.resolve(user.userId, user.claimedCompanyId);
    return true;
  }
}

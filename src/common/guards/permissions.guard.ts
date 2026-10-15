import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { hasPermissions, type Permission } from '../../domain';
import { PERMISSIONS_KEY } from '../decorators';
import { forbidden } from '../errors';

/** Global: aplica @RequirePermissions(...) sobre o TenantContext já resolvido. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.tenant || !hasPermissions(req.tenant.permissions, required)) throw forbidden();
    return true;
  }
}

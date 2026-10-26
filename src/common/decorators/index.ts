import { createParamDecorator, ExecutionContext, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission } from '../../domain';
import type { AuthUser, RequestMeta, TenantContext } from '../tenant/tenant-context';

export const IS_PUBLIC = 'rg:isPublic';
export const NO_TENANT = 'rg:noTenant';
export const PERMISSIONS_KEY = 'rg:permissions';
export const ANY_PERMISSIONS_KEY = 'rg:anyPermissions';

/** Rota acessível sem autenticação. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Rota autenticada que não exige empresa ativa (ex.: criar empresa, /auth/me). */
export const NoTenant = () => SetMetadata(NO_TENANT, true);

/** Exige todas as permissões listadas na empresa ativa. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Exige pelo menos uma das permissões (ex.: gestor OU o próprio motorista); o serviço restringe o escopo. */
export const RequireAnyPermission = (...permissions: Permission[]) => SetMetadata(ANY_PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.authUser) throw new UnauthorizedException();
  return req.authUser;
});

export const Tenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantContext => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.tenant) throw new ForbiddenException('Selecione uma empresa');
  return req.tenant;
});

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 300) };
});

export const AUTH_THROTTLE = 'rg:authThrottle';

/** Aplica o limite estrito de autenticação (RATE_LIMIT_AUTH por minuto, por IP). */
export const AuthRateLimit = () => SetMetadata(AUTH_THROTTLE, true);

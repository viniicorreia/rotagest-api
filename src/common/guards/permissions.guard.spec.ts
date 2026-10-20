import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { resolvePermissions } from '../../domain';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators';
import { PermissionsGuard } from './permissions.guard';

const ctxWith = (permissions: string[] | undefined) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ tenant: permissions ? { permissions } : undefined }) }),
  }) as unknown as ExecutionContext;

describe('PermissionsGuard', () => {
  const reflector = new Reflector();
  const guard = new PermissionsGuard(reflector);

  it('libera quando a rota não exige permissão', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(ctxWith(undefined))).toBe(true);
  });

  it('com @RequireAnyPermission basta uma das permissões', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => (key === ANY_PERMISSIONS_KEY ? ['finance:read', 'expenses:own'] : undefined));
    expect(guard.canActivate(ctxWith(resolvePermissions('DRIVER')))).toBe(true);
    expect(guard.canActivate(ctxWith(resolvePermissions('FINANCIAL')))).toBe(true);
    expect(() => guard.canActivate(ctxWith(['company:read']))).toThrow();
  });

  it('exige todas as permissões da rota', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => (key === PERMISSIONS_KEY ? ['members:manage'] : undefined));
    expect(guard.canActivate(ctxWith(resolvePermissions('OWNER')))).toBe(true);
    expect(() => guard.canActivate(ctxWith(resolvePermissions('MANAGER')))).toThrow();
    expect(() => guard.canActivate(ctxWith(undefined))).toThrow();
  });
});

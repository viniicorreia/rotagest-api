import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { resolvePermissions } from '../../domain';
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
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(undefined);
    expect(guard.canActivate(ctxWith(undefined))).toBe(true);
  });

  it('exige todas as permissões da rota', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['members:manage']);
    expect(guard.canActivate(ctxWith(resolvePermissions('OWNER')))).toBe(true);
    expect(() => guard.canActivate(ctxWith(resolvePermissions('MANAGER')))).toThrow();
    expect(() => guard.canActivate(ctxWith(undefined))).toThrow();
  });
});

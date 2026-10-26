import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { forbidden, unauthorized } from '../errors';

/**
 * Só SUPER_ADMIN. O papel é relido do banco a cada requisição pelo
 * JwtAuthGuard, então rebaixar alguém vale na hora.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<Request>().authUser;
    if (!user) throw unauthorized();
    if (user.platformRole !== 'SUPER_ADMIN') throw forbidden('Área restrita à administração da plataforma');
    return true;
  }
}

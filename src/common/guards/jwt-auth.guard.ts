import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC } from '../decorators';
import { ErrorCode, unauthorized } from '../errors';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  cid?: string | null;
}

/**
 * Global: toda rota exige access token válido, salvo @Public().
 * Além da assinatura, confere no banco que a sessão não foi revogada e que o
 * usuário está ativo — logout, reuso de refresh e bloqueio valem na hora.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7), { algorithms: ['HS256'] });
    } catch {
      throw unauthorized('Sessão expirada', ErrorCode.SESSION_EXPIRED);
    }

    const session = await this.prisma.refreshSession.findUnique({
      where: { id: payload.sid },
      select: {
        userId: true,
        revokedAt: true,
        user: { select: { id: true, email: true, name: true, status: true, platformRole: true } },
      },
    });
    if (!session || session.revokedAt || session.userId !== payload.sub || session.user.status !== 'ACTIVE') {
      throw unauthorized('Sessão encerrada', ErrorCode.SESSION_EXPIRED);
    }

    req.authUser = {
      userId: session.user.id,
      sessionId: payload.sid,
      email: session.user.email,
      name: session.user.name,
      platformRole: session.user.platformRole,
      claimedCompanyId: payload.cid ?? null,
    };
    return true;
  }
}

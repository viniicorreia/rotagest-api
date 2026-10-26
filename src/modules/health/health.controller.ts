import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';

/** Tempo máximo do SELECT 1 da prontidão: um banco travado conta como indisponível. */
const READY_TIMEOUT_MS = 2000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'Saúde geral (inclui o banco); mantido por compatibilidade' })
  async check() {
    await this.pingDb();
    return { status: 'ok' };
  }

  /** Liveness: o processo responde. Não toca no banco, para o orquestrador não reiniciar a API por queda do banco. */
  @Public()
  @SkipThrottle()
  @Get('live')
  @ApiOperation({ summary: 'Liveness: o processo está de pé (não consulta o banco)' })
  live() {
    return { status: 'ok' };
  }

  /** Readiness: pronto para receber tráfego (banco respondendo). 503 tira a instância do balanceador. */
  @Public()
  @SkipThrottle()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness: banco respondendo; 503 quando indisponível' })
  async ready() {
    await this.pingDb();
    return { status: 'ok' };
  }

  private async pingDb(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), READY_TIMEOUT_MS);
        }),
      ]);
    } catch {
      throw new ServiceUnavailableException({ message: 'Banco indisponível', code: 'DB_UNAVAILABLE' });
    } finally {
      clearTimeout(timer);
    }
  }
}

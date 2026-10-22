import { Controller, Get, Headers, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../../common/decorators';
import { notFound, unauthorized } from '../../common/errors';
import { AppConfig } from '../../config/app-config.service';
import { MetricsService } from './metrics.service';

/**
 * Endpoint de scrape do Prometheus. Fora do contrato OpenAPI (é operacional,
 * texto puro). Protegido por METRICS_TOKEN (Bearer); sem token configurado
 * responde 404, como se não existisse.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @SkipThrottle()
  @Get()
  async scrape(@Headers('authorization') authorization: string | undefined, @Res() res: Response): Promise<void> {
    const token = this.config.get('METRICS_TOKEN');
    if (!token) throw notFound('Rota não encontrada');
    if (!sameSecret(authorization ?? '', `Bearer ${token}`)) throw unauthorized('Token de métricas inválido');
    res.setHeader('Content-Type', this.metrics.contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.send(await this.metrics.render());
  }
}

/** Comparação em tempo constante (não revela o token por diferença de tempo). */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

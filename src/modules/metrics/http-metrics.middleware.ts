import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/** Rótulo de rota para requisições sem rota correspondente (404), evitando cardinalidade alta. */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * Mede a duração de cada requisição. A rota é lida no fim da resposta, quando
 * o Express já resolveu `req.route` (modelo com parâmetros, sem os IDs).
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.once('finish', () => {
      const routePath: unknown = (req.route as { path?: unknown } | undefined)?.path;
      const route = typeof routePath === 'string' ? `${req.baseUrl}${routePath}` : UNMATCHED_ROUTE;
      this.metrics.observe(req.method, route, res.statusCode, Number(process.hrtime.bigint() - start) / 1e9);
    });
    next();
  }
}

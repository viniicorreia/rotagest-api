import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const EVERY_MS = 60 * 60 * 1000;

/**
 * Fim do período de teste: assinaturas TRIALING com `trialEndsAt` vencido
 * passam a PAST_DUE (em atraso), que sinaliza no painel e na página da
 * assinatura sem bloquear o acesso (§5.6). A ativação continua administrativa
 * ou pelo gateway. Roda a cada hora; o lock no banco evita execução dupla com
 * várias réplicas.
 */
@Injectable()
export class TrialExpiryJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TrialExpiryJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get('JOBS_ENABLED')) return;
    this.timer = setInterval(() => void this.run().catch((err) => this.logger.error(err)), EVERY_MS);
    this.timer.unref();
    setTimeout(() => void this.run().catch((err) => this.logger.error(err)), 30_000).unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Retorna quantas assinaturas mudaram. */
  async run(now = new Date()): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext('job:trial-expiry')) AS locked`;
      if (!locked) return 0;
      const expired = await tx.subscription.findMany({
        where: { status: 'TRIALING', trialEndsAt: { lte: now } },
        select: { id: true, companyId: true, trialEndsAt: true },
      });
      for (const sub of expired) {
        await tx.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE' } });
        await this.audit.log(
          {
            companyId: sub.companyId,
            action: 'platform.subscription.trial_expired',
            entityType: 'Subscription',
            entityId: sub.id,
            before: { status: 'TRIALING', trialEndsAt: sub.trialEndsAt },
            after: { status: 'PAST_DUE' },
          },
          tx,
        );
      }
      if (expired.length) this.logger.log(`${expired.length} assinatura(s) saíram do período de teste`);
      return expired.length;
    }, { timeout: 60_000 });
  }
}

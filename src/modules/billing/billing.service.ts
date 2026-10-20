import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { badRequest, notFound } from '../../common/errors';
import { AppConfig } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PAYMENT_GATEWAYS, type GatewayEventType, type PaymentGateway } from './payment-gateway';

const STATUS_BY_EVENT: Partial<Record<GatewayEventType, 'ACTIVE' | 'PAST_DUE' | 'CANCELED'>> = {
  'subscription.activated': 'ACTIVE',
  'subscription.past_due': 'PAST_DUE',
  'subscription.canceled': 'CANCELED',
};

@Injectable()
export class BillingService {
  constructor(
    @Inject(PAYMENT_GATEWAYS) private readonly gateways: PaymentGateway[],
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Gateway ativo: o adaptador cujo nome é BILLING_PROVIDER. Sem ele, null. */
  active(): PaymentGateway | null {
    const provider = this.config.get('BILLING_PROVIDER');
    if (!provider) return null;
    return this.gateways.find((g) => g.provider === provider) ?? null;
  }

  status() {
    const gateway = this.active();
    return { configured: !!gateway, provider: gateway?.provider ?? null };
  }

  /**
   * Webhook do gateway: valida, grava o evento uma única vez e aplica a mudança
   * de status na assinatura correspondente.
   */
  async handleWebhook(provider: string, headers: Record<string, string | string[] | undefined>, rawBody: Buffer | undefined) {
    const gateway = this.active();
    if (!gateway || gateway.provider !== provider) throw notFound('Gateway não configurado');
    if (!rawBody?.length) throw badRequest('Corpo vazio');
    let event;
    try {
      event = gateway.parseWebhook(headers, rawBody);
    } catch {
      throw badRequest('Assinatura do webhook inválida');
    }

    return this.prisma.$transaction(async (tx) => {
      const sub = event.externalSubscriptionId
        ? await tx.subscription.findFirst({ where: { externalProvider: provider, externalId: event.externalSubscriptionId } })
        : null;
      try {
        await tx.billingEvent.create({
          data: {
            provider,
            externalId: event.externalId,
            type: event.rawType,
            companyId: sub?.companyId ?? null,
            payload: event.payload as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { received: true, duplicate: true };
        throw e;
      }
      const status = STATUS_BY_EVENT[event.type];
      if (sub && status && sub.status !== status) {
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status, ...(status === 'CANCELED' ? { canceledAt: new Date() } : {}) },
        });
        await this.audit.log(
          {
            companyId: sub.companyId,
            actorUserId: null,
            action: 'billing.subscription.status',
            entityType: 'Subscription',
            entityId: sub.id,
            before: { status: sub.status },
            after: { status },
            reason: `Evento ${event.rawType} do gateway ${provider}`,
          },
          tx,
        );
      }
      await tx.billingEvent.update({
        where: { provider_externalId: { provider, externalId: event.externalId } },
        data: { processedAt: new Date(), error: sub ? null : 'Assinatura não encontrada para o evento' },
      });
      return { received: true, duplicate: false };
    });
  }
}

/**
 * Contrato para integrar um gateway de pagamento (Asaas, Stripe, Pagar.me…) à
 * assinatura SaaS. Nenhum adaptador vem habilitado: sem BILLING_PROVIDER a
 * plataforma funciona só com ativação administrativa e não simula cobranças.
 *
 * A assinatura SaaS nunca gera contas a pagar/receber nem movimentações no
 * financeiro operacional das empresas.
 */
export interface GatewayCustomerInput {
  companyId: string;
  name: string;
  document: string;
  email: string | null;
}

export interface GatewaySubscriptionInput {
  customerId: string;
  planCode: string;
  /** Valor em texto decimal ("149.90"), como no Plan. */
  price: string;
  currency: string;
  interval: 'MONTHLY' | 'YEARLY';
}

/** Eventos normalizados que o sistema sabe aplicar à assinatura. */
export type GatewayEventType = 'subscription.activated' | 'subscription.past_due' | 'subscription.canceled' | 'other';

export interface GatewayEvent {
  /** Id do evento no gateway: garante idempotência. */
  externalId: string;
  type: GatewayEventType;
  /** Tipo original do gateway, guardado para consulta. */
  rawType: string;
  externalSubscriptionId: string | null;
  payload: unknown;
}

export interface PaymentGateway {
  readonly provider: string;
  createCustomer(input: GatewayCustomerInput): Promise<{ customerId: string }>;
  createSubscription(input: GatewaySubscriptionInput): Promise<{ subscriptionId: string; checkoutUrl: string | null }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  /** Valida a assinatura do webhook e normaliza o evento. Lança erro se inválido. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): GatewayEvent;
}

/** Lista de adaptadores disponíveis (vazia por padrão). */
export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');

import { Global, Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PAYMENT_GATEWAYS } from './payment-gateway';

/** Nenhum adaptador registrado por padrão: a lista recebe as integrações quando existirem. */
@Global()
@Module({
  controllers: [BillingController],
  providers: [BillingService, { provide: PAYMENT_GATEWAYS, useValue: [] }],
  exports: [BillingService],
})
export class BillingModule {}

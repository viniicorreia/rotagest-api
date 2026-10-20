import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { PeriodLockService } from './period-lock.service';

/** Núcleo financeiro compartilhado: razão (saldos) e bloqueio de período. */
@Global()
@Module({ providers: [LedgerService, PeriodLockService], exports: [LedgerService, PeriodLockService] })
export class TransactionsModule {}

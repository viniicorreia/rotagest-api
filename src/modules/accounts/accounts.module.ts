import { Global, Module } from '@nestjs/common';
import { AccountsController, TransfersController } from './accounts.controller';
import { AccountsService } from './accounts.service';

/** FinancialAccountsModule: contas, extrato, ajustes e transferências. */
@Global()
@Module({ controllers: [AccountsController, TransfersController], providers: [AccountsService], exports: [AccountsService] })
export class FinancialAccountsModule {}

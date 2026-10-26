import { Global, Module } from '@nestjs/common';
import { ContractBillingService } from './contract-billing.service';
import { ContractorsController, ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

@Global()
@Module({ controllers: [ContractorsController, ContractsController], providers: [ContractsService, ContractBillingService], exports: [ContractBillingService] })
export class ContractsModule {}

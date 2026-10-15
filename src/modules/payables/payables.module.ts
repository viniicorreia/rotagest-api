import { Module } from '@nestjs/common';
import { PayablesController } from './payables.controller';
import { PayablesService } from './payables.service';

@Module({ controllers: [PayablesController], providers: [PayablesService] })
export class PayablesModule {}

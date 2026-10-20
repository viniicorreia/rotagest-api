import { Module } from '@nestjs/common';
import { PayablesModule } from '../payables/payables.module';
import { FleetCostsController } from './fleet-costs.controller';
import { FleetCostsService } from './fleet-costs.service';

@Module({ imports: [PayablesModule], controllers: [FleetCostsController], providers: [FleetCostsService] })
export class FleetCostsModule {}

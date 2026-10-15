import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({ imports: [DashboardModule], controllers: [VehiclesController], providers: [VehiclesService] })
export class VehiclesModule {}

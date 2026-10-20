import { Global, Module } from '@nestjs/common';
import { AssignmentsController, DriversController, RoutesController } from './fleet.controller';
import { FleetService } from './fleet.service';

@Global()
@Module({ controllers: [DriversController, RoutesController, AssignmentsController], providers: [FleetService], exports: [FleetService] })
export class FleetModule {}

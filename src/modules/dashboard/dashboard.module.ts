import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ResultsService } from './results.service';

@Module({ controllers: [DashboardController], providers: [DashboardService, ResultsService], exports: [ResultsService] })
export class DashboardModule {}

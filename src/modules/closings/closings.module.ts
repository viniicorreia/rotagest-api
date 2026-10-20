import { Module } from '@nestjs/common';
import { ReportsModule } from '../reports/reports.module';
import { ClosingsController } from './closings.controller';
import { ClosingsService } from './closings.service';

@Module({ imports: [ReportsModule], controllers: [ClosingsController], providers: [ClosingsService] })
export class ClosingsModule {}

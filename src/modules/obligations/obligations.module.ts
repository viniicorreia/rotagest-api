import { Global, Module } from '@nestjs/common';
import { RecurrenceService } from './recurrence.service';
import { RecurrencesController } from './recurrences.controller';

@Global()
@Module({ controllers: [RecurrencesController], providers: [RecurrenceService], exports: [RecurrenceService] })
export class ObligationsModule {}

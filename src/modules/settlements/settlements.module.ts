import { Global, Module } from '@nestjs/common';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';

@Global()
@Module({ controllers: [SettlementsController], providers: [SettlementsService], exports: [SettlementsService] })
export class SettlementsModule {}

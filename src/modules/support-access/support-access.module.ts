import { Module } from '@nestjs/common';
import { SupportAccessController, SupportSessionController } from './support-access.controller';
import { SupportAccessService } from './support-access.service';

@Module({
  controllers: [SupportAccessController, SupportSessionController],
  providers: [SupportAccessService],
})
export class SupportAccessModule {}

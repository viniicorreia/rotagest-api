import { Global, Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';
import { PlatformSettingsService } from './platform-settings.service';
import { PlansController, SubscriptionsController } from './subscriptions.controller';

@Global()
@Module({
  controllers: [SubscriptionsController, PlansController],
  providers: [PlanLimitsService, PlatformSettingsService],
  exports: [PlanLimitsService, PlatformSettingsService],
})
export class SubscriptionsModule {}

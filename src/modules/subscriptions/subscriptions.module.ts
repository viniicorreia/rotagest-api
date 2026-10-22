import { Global, Module } from '@nestjs/common';
import { PlanLimitsService } from './plan-limits.service';
import { PlatformSettingsService } from './platform-settings.service';
import { TrialExpiryJob } from './trial-expiry.job';
import { PlansController, SubscriptionsController } from './subscriptions.controller';

@Global()
@Module({
  controllers: [SubscriptionsController, PlansController],
  providers: [PlanLimitsService, PlatformSettingsService, TrialExpiryJob],
  exports: [PlanLimitsService, PlatformSettingsService, TrialExpiryJob],
})
export class SubscriptionsModule {}

import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DatabaseModule } from '../database/database.module';
import { BillingController } from './billing.controller';
import { InternalBillingController } from './internal-billing.controller';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';
import { LiteLLMClientService } from './litellm-client.service';
import { LiteLLMKeyResolverService } from './litellm-key-resolver.service';
import { SubscriptionPlansService } from './subscription-plans.service';

@Module({
  imports: [DatabaseModule, AnalyticsModule],
  controllers: [BillingController, InternalBillingController],
  providers: [
    BillingRepository,
    BillingService,
    LiteLLMClientService,
    LiteLLMKeyResolverService,
    SubscriptionPlansService,
  ],
  exports: [BillingService, LiteLLMKeyResolverService, SubscriptionPlansService],
})
export class BillingModule {}

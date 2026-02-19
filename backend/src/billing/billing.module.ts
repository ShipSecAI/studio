import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DatabaseModule } from '../database/database.module';
import { BillingController } from './billing.controller';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';
import { LiteLLMClientService } from './litellm-client.service';
import { SubscriptionPlansService } from './subscription-plans.service';

@Module({
  imports: [DatabaseModule, AnalyticsModule],
  controllers: [BillingController],
  providers: [BillingRepository, BillingService, LiteLLMClientService, SubscriptionPlansService],
  exports: [BillingService, SubscriptionPlansService],
})
export class BillingModule {}

import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DatabaseModule } from '../database/database.module';
import { BillingController } from './billing.controller';
import { InternalBillingController } from './internal-billing.controller';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';
import { BifrostClientService } from './bifrost-client.service';
import { BifrostKeyResolverService } from './bifrost-key-resolver.service';
import { SubscriptionPlansService } from './subscription-plans.service';

@Module({
  imports: [DatabaseModule, AnalyticsModule],
  controllers: [BillingController, InternalBillingController],
  providers: [
    BillingRepository,
    BillingService,
    BifrostClientService,
    BifrostKeyResolverService,
    SubscriptionPlansService,
  ],
  exports: [BillingService, BifrostKeyResolverService, SubscriptionPlansService],
})
export class BillingModule {}

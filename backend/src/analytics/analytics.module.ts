import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsService } from './analytics.service';
import { SecurityAnalyticsService } from './security-analytics.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { ClickHouseTenantService } from './clickhouse-tenant.service';
import { AnalyticsController } from './analytics.controller';
import { BILLING_PROVIDER } from '../providers/tokens';
import { createDefaultProviderRegistry, resolveProvider } from '../providers/provider-registry';

@Module({
  imports: [ConfigModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    SecurityAnalyticsService,
    OrganizationSettingsService,
    ClickHouseTenantService,
    {
      provide: BILLING_PROVIDER,
      useFactory: () => resolveProvider('billing', createDefaultProviderRegistry().billing),
    },
  ],
  exports: [
    AnalyticsService,
    SecurityAnalyticsService,
    OrganizationSettingsService,
    ClickHouseTenantService,
  ],
})
export class AnalyticsModule {}

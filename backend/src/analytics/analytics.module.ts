import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { SecurityAnalyticsService } from './security-analytics.service';
import { OrganizationSettingsService } from './organization-settings.service';
import { OpenSearchTenantService } from './opensearch-tenant.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    SecurityAnalyticsService,
    OrganizationSettingsService,
    OpenSearchTenantService,
  ],
  exports: [
    AnalyticsService,
    SecurityAnalyticsService,
    OrganizationSettingsService,
    OpenSearchTenantService,
  ],
})
export class AnalyticsModule {}

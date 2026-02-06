import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import {
  organizationSettingsTable,
  OrganizationSettings,
  SubscriptionTier,
} from '../database/schema/organization-settings';
import { TIER_LIMITS } from './dto/analytics-settings.dto';
import { OpenSearchTenantService } from './opensearch-tenant.service';

@Injectable()
export class OrganizationSettingsService {
  private readonly logger = new Logger(OrganizationSettingsService.name);

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase,
    private readonly tenantService: OpenSearchTenantService,
  ) {}

  /**
   * Get or create organization settings
   */
  async getOrganizationSettings(organizationId: string): Promise<OrganizationSettings> {
    // Try to get existing settings
    const [existing] = await this.db
      .select()
      .from(organizationSettingsTable)
      .where(eq(organizationSettingsTable.organizationId, organizationId));

    if (existing) {
      return existing;
    }

    // Create default settings if they don't exist
    this.logger.log(`Creating default settings for organization: ${organizationId}`);
    const [created] = await this.db
      .insert(organizationSettingsTable)
      .values({
        organizationId,
        subscriptionTier: 'free',
        analyticsRetentionDays: 30,
      })
      .returning();

    // Provision OpenSearch tenant for the new organization (fire-and-forget)
    this.tenantService.ensureTenantExists(organizationId).catch((err) => {
      this.logger.error(`Failed to provision OpenSearch tenant for ${organizationId}: ${err}`);
    });

    return created;
  }

  /**
   * Update organization settings
   */
  async updateOrganizationSettings(
    organizationId: string,
    updates: {
      analyticsRetentionDays?: number;
      subscriptionTier?: SubscriptionTier;
    },
  ): Promise<OrganizationSettings> {
    // Ensure settings exist
    await this.getOrganizationSettings(organizationId);

    // Update settings
    const [updated] = await this.db
      .update(organizationSettingsTable)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(organizationSettingsTable.organizationId, organizationId))
      .returning();

    this.logger.log(
      `Updated settings for organization ${organizationId}: ${JSON.stringify(updates)}`,
    );

    return updated;
  }

  /**
   * Validate retention period is within tier limits
   */
  validateRetentionPeriod(tier: SubscriptionTier, retentionDays: number): boolean {
    const limit = TIER_LIMITS[tier];
    return retentionDays <= limit.maxRetentionDays && retentionDays > 0;
  }

  /**
   * Get max retention days for a tier
   */
  getMaxRetentionDays(tier: SubscriptionTier): number {
    return TIER_LIMITS[tier].maxRetentionDays;
  }
}

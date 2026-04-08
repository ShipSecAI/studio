import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import { bifrostVirtualKeysTable } from '../database/schema/litellm-virtual-keys';
import { BifrostClientService } from './bifrost-client.service';
import { SubscriptionPlansService } from './subscription-plans.service';
import { OrganizationSettingsService } from '../analytics/organization-settings.service';

@Injectable()
export class BifrostKeyResolverService {
  private readonly logger = new Logger(BifrostKeyResolverService.name);
  private readonly teamSyncTtlMs = 5 * 60 * 1000;

  /** In-memory cache: orgId → virtual key */
  private readonly cache = new Map<string, string>();
  private readonly teamSyncCache = new Map<string, number>();

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<Record<string, unknown>>,
    private readonly bifrost: BifrostClientService,
    private readonly plansService: SubscriptionPlansService,
    private readonly orgSettingsService: OrganizationSettingsService,
  ) {}

  /**
   * Resolve a Bifrost virtual key for an organization.
   * 1. Check in-memory cache
   * 2. Check DB
   * 3. Provision team + key via Bifrost API, persist to DB
   *
   * Returns null if Bifrost is not configured.
   */
  async resolveVirtualKey(orgId: string): Promise<string | null> {
    if (!this.bifrost.isConfigured) {
      return null;
    }

    // 1. In-memory cache
    const cached = this.cache.get(orgId);
    if (cached) {
      await this.ensureTeamBudgetSynced(orgId);
      return cached;
    }

    // 2. DB fallback
    const rows = await this.db
      .select()
      .from(bifrostVirtualKeysTable)
      .where(eq(bifrostVirtualKeysTable.organizationId, orgId))
      .limit(1);

    if (rows.length > 0) {
      await this.ensureTeamBudgetSynced(orgId);
      this.cache.set(orgId, rows[0].virtualKey);
      return rows[0].virtualKey;
    }

    // 3. Provision: create team with budget, generate key
    try {
      const settings = await this.orgSettingsService.getOrganizationSettings(orgId);
      const plan = await this.plansService.getPlanByTier(settings.subscriptionTier);

      const budgetUsd = plan.aiBudgetUsdCents === -1 ? null : plan.aiBudgetUsdCents / 100;

      // Ensure the Bifrost team exists with the correct budget
      await this.bifrost.ensureTeam(orgId, budgetUsd ?? 999999);
      this.teamSyncCache.set(orgId, Date.now());

      // Generate a virtual key scoped to this team
      const virtualKey = await this.bifrost.generateKey(orgId);

      // Persist to DB
      await this.db
        .insert(bifrostVirtualKeysTable)
        .values({
          organizationId: orgId,
          teamId: orgId,
          virtualKey,
        })
        .onConflictDoUpdate({
          target: bifrostVirtualKeysTable.organizationId,
          set: {
            virtualKey,
            updatedAt: new Date(),
          },
        });

      this.cache.set(orgId, virtualKey);
      this.logger.log(`Provisioned Bifrost virtual key for org ${orgId}`);
      return virtualKey;
    } catch (error) {
      this.logger.error(`Failed to provision Bifrost virtual key for org ${orgId}: ${error}`);
      return null;
    }
  }

  private async ensureTeamBudgetSynced(orgId: string): Promise<void> {
    const lastSyncedAt = this.teamSyncCache.get(orgId) ?? 0;
    if (Date.now() - lastSyncedAt < this.teamSyncTtlMs) {
      return;
    }

    try {
      const settings = await this.orgSettingsService.getOrganizationSettings(orgId);
      const plan = await this.plansService.getPlanByTier(settings.subscriptionTier);
      const budgetUsd = plan.aiBudgetUsdCents === -1 ? null : plan.aiBudgetUsdCents / 100;
      await this.bifrost.ensureTeam(orgId, budgetUsd ?? 999999);
      this.teamSyncCache.set(orgId, Date.now());
    } catch (error) {
      this.logger.warn(`Failed to sync Bifrost budget for org ${orgId}: ${error}`);
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DRIZZLE_TOKEN } from '../database/database.module';
import type { SubscriptionTier } from '../database/schema/organization-settings';
import {
  subscriptionPlansTable,
  type SubscriptionPlan,
} from '../database/schema/subscription-plans';

@Injectable()
export class SubscriptionPlansService {
  private readonly logger = new Logger(SubscriptionPlansService.name);
  private plansCache = new Map<string, SubscriptionPlan>();
  private cacheTimestamp = 0;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<Record<string, unknown>>,
  ) {}

  async getAllActivePlans(): Promise<SubscriptionPlan[]> {
    await this.ensureCache();
    return Array.from(this.plansCache.values()).filter((p) => p.isActive);
  }

  async getPlanByTier(tier: SubscriptionTier): Promise<SubscriptionPlan> {
    await this.ensureCache();
    const plan = this.plansCache.get(tier);
    if (!plan) {
      throw new Error(`Subscription plan not found: ${tier}`);
    }
    return plan;
  }

  private async ensureCache(): Promise<void> {
    if (Date.now() - this.cacheTimestamp < this.cacheTtlMs && this.plansCache.size > 0) {
      return;
    }

    const plans = await this.db
      .select()
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.isActive, true));

    this.plansCache.clear();
    for (const plan of plans) {
      this.plansCache.set(plan.id, plan);
    }
    this.cacheTimestamp = Date.now();
    this.logger.log(`Refreshed subscription plans cache (${plans.length} plans)`);
  }
}

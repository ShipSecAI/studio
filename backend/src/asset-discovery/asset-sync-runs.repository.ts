import { Inject, Injectable } from '@nestjs/common';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, desc, count } from 'drizzle-orm';
import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { assetSyncRuns } from '../database/schema/asset-discovery';
import type { NewAssetSyncRun } from '../database/schema/asset-discovery';

@Injectable()
export class AssetSyncRunsRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(data: NewAssetSyncRun) {
    const [row] = await this.db.insert(assetSyncRuns).values(data).returning();
    return row;
  }

  async updateStatus(
    syncRunId: string,
    updates: {
      status: string;
      assetsDiscovered?: number;
      assetsCreated?: number;
      assetsUpdated?: number;
      assetsStale?: number;
      coveredRegions?: string[];
      errors?: { message: string; timestamp: string }[];
      completedAt?: Date;
    },
  ) {
    const [row] = await this.db
      .update(assetSyncRuns)
      .set(updates)
      .where(eq(assetSyncRuns.id, syncRunId))
      .returning();
    return row;
  }

  async getById(syncRunId: string) {
    const [row] = await this.db
      .select()
      .from(assetSyncRuns)
      .where(eq(assetSyncRuns.id, syncRunId))
      .limit(1);
    return row ?? null;
  }

  async listByOrg(
    organizationId: string,
    options: {
      integrationId?: string;
      limit?: number;
      page?: number;
    } = {},
  ) {
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = ((options.page ?? 1) - 1) * limit;

    const conditions = [eq(assetSyncRuns.organizationId, organizationId)];
    if (options.integrationId) {
      conditions.push(eq(assetSyncRuns.integrationId, options.integrationId));
    }

    const where = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(assetSyncRuns)
        .where(where)
        .orderBy(desc(assetSyncRuns.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(assetSyncRuns).where(where),
    ]);

    return { data: rows, total, page: options.page ?? 1, limit };
  }

  /**
   * Find the most recent completed sync for an account (used by stale-guard).
   */
  async findRecentCompletedSync(
    organizationId: string,
    accountIdentifier: string,
    _excludeIntegrationId: string,
  ) {
    const [row] = await this.db
      .select()
      .from(assetSyncRuns)
      .where(
        and(
          eq(assetSyncRuns.organizationId, organizationId),
          eq(assetSyncRuns.accountIdentifier, accountIdentifier),
          eq(assetSyncRuns.status, 'completed'),
        ),
      )
      .orderBy(desc(assetSyncRuns.completedAt))
      .limit(1);
    return row ?? null;
  }
}

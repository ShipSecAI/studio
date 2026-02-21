import { Inject, Injectable } from '@nestjs/common';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, sql, desc, asc, count, lt } from 'drizzle-orm';
import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { assets, assetSyncRunScopes, assetSyncRuns } from '../database/schema/asset-discovery';

@Injectable()
export class AssetDiscoveryRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Upsert assets from a discovery page. Uses ON CONFLICT to update lastSeenAt
   * and metadata for existing assets, or insert new ones.
   * Returns { created, updated, unchangedCount }.
   */
  async reconcileAssets(
    organizationId: string,
    integrationId: string,
    accountIdentifier: string,
    syncRunId: string,
    discoveredAssets: {
      assetType: string;
      externalId: string;
      name: string;
      region?: string;
      metadata: Record<string, unknown>;
    }[],
  ): Promise<{
    created: {
      id: string;
      assetType: string;
      externalId: string;
      name: string | null;
      provider: string;
      region: string | null;
      accountIdentifier: string | null;
    }[];
    updated: {
      id: string;
      assetType: string;
      externalId: string;
      name: string | null;
      provider: string;
      region: string | null;
      accountIdentifier: string | null;
      changedFields: string[];
    }[];
    unchangedCount: number;
  }> {
    const now = new Date();
    const created: typeof this.reconcileAssets extends (
      ...args: any[]
    ) => Promise<{ created: infer C }>
      ? C
      : never = [];
    const updated: {
      id: string;
      assetType: string;
      externalId: string;
      name: string | null;
      provider: string;
      region: string | null;
      accountIdentifier: string | null;
      changedFields: string[];
    }[] = [];
    let unchangedCount = 0;

    for (const asset of discoveredAssets) {
      // Try to find existing asset by unique key
      const existing = await this.db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.organizationId, organizationId),
            eq(assets.provider, 'aws'),
            eq(assets.assetType, asset.assetType),
            eq(assets.externalId, asset.externalId),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        // Insert new asset
        const [inserted] = await this.db
          .insert(assets)
          .values({
            organizationId,
            integrationId,
            provider: 'aws',
            accountIdentifier,
            assetType: asset.assetType,
            externalId: asset.externalId,
            name: asset.name,
            region: asset.region,
            metadata: asset.metadata,
            firstDiscoveredAt: now,
            lastSeenAt: now,
            status: 'active',
          })
          .returning();

        created.push({
          id: inserted.id,
          assetType: inserted.assetType,
          externalId: inserted.externalId,
          name: inserted.name,
          provider: inserted.provider,
          region: inserted.region,
          accountIdentifier: inserted.accountIdentifier,
        });
      } else {
        const row = existing[0];
        const changedFields: string[] = [];

        if (row.name !== asset.name) changedFields.push('name');
        if (row.region !== (asset.region ?? null)) changedFields.push('region');
        if (JSON.stringify(row.metadata) !== JSON.stringify(asset.metadata))
          changedFields.push('metadata');
        if (row.integrationId !== integrationId) changedFields.push('integrationId');
        if (row.status !== 'active') changedFields.push('status');

        // Always update lastSeenAt + integrationId (whichever connection last synced)
        await this.db
          .update(assets)
          .set({
            lastSeenAt: now,
            integrationId,
            accountIdentifier,
            name: asset.name,
            region: asset.region,
            metadata: asset.metadata,
            status: 'active', // Reactivate if previously stale
            updatedAt: now,
          })
          .where(eq(assets.id, row.id));

        if (changedFields.length > 0) {
          updated.push({
            id: row.id,
            assetType: row.assetType,
            externalId: row.externalId,
            name: asset.name,
            provider: row.provider,
            region: asset.region ?? null,
            accountIdentifier,
            changedFields,
          });
        } else {
          unchangedCount++;
        }
      }
    }

    return { created, updated, unchangedCount };
  }

  /**
   * Persist scanned scopes for a sync run (must be called BEFORE markStaleAssets).
   */
  async persistSyncRunScopes(
    syncRunId: string,
    scopes: { assetType: string; region: string }[],
  ): Promise<void> {
    if (scopes.length === 0) return;

    // Deduplicate scopes
    const uniqueScopes = new Map<string, { assetType: string; region: string }>();
    for (const scope of scopes) {
      uniqueScopes.set(`${scope.assetType}:${scope.region}`, scope);
    }

    await this.db
      .insert(assetSyncRunScopes)
      .values(
        Array.from(uniqueScopes.values()).map((s) => ({
          syncRunId,
          assetType: s.assetType,
          region: s.region,
        })),
      )
      .onConflictDoNothing();
  }

  /**
   * Mark assets as stale using exact-pair scoping with multi-connection guard.
   * Only marks assets stale if their (assetType, region) pair was actually scanned.
   * Returns full asset snapshots for Kafka events.
   */
  async markStaleAssets(
    organizationId: string,
    integrationId: string,
    accountIdentifier: string,
    syncRunId: string,
    syncStartTime: Date,
  ): Promise<{
    newlyStale: {
      id: string;
      assetType: string;
      externalId: string;
      name: string | null;
      provider: string;
      region: string | null;
      accountIdentifier: string | null;
    }[];
    newlyRemoved: {
      id: string;
      assetType: string;
      externalId: string;
      name: string | null;
      provider: string;
      region: string | null;
      accountIdentifier: string | null;
    }[];
  }> {
    const now = new Date();

    // Step 1: Mark stale — exact-pair scoped with multi-connection guard
    const staleResult = await this.db
      .update(assets)
      .set({ status: 'stale', updatedAt: now })
      .where(
        and(
          eq(assets.organizationId, organizationId),
          eq(assets.provider, 'aws'),
          eq(assets.accountIdentifier, accountIdentifier),
          eq(assets.status, 'active'),
          lt(assets.lastSeenAt, syncStartTime),
          // Only mark stale if the (assetType, region) pair was actually scanned
          sql`EXISTS (
            SELECT 1 FROM ${assetSyncRunScopes} s
            WHERE s.sync_run_id = ${syncRunId}
              AND s.asset_type = ${assets.assetType}
              AND s.region = ${assets.region}
          )`,
          // Multi-connection guard: skip if another connection recently scanned the same pair
          sql`NOT EXISTS (
            SELECT 1 FROM ${assetSyncRuns} other_run
            JOIN ${assetSyncRunScopes} other_scope ON other_run.id = other_scope.sync_run_id
            WHERE other_run.organization_id = ${organizationId}
              AND other_run.account_identifier = ${accountIdentifier}
              AND other_run.integration_id != ${integrationId}
              AND other_run.status = 'completed'
              AND other_run.completed_at > (now() - interval '12 hours')
              AND other_scope.asset_type = ${assets.assetType}
              AND other_scope.region = ${assets.region}
          )`,
        ),
      )
      .returning({
        id: assets.id,
        assetType: assets.assetType,
        externalId: assets.externalId,
        name: assets.name,
        provider: assets.provider,
        region: assets.region,
        accountIdentifier: assets.accountIdentifier,
      });

    // Step 2: Mark removed — stale for > 7 days
    const removedResult = await this.db
      .update(assets)
      .set({ status: 'removed', updatedAt: now })
      .where(
        and(
          eq(assets.organizationId, organizationId),
          eq(assets.accountIdentifier, accountIdentifier),
          eq(assets.status, 'stale'),
          sql`${assets.updatedAt} < (now() - interval '7 days')`,
        ),
      )
      .returning({
        id: assets.id,
        assetType: assets.assetType,
        externalId: assets.externalId,
        name: assets.name,
        provider: assets.provider,
        region: assets.region,
        accountIdentifier: assets.accountIdentifier,
      });

    return { newlyStale: staleResult, newlyRemoved: removedResult };
  }

  /**
   * List assets with filtering, sorting, and pagination.
   */
  async listAssets(
    organizationId: string,
    options: {
      provider?: string;
      assetType?: string;
      region?: string;
      status?: string;
      integrationId?: string;
      search?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    } = {},
  ) {
    const limit = Math.min(options.limit ?? 50, 200);
    const offset = ((options.page ?? 1) - 1) * limit;

    const conditions = [eq(assets.organizationId, organizationId)];
    if (options.provider) conditions.push(eq(assets.provider, options.provider));
    if (options.assetType) conditions.push(eq(assets.assetType, options.assetType));
    if (options.region) conditions.push(eq(assets.region, options.region));
    if (options.status) conditions.push(eq(assets.status, options.status));
    if (options.integrationId) conditions.push(eq(assets.integrationId, options.integrationId));
    if (options.search) {
      conditions.push(
        sql`(${assets.name} ILIKE ${'%' + options.search + '%'} OR ${assets.externalId} ILIKE ${'%' + options.search + '%'})`,
      );
    }

    const where = and(...conditions);

    const sortColumn =
      options.sortBy === 'name'
        ? assets.name
        : options.sortBy === 'firstDiscoveredAt'
          ? assets.firstDiscoveredAt
          : assets.lastSeenAt;
    const sortFn = options.sortOrder === 'asc' ? asc : desc;

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(assets)
        .where(where)
        .orderBy(sortFn(sortColumn))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(assets).where(where),
    ]);

    return { data: rows, total, page: options.page ?? 1, limit };
  }

  /**
   * Get a single asset by ID (org-scoped).
   */
  async getAssetById(organizationId: string, assetId: string) {
    const [row] = await this.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.organizationId, organizationId)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Get summary counts by type, status, provider.
   */
  async getSummary(organizationId: string) {
    const baseWhere = eq(assets.organizationId, organizationId);

    const [totalResult, byTypeResult, byStatusResult, byProviderResult] = await Promise.all([
      this.db.select({ total: count() }).from(assets).where(baseWhere),
      this.db
        .select({ assetType: assets.assetType, count: count() })
        .from(assets)
        .where(baseWhere)
        .groupBy(assets.assetType),
      this.db
        .select({ status: assets.status, count: count() })
        .from(assets)
        .where(baseWhere)
        .groupBy(assets.status),
      this.db
        .select({ provider: assets.provider, count: count() })
        .from(assets)
        .where(baseWhere)
        .groupBy(assets.provider),
    ]);

    return {
      totalAssets: totalResult[0]?.total ?? 0,
      byProvider: Object.fromEntries(byProviderResult.map((r) => [r.provider, r.count])),
      byType: Object.fromEntries(byTypeResult.map((r) => [r.assetType, r.count])),
      byStatus: Object.fromEntries(byStatusResult.map((r) => [r.status ?? 'unknown', r.count])),
    };
  }

  /**
   * Mark all assets for an account as removed (used when last connection is deleted).
   */
  async markAllAssetsRemoved(organizationId: string, accountIdentifier: string) {
    return this.db
      .update(assets)
      .set({ status: 'removed', updatedAt: new Date() })
      .where(
        and(
          eq(assets.organizationId, organizationId),
          eq(assets.accountIdentifier, accountIdentifier),
          sql`${assets.status} != 'removed'`,
        ),
      );
  }

  /**
   * Clear integrationId on assets when a connection is deleted but other connections exist.
   */
  async clearIntegrationId(organizationId: string, integrationId: string) {
    return this.db
      .update(assets)
      .set({ integrationId: null, updatedAt: new Date() })
      .where(
        and(eq(assets.organizationId, organizationId), eq(assets.integrationId, integrationId)),
      );
  }
}

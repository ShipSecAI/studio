import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { assets } from '../database/schema/asset-discovery';
import type { GraphAssetSnapshot } from './cloud-graph.service';

@Injectable()
export class AssetDiscoveryRepository {
  constructor(
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async getHistoricalStatusCounts(organizationId: string) {
    const rows = await this.db
      .select({ status: assets.status, count: count() })
      .from(assets)
      .where(
        and(
          eq(assets.organizationId, organizationId),
          inArray(assets.status, ['stale', 'removed']),
        ),
      )
      .groupBy(assets.status);

    return rows.map((row) => ({
      status: row.status ?? 'unknown',
      count: Number(row.count),
    }));
  }

  async upsertGraphSnapshots(
    organizationId: string,
    integrationId: string,
    snapshots: GraphAssetSnapshot[],
  ): Promise<{ created: number; updated: number }> {
    if (snapshots.length === 0) return { created: 0, updated: 0 };

    let created = 0;
    let updated = 0;

    for (const s of snapshots) {
      const existing = await this.db
        .select({ id: assets.id, name: assets.name })
        .from(assets)
        .where(
          and(
            eq(assets.organizationId, organizationId),
            eq(assets.provider, s.provider),
            eq(assets.assetType, s.assetType),
            eq(assets.externalId, s.externalId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await this.db
          .update(assets)
          .set({
            integrationId,
            name: s.name ?? existing[0]?.name ?? null,
            region: s.region ?? null,
            metadata: s.metadata,
            lastSeenAt: new Date(s.lastSeenAt),
            status: 'active',
            updatedAt: new Date(),
          })
          .where(eq(assets.id, existing[0].id));
        updated++;
      } else {
        await this.db.insert(assets).values({
          id: s.id,
          organizationId,
          integrationId,
          provider: s.provider,
          accountIdentifier: s.accountIdentifier ?? null,
          assetType: s.assetType,
          externalId: s.externalId,
          name: s.name ?? null,
          region: s.region ?? null,
          metadata: s.metadata,
          firstDiscoveredAt: new Date(s.firstSeenAt),
          lastSeenAt: new Date(s.lastSeenAt),
        });
        created++;
      }
    }

    return { created, updated };
  }

  async markStaleUnseenAssets(
    organizationId: string,
    integrationId: string,
    seenExternalIds: string[],
  ): Promise<number> {
    if (seenExternalIds.length === 0) {
      const result = await this.db
        .update(assets)
        .set({ status: 'stale', updatedAt: new Date() })
        .where(
          and(
            eq(assets.organizationId, organizationId),
            eq(assets.integrationId, integrationId),
            eq(assets.status, 'active'),
          ),
        );
      return result.rowCount ?? 0;
    }

    const result = await this.db
      .update(assets)
      .set({ status: 'stale', updatedAt: new Date() })
      .where(
        and(
          eq(assets.organizationId, organizationId),
          eq(assets.integrationId, integrationId),
          eq(assets.status, 'active'),
          sql`${assets.externalId} NOT IN (${sql.join(
            seenExternalIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        ),
      );
    return result.rowCount ?? 0;
  }
}

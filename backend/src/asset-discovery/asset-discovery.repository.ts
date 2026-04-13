import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, inArray } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { assets } from '../database/schema/asset-discovery';

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
}

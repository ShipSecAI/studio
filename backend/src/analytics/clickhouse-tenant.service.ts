import { Injectable, Logger } from '@nestjs/common';
import { ClickHouseClientService } from '../config/clickhouse.client';

/**
 * ClickHouse Tenant Service
 *
 * Verifies that the ClickHouse schema exists.
 * Table creation is handled by docker/clickhouse/init-schema.sql
 * on first container startup.
 */
@Injectable()
export class ClickHouseTenantService {
  private readonly logger = new Logger(ClickHouseTenantService.name);

  constructor(private readonly clickhouseClient: ClickHouseClientService) {}

  async ensureSchemaExists(): Promise<boolean> {
    const client = this.clickhouseClient.getClient();
    if (!client) {
      this.logger.warn('ClickHouse client not available, skipping schema check');
      return false;
    }

    try {
      const result = await client.query({
        query: `SELECT count() AS cnt FROM system.tables WHERE database = currentDatabase() AND name = 'security_findings'`,
        format: 'JSONEachRow',
      });
      const rows = await result.json<{ cnt: string }>();
      const exists = Number(rows[0]?.cnt ?? 0) > 0;

      if (!exists) {
        this.logger.warn(
          'ClickHouse tables not found. Run docker compose to initialize schema via init-schema.sql.',
        );
        return false;
      }

      this.logger.log('ClickHouse schema verified');
      return true;
    } catch (error: any) {
      this.logger.error(`Failed to verify ClickHouse schema: ${error?.message || error}`);
      return false;
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ClickHouseClientService } from '../config/clickhouse.client';
import {
  FILTERABLE_COLUMNS,
  ARRAY_COLUMNS,
  MAP_COLUMNS,
  buildFindingRow,
  detectAssetKey,
  severityOrderExpr,
} from '@shipsec/component-sdk';

interface IndexDocumentOptions {
  workflowId: string;
  workflowName: string;
  runId: string;
  nodeRef: string;
  componentId: string;
  assetKeyField?: string;
}

@Injectable()
export class SecurityAnalyticsService {
  private readonly logger = new Logger(SecurityAnalyticsService.name);

  constructor(private readonly clickhouseClient: ClickHouseClientService) {}

  /**
   * Index a single document to ClickHouse with metadata
   */
  async indexDocument(
    orgId: string,
    document: Record<string, any>,
    options: IndexDocumentOptions,
  ): Promise<void> {
    if (!this.clickhouseClient.isClientEnabled()) {
      this.logger.debug('ClickHouse client not enabled, skipping indexing');
      return;
    }

    await this.bulkIndex(orgId, [document], options);
  }

  /**
   * Bulk index multiple documents to ClickHouse
   */
  async bulkIndex(
    orgId: string,
    documents: Record<string, any>[],
    options: IndexDocumentOptions,
  ): Promise<void> {
    if (!this.clickhouseClient.isClientEnabled()) {
      this.logger.debug('ClickHouse client not enabled, skipping bulk indexing');
      return;
    }

    const client = this.clickhouseClient.getClient();
    if (!client || documents.length === 0) return;

    try {
      const rows = documents.map((document) => {
        const assetKey = detectAssetKey(document, options.assetKeyField);
        return buildFindingRow(orgId, document, {
          workflowId: options.workflowId,
          workflowName: options.workflowName,
          runId: options.runId,
          nodeRef: options.nodeRef,
          componentId: options.componentId,
          assetKey,
        });
      });

      await client.insert({
        table: 'security_findings',
        values: rows,
        format: 'JSONEachRow',
      });

      this.logger.debug(
        `Bulk indexed ${documents.length} documents for workflow ${options.workflowId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to bulk index documents: ${error}`);
      throw error;
    }
  }

  /**
   * Query analytics data for an organization.
   *
   * Accepts a simplified query interface that gets translated to ClickHouse SQL.
   */
  async query(
    orgId: string,
    options: {
      filters?: { field: string; op: string; value?: any }[];
      search?: string;
      size?: number;
      from?: number;
      sort?: { field: string; direction: 'asc' | 'desc' }[];
      aggs?: { name: string; field: string; size?: number }[];
      distinct?: string;
      countDistinct?: string;
      useLatest?: boolean;
    },
  ): Promise<{
    total: number;
    results: Record<string, any>[];
    aggregations?: Record<string, { key: string; count: number }[]>;
    distinctCount?: number;
  }> {
    if (!this.clickhouseClient.isClientEnabled()) {
      this.logger.warn('ClickHouse client not enabled, returning empty results');
      return { total: 0, results: [] };
    }

    const client = this.clickhouseClient.getClient();
    if (!client) return { total: 0, results: [] };

    try {
      const table = options.useLatest ? 'security_findings_latest FINAL' : 'security_findings';

      const { conditions, params } = this.buildWhereConditions(orgId, options);
      const whereClause = conditions.join(' AND ');

      // Run aggregations if requested
      let aggregations: Record<string, { key: string; count: number }[]> | undefined;
      if (options.aggs && options.aggs.length > 0) {
        aggregations = await this.executeAggs(client, table, whereClause, params, options.aggs);
      }

      // Run COUNT(DISTINCT) if requested
      let distinctCount: number | undefined;
      if (options.countDistinct) {
        const distinctField = options.countDistinct;
        if (!FILTERABLE_COLUMNS.has(distinctField)) {
          this.logger.warn(`Ignoring unknown countDistinct field: ${distinctField}`);
        } else {
          const dcResult = await client.query({
            query: `SELECT count(DISTINCT ${distinctField}) as cnt FROM ${table} WHERE ${whereClause}`,
            query_params: params,
            format: 'JSONEachRow',
          });
          const dcRows = await dcResult.json<{ cnt: string }>();
          distinctCount = parseInt(dcRows[0]?.cnt ?? '0');
        }
      }

      const countQuery = `SELECT count() as cnt FROM ${table} WHERE ${whereClause}`;

      // If size is 0, skip data query (agg-only request)
      if (options.size === 0) {
        const countResult = await client.query({
          query: countQuery,
          query_params: params,
          format: 'JSONEachRow',
        });
        const countRows = await countResult.json<{ cnt: string }>();
        const total = parseInt(countRows[0]?.cnt ?? '0');
        return { total, results: [], aggregations, distinctCount };
      }

      const countResult = await client.query({
        query: countQuery,
        query_params: params,
        format: 'JSONEachRow',
      });
      const countRows = await countResult.json<{ cnt: string }>();
      const total = parseInt(countRows[0]?.cnt ?? '0');

      // Data query
      const size = options.size ?? 10;
      const from = options.from ?? 0;
      const orderBy = this.buildOrderBy(options.sort);

      let limitByClause = '';
      if (options.distinct) {
        if (!FILTERABLE_COLUMNS.has(options.distinct)) {
          this.logger.warn(`Ignoring unknown distinct field: ${options.distinct}`);
        } else {
          limitByClause = `LIMIT 1 BY ${options.distinct}`;
        }
      }

      const dataQuery = `SELECT * FROM ${table} WHERE ${whereClause} ORDER BY ${orderBy} ${limitByClause} LIMIT {limit:UInt32} OFFSET {offset:UInt32}`;

      const dataResult = await client.query({
        query: dataQuery,
        query_params: { ...params, limit: size, offset: from },
        format: 'JSONEachRow',
      });
      const rows = await dataResult.json<Record<string, any>>();

      const results = rows.map((row) => {
        // With native JSON type, extra is returned as an object by ClickHouse
        const { extra, ...rest } = row;
        return {
          id: row.finding_hash || '',
          ...(extra && typeof extra === 'object' ? extra : {}),
          ...rest,
        };
      });

      return { total, results, aggregations, distinctCount };
    } catch (error) {
      this.logger.error(`Failed to query analytics data: ${error}`);
      throw error;
    }
  }

  /**
   * Time-series query: returns { date, severity, count }[] buckets
   */
  async timeSeries(
    orgId: string,
    options: {
      filters?: { field: string; op: string; value?: any }[];
      interval?: 'day' | 'week' | 'month';
      days?: number;
      timezone?: string;
    },
  ): Promise<{ buckets: { date: string; severity: string; count: number }[] }> {
    if (!this.clickhouseClient.isClientEnabled()) {
      return { buckets: [] };
    }
    const client = this.clickhouseClient.getClient();
    if (!client) return { buckets: [] };

    try {
      const table = 'security_findings';
      const days = options.days ?? 30;
      const interval = options.interval ?? 'day';

      const allFilters = [
        ...(options.filters ?? []),
        {
          field: 'timestamp',
          op: 'gte',
          value: new Date(Date.now() - days * 86_400_000).toISOString(),
        },
      ];
      const { conditions, params } = this.buildWhereConditions(orgId, { filters: allFilters });
      const whereClause = conditions.join(' AND ');

      const truncFn =
        interval === 'week'
          ? 'toMonday(timestamp)'
          : interval === 'month'
            ? 'toStartOfMonth(timestamp)'
            : 'toDate(timestamp)';

      const result = await client.query({
        query: `SELECT toString(${truncFn}) as date, severity, count() as count FROM ${table} WHERE ${whereClause} GROUP BY date, severity ORDER BY date ASC`,
        query_params: params,
        format: 'JSONEachRow',
      });
      const rows = await result.json<{ date: string; severity: string; count: string }>();

      return {
        buckets: rows.map((r) => ({
          date: r.date,
          severity: r.severity,
          count: parseInt(r.count),
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to query time series: ${error}`);
      throw error;
    }
  }

  async scannerSeverityCounts(
    orgId: string,
    options: {
      filters?: { field: string; op: string; value?: any }[];
      useLatest?: boolean;
    },
  ): Promise<{ buckets: { scanner: string; severity: string; count: number }[] }> {
    if (!this.clickhouseClient.isClientEnabled()) {
      return { buckets: [] };
    }

    const client = this.clickhouseClient.getClient();
    if (!client) return { buckets: [] };

    try {
      const table = options.useLatest ? 'security_findings_latest FINAL' : 'security_findings';
      const { conditions, params } = this.buildWhereConditions(orgId, options);
      const whereClause = conditions.join(' AND ');

      const result = await client.query({
        query: `
          SELECT scanner, severity, count() as count
          FROM ${table}
          WHERE ${whereClause}
          GROUP BY scanner, severity
          ORDER BY scanner ASC, severity ASC
        `,
        query_params: params,
        format: 'JSONEachRow',
      });
      const rows = await result.json<{ scanner: string; severity: string; count: string }>();

      return {
        buckets: rows.map((row) => ({
          scanner: row.scanner,
          severity: row.severity,
          count: parseInt(row.count),
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to query scanner severity counts: ${error}`);
      throw error;
    }
  }

  /**
   * Finding lifecycle: first seen, last seen, occurrences
   */
  async lifecycle(
    orgId: string,
    hashes: string[],
  ): Promise<Record<string, { firstSeen: string; lastSeen: string; occurrences: number }>> {
    if (!this.clickhouseClient.isClientEnabled() || hashes.length === 0) return {};
    const client = this.clickhouseClient.getClient();
    if (!client) return {};

    try {
      const result = await client.query({
        query: `
          SELECT
            finding_hash,
            min(timestamp) as first_seen,
            max(timestamp) as last_seen,
            count() as occurrences
          FROM security_findings
          WHERE organization_id = {orgId:String}
            AND finding_hash IN {hashes:Array(String)}
          GROUP BY finding_hash
        `,
        query_params: { orgId: orgId.toLowerCase(), hashes },
        format: 'JSONEachRow',
      });

      const rows = await result.json<{
        finding_hash: string;
        first_seen: string;
        last_seen: string;
        occurrences: string;
      }>();

      const lifecycles: Record<
        string,
        { firstSeen: string; lastSeen: string; occurrences: number }
      > = {};
      for (const row of rows) {
        lifecycles[row.finding_hash] = {
          firstSeen: row.first_seen,
          lastSeen: row.last_seen,
          occurrences: parseInt(row.occurrences),
        };
      }
      return lifecycles;
    } catch (error) {
      this.logger.error(`Failed to query lifecycles: ${error}`);
      throw error;
    }
  }

  /**
   * Build ORDER BY clause with semantic severity ordering.
   */
  private buildOrderBy(sort?: { field: string; direction: 'asc' | 'desc' }[]): string {
    if (!sort || sort.length === 0) return 'timestamp DESC';

    return sort
      .map((s) => {
        if (!FILTERABLE_COLUMNS.has(s.field)) {
          this.logger.warn(`Ignoring unknown sort field: ${s.field}`);
          return 'timestamp DESC';
        }
        if (s.field === 'severity') {
          return severityOrderExpr(s.direction);
        }
        return `${s.field} ${s.direction}`;
      })
      .join(', ');
  }

  /**
   * Build WHERE conditions and params from filter options.
   * All field names are validated against FILTERABLE_COLUMNS to prevent SQL injection.
   */
  private buildWhereConditions(
    orgId: string,
    options: {
      filters?: { field: string; op: string; value?: any }[];
      search?: string;
    },
  ): { conditions: string[]; params: Record<string, any> } {
    const conditions = [`organization_id = {orgId:String}`];
    const params: Record<string, any> = { orgId: orgId.toLowerCase() };

    if (options.filters) {
      for (let i = 0; i < options.filters.length; i++) {
        const f = options.filters[i];
        const paramName = `f${i}`;

        // Handle resource_tags.key filters specially
        if (f.field.startsWith('resource_tags.')) {
          const tagKey = f.field.slice('resource_tags.'.length);
          const tagParamName = `tag${i}`;
          if (f.op === 'exists') {
            params[tagParamName] = tagKey;
            conditions.push(`mapContains(resource_tags, {${tagParamName}:String})`);
          } else if (f.op === 'eq') {
            params[tagParamName] = tagKey;
            params[paramName] = String(f.value);
            conditions.push(`resource_tags[{${tagParamName}:String}] = {${paramName}:String}`);
          }
          continue;
        }

        // Validate field name against allowlist
        if (!FILTERABLE_COLUMNS.has(f.field)) {
          this.logger.warn(`Ignoring unknown filter field: ${f.field}`);
          continue;
        }

        switch (f.op) {
          case 'eq':
            conditions.push(`${f.field} = {${paramName}:String}`);
            params[paramName] = String(f.value);
            break;
          case 'not_eq':
            conditions.push(`${f.field} != {${paramName}:String}`);
            params[paramName] = String(f.value);
            break;
          case 'in':
            if (ARRAY_COLUMNS.has(f.field)) {
              // Array columns: use hasAny(column, [...]) to check intersection
              conditions.push(`hasAny(${f.field}, {${paramName}:Array(String)})`);
            } else {
              conditions.push(`${f.field} IN {${paramName}:Array(String)}`);
            }
            params[paramName] = f.value;
            break;
          case 'gte':
            conditions.push(`${f.field} >= {${paramName}:String}`);
            params[paramName] = String(f.value);
            break;
          case 'lte':
            conditions.push(`${f.field} <= {${paramName}:String}`);
            params[paramName] = String(f.value);
            break;
          case 'like':
            conditions.push(`${f.field} ILIKE {${paramName}:String}`);
            params[paramName] = `%${f.value}%`;
            break;
          case 'prefix':
            conditions.push(`${f.field} ILIKE {${paramName}:String}`);
            params[paramName] = `${f.value}%`;
            break;
          case 'exists':
            if (MAP_COLUMNS.has(f.field)) {
              conditions.push(`notEmpty(${f.field})`);
            } else {
              conditions.push(`${f.field} != ''`);
            }
            break;
          case 'not_exists':
            if (MAP_COLUMNS.has(f.field)) {
              conditions.push(`empty(${f.field})`);
            } else {
              conditions.push(`(${f.field} = '' OR ${f.field} IS NULL)`);
            }
            break;
        }
      }
    }

    if (options.search) {
      params.searchTerm = `%${options.search}%`;
      conditions.push(
        `(title ILIKE {searchTerm:String} OR description ILIKE {searchTerm:String} OR rule_id ILIKE {searchTerm:String} OR asset_key ILIKE {searchTerm:String} OR check_name ILIKE {searchTerm:String} OR file ILIKE {searchTerm:String})`,
      );
    }

    return { conditions, params };
  }

  /**
   * Execute named aggregations and return { name: [{ key, count }] }
   */
  private async executeAggs(
    client: NonNullable<ReturnType<ClickHouseClientService['getClient']>>,
    table: string,
    whereClause: string,
    params: Record<string, any>,
    aggs: { name: string; field: string; size?: number }[],
  ): Promise<Record<string, { key: string; count: number }[]>> {
    const aggregations: Record<string, { key: string; count: number }[]> = {};

    await Promise.all(
      aggs.map(async (agg) => {
        // Validate aggregation field
        if (!FILTERABLE_COLUMNS.has(agg.field)) {
          this.logger.warn(`Ignoring unknown aggregation field: ${agg.field}`);
          aggregations[agg.name] = [];
          return;
        }

        const limit = agg.size ?? 50;
        // Array columns need arrayJoin to unnest elements for aggregation
        const fieldExpr = ARRAY_COLUMNS.has(agg.field) ? `arrayJoin(${agg.field})` : agg.field;
        const result = await client.query({
          query: `SELECT ${fieldExpr} as key, count() as count FROM ${table} WHERE ${whereClause} GROUP BY key ORDER BY count DESC LIMIT {aggLimit:UInt32}`,
          query_params: { ...params, aggLimit: limit },
          format: 'JSONEachRow',
        });
        const rows = await result.json<{ key: string; count: string }>();
        aggregations[agg.name] = rows.map((r) => ({
          key: String(r.key),
          count: parseInt(r.count),
        }));
      }),
    );

    return aggregations;
  }

  /**
   * Get severity counts for multiple run IDs in a single query
   */
  async batchRunSeverityCounts(
    orgId: string,
    runIds: string[],
  ): Promise<
    Record<string, { critical: number; high: number; medium: number; low: number; info: number }>
  > {
    const zeroed = () => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    const result: Record<
      string,
      { critical: number; high: number; medium: number; low: number; info: number }
    > = {};
    for (const id of runIds) {
      result[id] = zeroed();
    }

    if (!this.clickhouseClient.isClientEnabled()) return result;

    const client = this.clickhouseClient.getClient();
    if (!client) return result;

    try {
      const queryResult = await client.query({
        query: `
          SELECT run_id, severity, count() as cnt
          FROM security_findings
          WHERE organization_id = {orgId:String}
            AND run_id IN {runIds:Array(String)}
          GROUP BY run_id, severity
        `,
        query_params: { orgId: orgId.toLowerCase(), runIds },
        format: 'JSONEachRow',
      });

      const rows = await queryResult.json<{
        run_id: string;
        severity: string;
        cnt: string;
      }>();

      for (const row of rows) {
        const runId = row.run_id;
        if (!result[runId]) continue;
        const sev = row.severity.toLowerCase();
        if (sev in result[runId]) {
          (result[runId] as any)[sev] = parseInt(row.cnt);
        }
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to batch query severity counts: ${error}`);
      return result;
    }
  }

  /**
   * Get storage usage for an organization's analytics data
   */
  async getStorageUsage(orgId: string): Promise<{
    usedBytes: number;
    documentCount: number;
    partCount: number;
    analyticsEnabled: boolean;
  }> {
    if (!this.clickhouseClient.isClientEnabled()) {
      return { usedBytes: 0, documentCount: 0, partCount: 0, analyticsEnabled: false };
    }

    const client = this.clickhouseClient.getClient();
    if (!client) {
      return { usedBytes: 0, documentCount: 0, partCount: 0, analyticsEnabled: false };
    }

    try {
      const result = await client.query({
        query: `
          SELECT
            sum(bytes_on_disk) as used_bytes,
            sum(rows) as doc_count,
            count() as part_count
          FROM system.parts
          WHERE active
            AND database = currentDatabase()
            AND table IN ('security_findings', 'security_findings_latest')
            AND partition LIKE {orgPrefix:String}
        `,
        query_params: { orgPrefix: `%${orgId.toLowerCase()}%` },
        format: 'JSONEachRow',
      });

      const rows = await result.json<{
        used_bytes: string;
        doc_count: string;
        part_count: string;
      }>();

      const row = rows[0];
      return {
        usedBytes: parseInt(row?.used_bytes ?? '0'),
        documentCount: parseInt(row?.doc_count ?? '0'),
        partCount: parseInt(row?.part_count ?? '0'),
        analyticsEnabled: true,
      };
    } catch (error) {
      this.logger.error(`Failed to get storage usage: ${error}`);
      return { usedBytes: 0, documentCount: 0, partCount: 0, analyticsEnabled: true };
    }
  }

  /**
   * Delete all analytics data for an organization.
   */
  async purgeOrgData(orgId: string): Promise<{ tablesCleared: number }> {
    if (!this.clickhouseClient.isClientEnabled()) {
      return { tablesCleared: 0 };
    }

    const client = this.clickhouseClient.getClient();
    if (!client) return { tablesCleared: 0 };

    try {
      const normalizedOrgId = orgId.toLowerCase();

      // Event log: lightweight DELETE (monthly partitions span all orgs)
      await client.command({
        query: `DELETE FROM security_findings WHERE organization_id = {orgId:String}`,
        query_params: { orgId: normalizedOrgId },
      });

      // State table: instant DROP PARTITION (partitioned by organization_id)
      await client.command({
        query: `ALTER TABLE security_findings_latest DROP PARTITION {orgId:String}`,
        query_params: { orgId: normalizedOrgId },
      });

      this.logger.log(`Purged analytics data for org ${orgId}`);
      return { tablesCleared: 1 };
    } catch (error) {
      this.logger.error(`Failed to purge analytics data: ${error}`);
      throw error;
    }
  }
}

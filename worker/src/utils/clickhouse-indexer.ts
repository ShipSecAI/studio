import { createClient, ClickHouseClient } from '@clickhouse/client';
import type { IScopedTraceService } from '@shipsec/component-sdk';
import { buildFindingRow, detectAssetKey } from '@shipsec/component-sdk';

interface IndexOptions {
  workflowId: string;
  workflowName: string;
  runId: string;
  nodeRef: string;
  componentId: string;
  assetKeyField?: string;
  trace?: IScopedTraceService;
  triggerSource?: string | null;
  triggerType?: string | null;
  scanContext?: Record<string, string>;
}

/**
 * Retry helper with exponential backoff
 * Attempts: 3, delays: 1s, 2s, 4s
 */
async function retryWithBackoff<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
  const maxAttempts = 3;
  const delays = [1000, 2000, 4000];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts - 1;
      if (isLastAttempt) throw error;

      const delay = delays[attempt];
      console.warn(
        `[ClickHouseIndexer] ${operationName} failed (attempt ${attempt + 1}/${maxAttempts}), ` +
          `retrying in ${delay}ms...`,
        error,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`${operationName} failed after ${maxAttempts} attempts`);
}

// TTL for schema provisioning cache (1 hour in milliseconds)
const SCHEMA_CACHE_TTL_MS = 60 * 60 * 1000;

export class ClickHouseIndexer {
  private client: ClickHouseClient | null = null;
  private enabled = false;

  // Cache of schema check timestamp (1-hour TTL)
  private schemaProvisionedAt: number | null = null;

  constructor() {
    const url = process.env.CLICKHOUSE_URL;
    const database = process.env.CLICKHOUSE_DATABASE || 'shipsec';
    const username = process.env.CLICKHOUSE_USERNAME;
    const password = process.env.CLICKHOUSE_PASSWORD;

    if (url) {
      try {
        this.client = createClient({
          url,
          database,
          ...(username && { username }),
          ...(password && { password }),
          clickhouse_settings: {
            async_insert: 1,
            wait_for_async_insert: 1,
          },
          request_timeout: 30_000,
          keep_alive: {
            enabled: true,
          },
        });
        this.enabled = true;
        console.log(`[ClickHouseIndexer] Client initialized (url: ${url}/${database})`);
      } catch (error) {
        console.warn('[ClickHouseIndexer] Failed to initialize client:', error);
      }
    } else {
      console.debug('[ClickHouseIndexer] CLICKHOUSE_URL not configured, indexing disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  /**
   * Ensure ClickHouse schema is provisioned by checking directly via the client.
   * Queries system.tables to verify the security_findings table exists.
   * Result is cached with a 1-hour TTL.
   */
  private async ensureSchemaProvisioned(_orgId: string): Promise<boolean> {
    // Check cache
    if (this.schemaProvisionedAt && Date.now() - this.schemaProvisionedAt < SCHEMA_CACHE_TTL_MS) {
      return true;
    }

    if (!this.client) return false;

    try {
      const result = await this.client.query({
        query: `SELECT count() AS cnt FROM system.tables WHERE database = currentDatabase() AND name = 'security_findings'`,
        format: 'JSONEachRow',
      });
      const rows = await result.json<{ cnt: string }>();
      const exists = Number(rows[0]?.cnt ?? 0) > 0;

      if (exists) {
        this.schemaProvisionedAt = Date.now();
        console.debug('[ClickHouseIndexer] Schema verified');
      } else {
        console.warn(
          '[ClickHouseIndexer] security_findings table not found — schema may not be initialized',
        );
      }

      return exists;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ClickHouseIndexer] Error checking schema: ${message}`);
      return false;
    }
  }

  async indexDocument(
    orgId: string,
    document: Record<string, any>,
    options: IndexOptions,
  ): Promise<string> {
    if (!this.isEnabled() || !this.client) {
      console.debug('[ClickHouseIndexer] Indexing skipped, client not enabled');
      throw new Error('ClickHouse client not enabled');
    }

    // Ensure schema exists before indexing
    await this.ensureSchemaProvisioned(orgId);

    const assetKey = detectAssetKey(document, options.assetKeyField);
    const rawTs = document['@timestamp'] || new Date().toISOString();
    const doc = { ...document, '@timestamp': rawTs };

    const row = buildFindingRow(orgId, doc, {
      workflowId: options.workflowId,
      workflowName: options.workflowName,
      runId: options.runId,
      nodeRef: options.nodeRef,
      componentId: options.componentId,
      assetKey,
      triggerSource: options.triggerSource ?? undefined,
      triggerType: options.triggerType ?? undefined,
      scanContext: options.scanContext,
    });

    try {
      await retryWithBackoff(async () => {
        await this.client!.insert({
          table: 'security_findings',
          values: [row],
          format: 'JSONEachRow',
        });
      }, 'Index document');

      console.debug('[ClickHouseIndexer] Indexed 1 document');

      if (options.trace) {
        options.trace.record({
          type: 'NODE_PROGRESS',
          level: 'info',
          message: 'Successfully indexed 1 document to ClickHouse',
          data: { documentCount: 1, assetKey: assetKey ?? undefined },
        });
      }

      return 'security_findings';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ClickHouseIndexer] Failed to index document after retries:', error);

      if (options.trace) {
        options.trace.record({
          type: 'NODE_PROGRESS',
          level: 'error',
          message: 'Failed to index document to ClickHouse',
          error: errorMessage,
          data: { documentCount: 1 },
        });
      }

      throw error;
    }
  }

  async bulkIndex(
    orgId: string,
    documents: Record<string, any>[],
    options: IndexOptions,
  ): Promise<{ indexName: string; documentCount: number }> {
    if (!this.isEnabled() || !this.client) {
      console.debug('[ClickHouseIndexer] Bulk indexing skipped, client not enabled');
      throw new Error('ClickHouse client not enabled');
    }

    if (documents.length === 0) {
      return { indexName: '', documentCount: 0 };
    }

    // Ensure schema exists before indexing
    await this.ensureSchemaProvisioned(orgId);

    const rows = documents.map((document) => {
      const assetKey = detectAssetKey(document, options.assetKeyField);
      const row = buildFindingRow(orgId, document, {
        workflowId: options.workflowId,
        workflowName: options.workflowName,
        runId: options.runId,
        nodeRef: options.nodeRef,
        componentId: options.componentId,
        assetKey,
        triggerSource: options.triggerSource ?? undefined,
        triggerType: options.triggerType ?? undefined,
        scanContext: options.scanContext,
      });
      return row;
    });

    try {
      await retryWithBackoff(async () => {
        await this.client!.insert({
          table: 'security_findings',
          values: rows,
          format: 'JSONEachRow',
        });
      }, `Bulk index ${documents.length} documents`);

      console.debug(`[ClickHouseIndexer] Bulk indexed ${documents.length} documents`);

      if (options.trace) {
        options.trace.record({
          type: 'NODE_PROGRESS',
          level: 'info',
          message: `Successfully bulk indexed ${documents.length} documents to ClickHouse`,
          data: { indexName: 'security_findings', documentCount: documents.length },
        });
      }

      return { indexName: 'security_findings', documentCount: documents.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[ClickHouseIndexer] Failed to bulk index after retries:', error);

      if (options.trace) {
        options.trace.record({
          type: 'NODE_PROGRESS',
          level: 'error',
          message: `Failed to bulk index ${documents.length} documents to ClickHouse`,
          error: errorMessage,
          data: { indexName: 'security_findings', documentCount: documents.length },
        });
      }

      throw error;
    }
  }
}

// Singleton instance
let indexerInstance: ClickHouseIndexer | null = null;

export function getClickHouseIndexer(): ClickHouseIndexer {
  if (!indexerInstance) {
    indexerInstance = new ClickHouseIndexer();
  }
  return indexerInstance;
}

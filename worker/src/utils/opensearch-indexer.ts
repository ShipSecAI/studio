import { Client } from '@opensearch-project/opensearch';
import type { IScopedTraceService } from '@shipsec/component-sdk';

interface IndexOptions {
  workflowId: string;
  workflowName: string;
  runId: string;
  nodeRef: string;
  componentId: string;
  assetKeyField?: string;
  indexSuffix?: string;
  trace?: IScopedTraceService;
}

/**
 * Retry helper with exponential backoff
 * Attempts: 3, delays: 1s, 2s, 4s
 */
async function retryWithBackoff<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
  const maxAttempts = 3;
  const delays = [1000, 2000, 4000]; // milliseconds

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts - 1;

      if (isLastAttempt) {
        throw error; // Re-throw on last attempt
      }

      const delay = delays[attempt];
      console.warn(
        `[OpenSearchIndexer] ${operationName} failed (attempt ${attempt + 1}/${maxAttempts}), ` +
          `retrying in ${delay}ms...`,
        error,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // This should never be reached, but TypeScript requires it
  throw new Error(`${operationName} failed after ${maxAttempts} attempts`);
}

export class OpenSearchIndexer {
  private client: Client | null = null;
  private enabled = false;

  constructor() {
    const url = process.env.OPENSEARCH_URL;
    const username = process.env.OPENSEARCH_USERNAME;
    const password = process.env.OPENSEARCH_PASSWORD;

    if (url) {
      try {
        this.client = new Client({
          node: url,
          ...(username &&
            password && {
              auth: {
                username,
                password,
              },
            }),
          ssl: {
            rejectUnauthorized: process.env.NODE_ENV === 'production',
          },
        });
        this.enabled = true;
        console.log('[OpenSearchIndexer] Client initialized');
      } catch (error) {
        console.warn('[OpenSearchIndexer] Failed to initialize client:', error);
      }
    } else {
      console.debug('[OpenSearchIndexer] OpenSearch URL not configured, indexing disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  /**
   * Serialize nested objects and arrays to JSON strings to prevent field explosion.
   * Preserves primitive values (string, number, boolean, null) as-is.
   */
  private serializeNestedFields(document: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(document)) {
      if (value === null || value === undefined) {
        result[key] = value;
      } else if (typeof value === 'object') {
        // Serialize objects and arrays to JSON strings
        result[key] = JSON.stringify(value);
      } else {
        // Preserve primitives (string, number, boolean)
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Build the enriched document structure with _shipsec context.
   * - Component data fields at root level (nested objects serialized)
   * - Workflow context under _shipsec namespace (prevents field collision)
   */
  private buildEnrichedDocument(
    document: Record<string, any>,
    options: IndexOptions,
    orgId: string,
    timestamp: string,
    assetKey: string | null,
  ): Record<string, any> {
    // Serialize nested objects in the document to prevent field explosion
    const serializedDocument = this.serializeNestedFields(document);

    return {
      // Component data at root level (serialized)
      ...serializedDocument,

      // Workflow context under shipsec namespace (no underscore prefix for UI visibility)
      shipsec: {
        organization_id: orgId,
        run_id: options.runId,
        workflow_id: options.workflowId,
        workflow_name: options.workflowName,
        component_id: options.componentId,
        node_ref: options.nodeRef,
        ...(assetKey && { asset_key: assetKey }),
      },

      // Standard timestamp
      '@timestamp': timestamp,
    };
  }

  async indexDocument(
    orgId: string,
    document: Record<string, any>,
    options: IndexOptions,
  ): Promise<string> {
    if (!this.isEnabled() || !this.client) {
      console.debug('[OpenSearchIndexer] Indexing skipped, client not enabled');
      throw new Error('OpenSearch client not enabled');
    }

    const indexName = this.buildIndexName(orgId, options.indexSuffix);
    const assetKey = this.detectAssetKey(document, options.assetKeyField);
    const timestamp = new Date().toISOString();

    const enrichedDocument = this.buildEnrichedDocument(
      document,
      options,
      orgId,
      timestamp,
      assetKey,
    );

    try {
      await retryWithBackoff(async () => {
        await this.client!.index({
          index: indexName,
          body: enrichedDocument,
        });
      }, `Index document to ${indexName}`);

      console.debug(`[OpenSearchIndexer] Indexed document to ${indexName}`);

      // Log successful indexing to trace
      if (options.trace) {
        options.trace.record({
          type: 'NODE_PROGRESS',
          level: 'info',
          message: `Successfully indexed 1 document to ${indexName}`,
          data: {
            indexName,
            documentCount: 1,
            assetKey: assetKey ?? undefined,
          },
        });
      }

      return indexName;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[OpenSearchIndexer] Failed to index document after retries:`, error);

      // Log indexing error to trace
      if (options.trace) {
        options.trace.record({
          type: 'NODE_PROGRESS',
          level: 'error',
          message: `Failed to index document to ${indexName}`,
          error: errorMessage,
          data: {
            indexName,
            documentCount: 1,
          },
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
      console.debug('[OpenSearchIndexer] Bulk indexing skipped, client not enabled');
      throw new Error('OpenSearch client not enabled');
    }

    if (documents.length === 0) {
      console.debug('[OpenSearchIndexer] No documents to index');
      return { indexName: '', documentCount: 0 };
    }

    const indexName = this.buildIndexName(orgId, options.indexSuffix);

    // Use same timestamp for all documents in this batch
    // (they all came from the same component execution)
    const timestamp = new Date().toISOString();

    // Build bulk operations array
    const bulkOps: any[] = [];
    for (const document of documents) {
      const assetKey = this.detectAssetKey(document, options.assetKeyField);

      const enrichedDocument = this.buildEnrichedDocument(
        document,
        options,
        orgId,
        timestamp,
        assetKey,
      );

      bulkOps.push({ index: { _index: indexName } });
      bulkOps.push(enrichedDocument);
    }

    try {
      const response = await retryWithBackoff(async () => {
        return await this.client!.bulk({
          body: bulkOps,
        });
      }, `Bulk index ${documents.length} documents to ${indexName}`);

      if (response.body.errors) {
        const failedItems = response.body.items.filter((item: any) => item.index?.error);
        const errorCount = failedItems.length;

        // Log first 3 error details for debugging
        const errorSamples = failedItems.slice(0, 3).map((item: any) => ({
          type: item.index?.error?.type,
          reason: item.index?.error?.reason,
        }));

        console.warn(
          `[OpenSearchIndexer] Bulk indexing completed with ${errorCount} errors out of ${documents.length} documents`,
        );
        console.warn(`[OpenSearchIndexer] Error samples:`, JSON.stringify(errorSamples, null, 2));

        // Log partial failure to trace
        if (options.trace) {
          options.trace.record({
            type: 'NODE_PROGRESS',
            level: 'warn',
            message: `Bulk indexed with ${errorCount} errors out of ${documents.length} documents to ${indexName}`,
            data: {
              indexName,
              documentCount: documents.length,
              errorCount,
              errorSamples,
            },
          });
        }
      } else {
        console.debug(
          `[OpenSearchIndexer] Bulk indexed ${documents.length} documents to ${indexName}`,
        );

        // Log successful bulk indexing to trace
        if (options.trace) {
          options.trace.record({
            type: 'NODE_PROGRESS',
            level: 'info',
            message: `Successfully bulk indexed ${documents.length} documents to ${indexName}`,
            data: {
              indexName,
              documentCount: documents.length,
            },
          });
        }
      }

      return { indexName, documentCount: documents.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[OpenSearchIndexer] Failed to bulk index after retries:`, error);

      // Log bulk indexing error to trace
      if (options.trace) {
        options.trace.record({
          type: 'NODE_PROGRESS',
          level: 'error',
          message: `Failed to bulk index ${documents.length} documents to ${indexName}`,
          error: errorMessage,
          data: {
            indexName,
            documentCount: documents.length,
          },
        });
      }

      throw error;
    }
  }

  private buildIndexName(orgId: string, indexSuffix?: string): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const suffix = indexSuffix || `${year}.${month}.${day}`;
    return `security-findings-${orgId}-${suffix}`;
  }

  private detectAssetKey(document: Record<string, any>, explicitField?: string): string | null {
    // If explicit field is provided, use it
    if (explicitField && document[explicitField]) {
      return String(document[explicitField]);
    }

    // Auto-detect from common fields
    const assetFields = [
      'asset_key',
      'host',
      'domain',
      'subdomain',
      'url',
      'ip',
      'asset',
      'target',
    ];

    for (const field of assetFields) {
      if (document[field]) {
        return String(document[field]);
      }
    }

    return null;
  }
}

// Singleton instance
let indexerInstance: OpenSearchIndexer | null = null;

export function getOpenSearchIndexer(): OpenSearchIndexer {
  if (!indexerInstance) {
    indexerInstance = new OpenSearchIndexer();
  }
  return indexerInstance;
}

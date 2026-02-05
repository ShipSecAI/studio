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

// TTL for tenant provisioning cache (1 hour in milliseconds)
const TENANT_CACHE_TTL_MS = 60 * 60 * 1000;

export class OpenSearchIndexer {
  private client: Client | null = null;
  private enabled = false;
  private dashboardsUrl: string | null = null;
  private dashboardsAuth: { username: string; password: string } | null = null;
  private securityEnabled = false;
  private backendUrl: string | null = null;
  private internalServiceToken: string | null = null;

  // Cache of provisioned org IDs with timestamp
  private provisionedOrgs: Map<string, number> = new Map();

  constructor() {
    const url = process.env.OPENSEARCH_URL;
    const username = process.env.OPENSEARCH_USERNAME;
    const password = process.env.OPENSEARCH_PASSWORD;

    // OpenSearch Dashboards URL for index pattern management
    this.dashboardsUrl = process.env.OPENSEARCH_DASHBOARDS_URL || null;
    if (username && password) {
      this.dashboardsAuth = { username, password };
    }

    // Security mode configuration
    this.securityEnabled = process.env.OPENSEARCH_SECURITY_ENABLED === 'true';
    this.backendUrl = process.env.BACKEND_URL || 'http://localhost:3211';
    this.internalServiceToken = process.env.INTERNAL_SERVICE_TOKEN || null;

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
        console.log(
          `[OpenSearchIndexer] Client initialized (security enabled: ${this.securityEnabled})`,
        );
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
   * Ensure tenant is provisioned in OpenSearch Security.
   * Caches provisioned orgs with 1-hour TTL to avoid redundant calls.
   * On failure: logs error but returns true to allow indexing to continue.
   */
  private async ensureTenantProvisioned(orgId: string): Promise<boolean> {
    // Skip if security is disabled
    if (!this.securityEnabled) {
      return true;
    }

    // Check cache
    const cachedTimestamp = this.provisionedOrgs.get(orgId);
    if (cachedTimestamp && Date.now() - cachedTimestamp < TENANT_CACHE_TTL_MS) {
      console.debug(`[OpenSearchIndexer] Tenant already provisioned (cached): ${orgId}`);
      return true;
    }

    // Call backend to provision tenant
    try {
      const url = `${this.backendUrl}/api/v1/analytics/ensure-tenant`;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.internalServiceToken) {
        headers['X-Internal-Token'] = this.internalServiceToken;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ organizationId: orgId }),
      });

      if (!response.ok) {
        console.error(
          `[OpenSearchIndexer] Failed to provision tenant ${orgId}: ${response.status} ${response.statusText}`,
        );
        // Continue with indexing anyway - tenant might already exist
        return true;
      }

      const result = (await response.json()) as { success: boolean; message: string };
      if (result.success) {
        // Cache the successful provisioning
        this.provisionedOrgs.set(orgId, Date.now());
        console.log(`[OpenSearchIndexer] Tenant provisioned: ${orgId}`);
      } else {
        console.warn(`[OpenSearchIndexer] Tenant provisioning returned failure: ${result.message}`);
      }

      return true;
    } catch (error) {
      // Log error but don't block indexing
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[OpenSearchIndexer] Error provisioning tenant ${orgId}: ${message}`);
      return true; // Continue with indexing
    }
  }

  /**
   * Serialize nested objects and arrays to JSON strings to prevent field explosion.
   * Preserves primitive values (string, number, boolean, null) as-is.
   */
  private serializeNestedFields(document: Record<string, any>): Record<string, any> {
    // Pass through as-is - let OpenSearch handle dynamic mapping
    return { ...document };
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

    // Ensure tenant is provisioned before indexing (for multi-tenant security)
    await this.ensureTenantProvisioned(orgId);

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

      // Refresh index pattern in OpenSearch Dashboards to make new fields visible
      // Skip when security is enabled - patterns are created per-tenant by the provisioning service
      if (!this.securityEnabled) {
        await this.refreshIndexPattern();
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

  /**
   * Refresh the index pattern in OpenSearch Dashboards to make new fields visible.
   * Two-step process:
   * 1. Get fresh field mappings from OpenSearch via _fields_for_wildcard API
   * 2. Update the saved index pattern object with the new fields
   * Fails silently if Dashboards URL is not configured or refresh fails.
   */
  private async refreshIndexPattern(): Promise<void> {
    if (!this.dashboardsUrl) {
      console.debug(
        '[OpenSearchIndexer] Dashboards URL not configured, skipping index pattern refresh',
      );
      return;
    }

    const indexPatternId = 'security-findings-*';

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'osd-xsrf': 'true', // Required by OpenSearch Dashboards
      };

      // Add basic auth if credentials are available
      if (this.dashboardsAuth) {
        const authString = Buffer.from(
          `${this.dashboardsAuth.username}:${this.dashboardsAuth.password}`,
        ).toString('base64');
        headers['Authorization'] = `Basic ${authString}`;
      }

      // Step 1: Get fresh fields from OpenSearch via Dashboards API
      const fieldsUrl = `${this.dashboardsUrl}/api/index_patterns/_fields_for_wildcard?pattern=${encodeURIComponent(indexPatternId)}&meta_fields=_source&meta_fields=_id&meta_fields=_type&meta_fields=_index&meta_fields=_score`;
      const fieldsResponse = await fetch(fieldsUrl, { method: 'GET', headers });

      if (!fieldsResponse.ok) {
        console.warn(`[OpenSearchIndexer] Failed to get fresh fields: ${fieldsResponse.status}`);
        return;
      }

      const fieldsData = (await fieldsResponse.json()) as { fields?: unknown[] };
      const freshFields = fieldsData.fields || [];

      // Step 2: Get current index pattern to preserve other attributes
      const patternUrl = `${this.dashboardsUrl}/api/saved_objects/index-pattern/${encodeURIComponent(indexPatternId)}`;
      const patternResponse = await fetch(patternUrl, { method: 'GET', headers });

      if (!patternResponse.ok) {
        console.warn(`[OpenSearchIndexer] Index pattern not found: ${patternResponse.status}`);
        return;
      }

      const patternData = (await patternResponse.json()) as {
        attributes: { title: string; timeFieldName: string };
        version: string;
      };

      // Step 3: Update the index pattern with fresh fields
      // Include version for optimistic concurrency control (matches UI behavior)
      const updateResponse = await fetch(patternUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          attributes: {
            title: patternData.attributes.title,
            timeFieldName: patternData.attributes.timeFieldName,
            fields: JSON.stringify(freshFields),
          },
          version: patternData.version,
        }),
      });

      if (updateResponse.ok) {
        console.debug(
          `[OpenSearchIndexer] Index pattern fields refreshed (${freshFields.length} fields)`,
        );
      } else {
        console.warn(
          `[OpenSearchIndexer] Failed to update index pattern: ${updateResponse.status}`,
        );
      }
    } catch (error) {
      // Non-critical failure - log but don't throw
      console.warn('[OpenSearchIndexer] Failed to refresh index pattern:', error);
    }
  }

  private buildIndexName(orgId: string, indexSuffix?: string): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const suffix = indexSuffix || `${year}.${month}.${day}`;
    return `security-findings-${orgId}-${suffix}`.toLowerCase();
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

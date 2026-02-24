import { Injectable, Logger } from '@nestjs/common';
import { OpenSearchClient } from '../config/opensearch.client';

interface IndexDocumentOptions {
  workflowId: string;
  workflowName: string;
  runId: string;
  nodeRef: string;
  componentId: string;
  assetKeyField?: string;
  indexSuffix?: string;
}

type BulkIndexOptions = IndexDocumentOptions;

@Injectable()
export class SecurityAnalyticsService {
  private readonly logger = new Logger(SecurityAnalyticsService.name);

  constructor(private readonly openSearchClient: OpenSearchClient) {}

  /**
   * Index a single document to OpenSearch with metadata
   */
  async indexDocument(
    orgId: string,
    document: Record<string, any>,
    options: IndexDocumentOptions,
  ): Promise<void> {
    if (!this.openSearchClient.isClientEnabled()) {
      this.logger.debug('OpenSearch client not enabled, skipping indexing');
      return;
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      this.logger.warn('OpenSearch client is null, skipping indexing');
      return;
    }

    try {
      const indexName = this.buildIndexName(orgId, options.indexSuffix);
      const assetKey = this.detectAssetKey(document, options.assetKeyField);

      const enrichedDocument = {
        ...document,
        '@timestamp': new Date().toISOString(),
        workflow_id: options.workflowId,
        workflow_name: options.workflowName,
        run_id: options.runId,
        node_ref: options.nodeRef,
        component_id: options.componentId,
        ...(assetKey && { asset_key: assetKey }),
      };

      await client.index({
        index: indexName,
        body: enrichedDocument,
      });

      this.logger.debug(`Indexed document to ${indexName} for workflow ${options.workflowId}`);
    } catch (error) {
      this.logger.error(`Failed to index document: ${error}`);
      throw error;
    }
  }

  /**
   * Bulk index multiple documents to OpenSearch
   */
  async bulkIndex(
    orgId: string,
    documents: Record<string, any>[],
    options: BulkIndexOptions,
  ): Promise<void> {
    if (!this.openSearchClient.isClientEnabled()) {
      this.logger.debug('OpenSearch client not enabled, skipping bulk indexing');
      return;
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      this.logger.warn('OpenSearch client is null, skipping bulk indexing');
      return;
    }

    if (documents.length === 0) {
      this.logger.debug('No documents to index, skipping bulk indexing');
      return;
    }

    try {
      const indexName = this.buildIndexName(orgId, options.indexSuffix);

      // Build bulk operations array
      const bulkOps: any[] = [];
      for (const document of documents) {
        const assetKey = this.detectAssetKey(document, options.assetKeyField);

        const enrichedDocument = {
          ...document,
          '@timestamp': new Date().toISOString(),
          workflow_id: options.workflowId,
          workflow_name: options.workflowName,
          run_id: options.runId,
          node_ref: options.nodeRef,
          component_id: options.componentId,
          ...(assetKey && { asset_key: assetKey }),
        };

        bulkOps.push({ index: { _index: indexName } });
        bulkOps.push(enrichedDocument);
      }

      const response = await client.bulk({
        body: bulkOps,
      });

      if (response.body.errors) {
        const errorCount = response.body.items.filter((item: any) => item.index?.error).length;
        this.logger.warn(
          `Bulk indexing completed with ${errorCount} errors out of ${documents.length} documents`,
        );
      } else {
        this.logger.debug(
          `Bulk indexed ${documents.length} documents to ${indexName} for workflow ${options.workflowId}`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to bulk index documents: ${error}`);
      throw error;
    }
  }

  /**
   * Build the index name with org scoping and date-based rotation
   * Format: security-findings-{orgId}-{YYYY.MM.DD}
   */
  private buildIndexName(orgId: string, indexSuffix?: string): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const suffix = indexSuffix || `${year}.${month}.${day}`;
    return `security-findings-${orgId}-${suffix}`;
  }

  /**
   * Query analytics data for an organization
   */
  async query(
    orgId: string,
    options: {
      query?: Record<string, any>;
      size?: number;
      from?: number;
      aggs?: Record<string, any>;
      sort?: Record<string, any>[];
      collapse?: Record<string, any>;
    },
  ): Promise<{
    total: number;
    hits: { _id: string; _source: Record<string, any>; _score?: number }[];
    aggregations?: Record<string, any>;
  }> {
    if (!this.openSearchClient.isClientEnabled()) {
      this.logger.warn('OpenSearch client not enabled, returning empty results');
      return { total: 0, hits: [], aggregations: undefined };
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      this.logger.warn('OpenSearch client is null, returning empty results');
      return { total: 0, hits: [], aggregations: undefined };
    }

    try {
      // Build index pattern for org: security-findings-{orgId}-*
      const indexPattern = `security-findings-${orgId}-*`;

      // Execute the search
      const response = await client.search({
        index: indexPattern,
        body: {
          query: options.query || { match_all: {} },
          size: options.size ?? 10,
          from: options.from ?? 0,
          ...(options.aggs && { aggs: options.aggs }),
          ...(options.sort && { sort: options.sort }),
          ...(options.collapse && {
            collapse: options.collapse as { field: string; [key: string]: unknown },
          }),
        },
      });

      // Extract results from OpenSearch response
      const total: number =
        typeof response.body.hits.total === 'object'
          ? (response.body.hits.total.value ?? 0)
          : (response.body.hits.total ?? 0);

      const hits = response.body.hits.hits.map((hit: any) => ({
        _id: hit._id,
        _source: hit._source,
        ...(hit._score !== undefined && { _score: hit._score }),
      }));

      return {
        total,
        hits,
        aggregations: response.body.aggregations,
      };
    } catch (error) {
      this.logger.error(`Failed to query analytics data: ${error}`);
      throw error;
    }
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

    // Build default result with zeroed summaries for all requested runIds
    const result: Record<
      string,
      { critical: number; high: number; medium: number; low: number; info: number }
    > = {};
    for (const id of runIds) {
      result[id] = zeroed();
    }

    if (!this.openSearchClient.isClientEnabled()) {
      return result;
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      return result;
    }

    try {
      const indexPattern = `security-findings-${orgId}-*`;

      const response = await client.search({
        index: indexPattern,
        body: {
          size: 0,
          query: {
            bool: {
              filter: [{ terms: { 'shipsec.run_id.keyword': runIds } }],
            },
          },
          aggs: {
            by_run: {
              terms: { field: 'shipsec.run_id.keyword', size: 100 },
              aggs: {
                severity_counts: {
                  terms: { field: 'severity.keyword' },
                },
              },
            },
          },
        },
      });

      const aggs = response.body.aggregations as any;
      const buckets = aggs?.by_run?.buckets ?? [];
      for (const bucket of buckets) {
        const runId = bucket.key as string;
        if (!result[runId]) continue;
        const sevBuckets = bucket.severity_counts?.buckets ?? [];
        for (const sev of sevBuckets) {
          const key = (sev.key as string).toLowerCase();
          if (key in result[runId]) {
            (result[runId] as any)[key] = sev.doc_count;
          }
        }
      }

      return result;
    } catch (error) {
      this.logger.error(`Failed to batch query severity counts: ${error}`);
      return result;
    }
  }

  /**
   * Get storage usage for an organization's analytics indices
   */
  async getStorageUsage(orgId: string): Promise<{
    usedBytes: number;
    documentCount: number;
    indexCount: number;
    opensearchEnabled: boolean;
  }> {
    if (!this.openSearchClient.isClientEnabled()) {
      return { usedBytes: 0, documentCount: 0, indexCount: 0, opensearchEnabled: false };
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      return { usedBytes: 0, documentCount: 0, indexCount: 0, opensearchEnabled: false };
    }

    try {
      const indexPattern = `security-findings-${orgId}-*`;
      const response = await client.cat.indices({
        index: indexPattern as unknown as string[],
        format: 'json',
        bytes: 'b' as const,
        h: ['store.size', 'docs.count'],
      });

      const indices = (response.body ?? []) as {
        'store.size'?: string;
        'docs.count'?: string;
      }[];

      const usedBytes = indices.reduce(
        (sum, i) => sum + (parseInt(i['store.size'] ?? '0') || 0),
        0,
      );
      const documentCount = indices.reduce(
        (sum, i) => sum + (parseInt(i['docs.count'] ?? '0') || 0),
        0,
      );

      return { usedBytes, documentCount, indexCount: indices.length, opensearchEnabled: true };
    } catch (error) {
      this.logger.error(`Failed to get storage usage: ${error}`);
      return { usedBytes: 0, documentCount: 0, indexCount: 0, opensearchEnabled: true };
    }
  }

  /**
   * Delete all analytics indices for an organization
   */
  async purgeOrgData(orgId: string): Promise<{ deletedIndices: number }> {
    if (!this.openSearchClient.isClientEnabled()) {
      return { deletedIndices: 0 };
    }

    const client = this.openSearchClient.getClient();
    if (!client) {
      return { deletedIndices: 0 };
    }

    try {
      const indexPattern = `security-findings-${orgId}-*`;
      await client.indices.delete({ index: indexPattern, ignore_unavailable: true });
      this.logger.log(`Purged analytics data for org ${orgId}`);
      return { deletedIndices: 1 };
    } catch (error) {
      this.logger.error(`Failed to purge analytics data: ${error}`);
      throw error;
    }
  }

  /**
   * Auto-detect asset key from common fields
   * Priority: host > domain > subdomain > url > ip > asset > target
   */
  private detectAssetKey(document: Record<string, any>, explicitField?: string): string | null {
    // If explicit field is provided, use it
    if (explicitField && document[explicitField]) {
      return String(document[explicitField]);
    }

    if (document.asset_key) {
      return String(document.asset_key);
    }

    // Auto-detect from common fields
    const assetFields = ['host', 'domain', 'subdomain', 'url', 'ip', 'asset', 'target'];

    for (const field of assetFields) {
      if (document[field]) {
        return String(document[field]);
      }
    }

    return null;
  }
}

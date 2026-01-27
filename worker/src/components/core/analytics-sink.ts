import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  analyticsResultSchema,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
  data: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Array of analytics results with required scanner, finding_hash, and severity fields. Each array item is indexed as a separate document. Additional scanner-specific fields are preserved.',
  }),
});

const outputSchema = outputs({
  indexed: port(z.boolean(), {
    label: 'Indexed',
    description: 'Indicates whether the data was successfully indexed to OpenSearch.',
  }),
  documentCount: port(z.number(), {
    label: 'Document Count',
    description: 'Number of documents indexed (1 for objects, array length for arrays).',
  }),
  indexName: port(z.string(), {
    label: 'Index Name',
    description: 'Name of the OpenSearch index where data was stored.',
  }),
});

const parameterSchema = parameters({
  indexSuffix: param(
    z
      .string()
      .optional()
      .describe(
        'Optional suffix to append to the index name. Defaults to workflow slug if not provided.',
      ),
    {
      label: 'Index Suffix',
      editor: 'text',
      placeholder: 'workflow-slug (default)',
      description:
        'Custom suffix for the index name (e.g., "subdomain-enum"). Defaults to workflow slug if not provided.',
    },
  ),
  assetKeyField: param(
    z
      .enum([
        'auto',
        'asset_key',
        'host',
        'domain',
        'subdomain',
        'url',
        'ip',
        'asset',
        'target',
        'custom',
      ])
      .default('auto')
      .describe(
        'Field name to use as the asset_key. Auto-detect checks common fields (asset_key, host, domain, subdomain, url, ip, asset, target) in priority order.',
      ),
    {
      label: 'Asset Key Field',
      editor: 'select',
      options: [
        { label: 'Auto-detect', value: 'auto' },
        { label: 'asset_key', value: 'asset_key' },
        { label: 'host', value: 'host' },
        { label: 'domain', value: 'domain' },
        { label: 'subdomain', value: 'subdomain' },
        { label: 'url', value: 'url' },
        { label: 'ip', value: 'ip' },
        { label: 'asset', value: 'asset' },
        { label: 'target', value: 'target' },
        { label: 'Custom field name', value: 'custom' },
      ],
      description:
        'Specify which field to use as the asset identifier. Auto-detect uses priority: asset_key > host > domain > subdomain > url > ip > asset > target.',
    },
  ),
  customAssetKeyField: param(
    z
      .string()
      .optional()
      .describe('Custom field name to use as asset_key when assetKeyField is set to "custom".'),
    {
      label: 'Custom Field Name',
      editor: 'text',
      placeholder: 'e.g., hostname, endpoint, etc.',
      description: 'Enter the custom field name to use as the asset identifier.',
      visibleWhen: { assetKeyField: 'custom' },
    },
  ),
  failOnError: param(
    z
      .boolean()
      .default(false)
      .describe(
        'Whether to fail the workflow if indexing fails. Default is false (fire-and-forget).',
      ),
    {
      label: 'Fail workflow if indexing fails',
      editor: 'boolean',
      description:
        "When enabled, the workflow will stop if indexing to OpenSearch fails. By default, indexing errors are logged but don't stop the workflow.",
    },
  ),
});

const definition = defineComponent({
  id: 'core.analytics.sink',
  label: 'Analytics Sink',
  category: 'output',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Indexes structured analytics results into OpenSearch for dashboards, queries, and alerts. Requires results to follow the `core.analytics.result.v1` contract with scanner, finding_hash, and severity fields. Connect the `results` port from scanner components. Each array item becomes a separate document with workflow context stored under `shipsec.*`. Indexing is fire-and-forget by default.',
  ui: {
    slug: 'analytics-sink',
    version: '1.0.0',
    type: 'output',
    category: 'output',
    description:
      'Index security findings and workflow outputs into OpenSearch for analytics, dashboards, and alerting.',
    icon: 'BarChart3',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Index subdomain enumeration results for tracking asset discovery over time.',
      'Store vulnerability scan findings for correlation and trend analysis.',
      'Aggregate security metrics across multiple workflows into unified dashboards.',
    ],
  },
  async execute({ inputs, params }, context) {
    const { getOpenSearchIndexer } = await import('../../utils/opensearch-indexer');
    const indexer = getOpenSearchIndexer();

    const documentCount = inputs.data.length;

    // Check if indexing is enabled
    if (!indexer.isEnabled()) {
      context.logger.debug(
        '[Analytics Sink] OpenSearch not configured, skipping indexing (fire-and-forget)',
      );
      return {
        indexed: false,
        documentCount,
        indexName: '',
      };
    }

    // Validate required workflow context
    if (!context.workflowId || !context.workflowName || !context.organizationId) {
      const error = new Error(
        'Analytics Sink requires workflow context (workflowId, workflowName, organizationId)',
      );
      context.logger.error(`[Analytics Sink] ${error.message}`);
      if (params.failOnError) {
        throw error;
      }
      return {
        indexed: false,
        documentCount: 0,
        indexName: '',
      };
    }

    // Runtime validation of analytics result contract
    const validated = z.array(analyticsResultSchema()).safeParse(inputs.data);
    if (!validated.success) {
      const errorMessage = `Invalid analytics results format: ${validated.error.message}`;
      context.logger.error(`[Analytics Sink] ${errorMessage}`);
      if (params.failOnError) {
        throw new Error(errorMessage);
      }
      return {
        indexed: false,
        documentCount,
        indexName: '',
      };
    }

    try {
      // Determine the actual asset key field to use
      let assetKeyField: string | undefined;
      if (params.assetKeyField === 'auto') {
        // Auto-detect mode: let the indexer determine the asset key field
        assetKeyField = undefined;
      } else if (params.assetKeyField === 'custom') {
        // Custom mode: use the custom field name if provided
        assetKeyField = params.customAssetKeyField;
      } else {
        // Specific field selected
        assetKeyField = params.assetKeyField;
      }

      const indexOptions = {
        workflowId: context.workflowId,
        workflowName: context.workflowName,
        runId: context.runId,
        nodeRef: context.componentRef,
        componentId: 'core.analytics.sink',
        assetKeyField,
        indexSuffix: params.indexSuffix,
        trace: context.trace,
      };

      context.logger.info(`[Analytics Sink] Bulk indexing ${documentCount} documents`);
      const result = await indexer.bulkIndex(context.organizationId, validated.data, indexOptions);

      context.logger.info(
        `[Analytics Sink] Successfully indexed ${result.documentCount} document(s) to ${result.indexName}`,
      );
      return {
        indexed: true,
        documentCount: result.documentCount,
        indexName: result.indexName,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during indexing';
      context.logger.error(`[Analytics Sink] Indexing failed: ${errorMessage}`);

      if (params.failOnError) {
        throw error;
      }

      // Fire-and-forget mode: log error but don't fail workflow
      return {
        indexed: false,
        documentCount,
        indexName: '',
      };
    }
  },
});

componentRegistry.register(definition);

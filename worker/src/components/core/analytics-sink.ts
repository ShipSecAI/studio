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
  withPortMeta,
  ValidationError,
} from '@shipsec/component-sdk';

// Schema for defining a data input port
const dataInputDefinitionSchema = z.object({
  id: z.string().describe('Unique identifier for this input (becomes input port ID)'),
  label: z.string().describe('Display label for the input in the UI'),
  sourceTag: z
    .string()
    .optional()
    .describe('Tag added to indexed documents for filtering by source in dashboards'),
});

type DataInputDefinition = z.infer<typeof dataInputDefinitionSchema>;

// Base input schema with a default input port.
// resolvePorts adds extra ports when users configure multiple data inputs.
const baseInputSchema = inputs({
  input1: port(z.array(analyticsResultSchema()).optional(), {
    label: 'Input 1',
    description: 'Analytics results to index.',
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
  dataInputs: param(
    z
      .array(dataInputDefinitionSchema)
      .default([{ id: 'input1', label: 'Input 1', sourceTag: 'input_1' }])
      .describe('Define multiple data inputs from different scanner components'),
    {
      label: 'Data Inputs',
      editor: 'analytics-inputs',
      description:
        'Configure input ports for different scanner results. Each input creates a corresponding input port.',
      helpText:
        'Each input accepts AnalyticsResult[] and can be tagged for filtering in dashboards.',
    },
  ),
  indexSuffix: param(
    z
      .string()
      .optional()
      .describe(
        'Optional suffix to append to the index name. Defaults to date (YYYY.MM.DD) if not provided.',
      ),
    {
      label: 'Index Suffix',
      editor: 'text',
      placeholder: 'YYYY.MM.DD (default)',
      description:
        'Custom suffix for the index name (e.g., "subdomain-enum"). Defaults to date-based sharding (YYYY.MM.DD) if not provided.',
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
        'Strict mode: requires all configured inputs to have data and validates all documents before indexing. Default is lenient (fire-and-forget).',
      ),
    {
      label: 'Strict Mode (Fail on Error)',
      editor: 'boolean',
      description:
        'When enabled: requires ALL configured inputs to have data, validates ALL documents before indexing, and fails the workflow if any check fails. When disabled: skips missing inputs and logs errors without failing.',
    },
  ),
});

const definition = defineComponent({
  id: 'core.analytics.sink',
  label: 'Analytics Sink',
  category: 'output',
  runner: { kind: 'inline' },
  inputs: baseInputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Indexes structured analytics results into OpenSearch for dashboards, queries, and alerts. Configure multiple data inputs to aggregate results from different scanner components. Each input can be tagged with a sourceTag for filtering in dashboards. Supports lenient (fire-and-forget) and strict (all-or-nothing) modes via the failOnError parameter.',
  ui: {
    slug: 'analytics-sink',
    version: '2.0.0',
    type: 'output',
    category: 'output',
    description:
      'Index security findings from multiple scanners into OpenSearch for analytics, dashboards, and alerting.',
    icon: 'BarChart3',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Aggregate findings from Nuclei, Subfinder, and Prowler into a unified security dashboard.',
      'Index subdomain enumeration results for tracking asset discovery over time.',
      'Store vulnerability scan findings for correlation and trend analysis.',
    ],
  },
  resolvePorts(params: z.infer<typeof parameterSchema>) {
    const dataInputs = Array.isArray(params.dataInputs) ? params.dataInputs : [];

    const inputShape: Record<string, z.ZodTypeAny> = {};

    // Create dynamic input ports from dataInputs parameter
    for (const input of dataInputs) {
      const id = typeof input?.id === 'string' ? input.id.trim() : '';
      if (!id) {
        continue;
      }

      const label = typeof input?.label === 'string' ? input.label : id;
      const sourceTag = typeof input?.sourceTag === 'string' ? input.sourceTag : undefined;

      const description = sourceTag
        ? `Analytics results tagged with '${sourceTag}' in indexed documents.`
        : `Analytics results from ${label}.`;

      // Each input port accepts an optional array of analytics results
      inputShape[id] = withPortMeta(z.array(analyticsResultSchema()).optional(), {
        label,
        description,
      });
    }

    return {
      inputs: inputs(inputShape),
      outputs: outputSchema,
    };
  },
  async execute({ inputs, params }, context) {
    const { getOpenSearchIndexer } = await import('../../utils/opensearch-indexer');
    const indexer = getOpenSearchIndexer();

    const dataInputsMap = new Map<string, DataInputDefinition>(
      (params.dataInputs ?? []).map((d) => [d.id, d]),
    );

    // Check if indexing is enabled
    if (!indexer.isEnabled()) {
      context.logger.debug(
        '[Analytics Sink] OpenSearch not configured, skipping indexing (fire-and-forget)',
      );
      return {
        indexed: false,
        documentCount: 0,
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

    // STRICT MODE: Require all configured inputs to be present
    if (params.failOnError) {
      for (const inputDef of params.dataInputs ?? []) {
        const inputData = (inputs as Record<string, unknown>)[inputDef.id];
        if (!inputData || !Array.isArray(inputData) || inputData.length === 0) {
          throw new ValidationError(
            `Required input '${inputDef.label}' (${inputDef.id}) is missing or empty. ` +
              `All configured inputs must provide data when strict mode is enabled.`,
            {
              fieldErrors: { [inputDef.id]: ['This input is required but has no data'] },
            },
          );
        }
      }
    }

    // Aggregate all documents from all inputs
    const allDocuments: Record<string, unknown>[] = [];
    const inputsRecord = inputs as Record<string, unknown>;

    for (const [inputId, inputData] of Object.entries(inputsRecord)) {
      if (!inputData || !Array.isArray(inputData)) {
        if (!params.failOnError) {
          context.logger.warn(
            `[Analytics Sink] Input '${inputId}' is empty or undefined, skipping`,
          );
        }
        continue;
      }

      const inputDef = dataInputsMap.get(inputId);
      const sourceTag = inputDef?.sourceTag;

      for (const doc of inputData) {
        // STRICT MODE: Validate each document against analytics schema
        if (params.failOnError) {
          const validated = analyticsResultSchema().safeParse(doc);
          if (!validated.success) {
            throw new ValidationError(
              `Document from input '${inputDef?.label ?? inputId}' failed validation: ${validated.error.message}`,
              {
                fieldErrors: { [inputId]: [validated.error.message] },
              },
            );
          }
        }

        // Add source_input field if sourceTag is defined
        const enrichedDoc = sourceTag ? { ...doc, source_input: sourceTag } : { ...doc };
        allDocuments.push(enrichedDoc);
      }
    }

    const documentCount = allDocuments.length;

    if (documentCount === 0) {
      context.logger.info('[Analytics Sink] No documents to index from any input');
      return {
        indexed: false,
        documentCount: 0,
        indexName: '',
      };
    }

    // LENIENT MODE: Validate all documents (but don't fail, just log warnings)
    if (!params.failOnError) {
      const validated = z.array(analyticsResultSchema()).safeParse(allDocuments);
      if (!validated.success) {
        context.logger.warn(
          `[Analytics Sink] Some documents have validation issues: ${validated.error.message}`,
        );
        // Continue anyway in lenient mode
      }
    }

    try {
      // Determine the actual asset key field to use
      let assetKeyField: string | undefined;
      if (params.assetKeyField === 'auto') {
        assetKeyField = undefined;
      } else if (params.assetKeyField === 'custom') {
        assetKeyField = params.customAssetKeyField;
      } else {
        assetKeyField = params.assetKeyField;
      }

      const fallbackIndexSuffix = params.indexSuffix || undefined;

      const indexOptions = {
        workflowId: context.workflowId,
        workflowName: context.workflowName,
        runId: context.runId,
        nodeRef: context.componentRef,
        componentId: 'core.analytics.sink',
        assetKeyField,
        indexSuffix: fallbackIndexSuffix,
        trace: context.trace,
      };

      context.logger.info(
        `[Analytics Sink] Bulk indexing ${documentCount} documents from ${dataInputsMap.size} input(s)`,
      );
      const result = await indexer.bulkIndex(context.organizationId, allDocuments, indexOptions);

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

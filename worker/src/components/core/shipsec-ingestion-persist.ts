import { z } from 'zod';
import {
  ValidationError,
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { shipsecIngestionBatchSchema } from '@shipsec/contracts';
import { callAssetSyncBackend } from '../../asset-discovery/runtime';

const inputSchema = inputs({
  ingestionBatch: port(shipsecIngestionBatchSchema(), {
    label: 'ShipSec Ingestion Batch',
    description: 'North-star ingestion batch emitted by cloud, ASM, or code normalization.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
});

const parameterSchema = parameters({
  failOnError: param(z.boolean().default(true), {
    label: 'Fail on Error',
    editor: 'boolean',
    description: 'Fail the workflow when durable ingestion fails.',
  }),
});

const outputSchema = outputs({
  persisted: port(z.boolean(), {
    label: 'Persisted',
    description: 'Whether the ingestion batch was written to the product database.',
  }),
  batchId: port(z.string().optional(), {
    label: 'Batch ID',
    description: 'Persisted ingestion batch id.',
  }),
  scannerRunId: port(z.string().optional(), {
    label: 'Scanner Run ID',
    description: 'Persisted scanner run id.',
  }),
  assetCount: port(z.number().int().nonnegative(), {
    label: 'Assets',
    description: 'Number of assets persisted.',
  }),
  observationCount: port(z.number().int().nonnegative(), {
    label: 'Observations',
    description: 'Number of observations persisted.',
  }),
  findingCount: port(z.number().int().nonnegative(), {
    label: 'Findings',
    description: 'Number of finding instances persisted.',
  }),
  controlResultCount: port(z.number().int().nonnegative(), {
    label: 'Control Results',
    description: 'Number of compliance control results derived from the batch.',
  }),
  graphEdgeCount: port(z.number().int().nonnegative(), {
    label: 'Graph Edges',
    description: 'Number of product graph edges derived from the batch.',
  }),
  error: port(z.string().optional(), {
    label: 'Error',
    description: 'Error message when persistence failed in non-strict mode.',
  }),
});

interface PersistResponse {
  batchId: string;
  scannerRunId: string;
  assetCount: number;
  observationCount: number;
  findingCount: number;
  evidenceCount: number;
  controlResultCount: number;
  graphEdgeCount: number;
}

const emptyFailure = (error: string) =>
  outputSchema.parse({
    persisted: false,
    assetCount: 0,
    observationCount: 0,
    findingCount: 0,
    controlResultCount: 0,
    graphEdgeCount: 0,
    error,
  });

const definition = defineComponent({
  id: 'shipsec.ingestion.persist',
  label: 'Persist Security Ingestion',
  category: 'output',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Persist a ShipSec north-star ingestion batch into the product database for findings, compliance, and graph views.',
  ui: {
    slug: 'shipsec-ingestion-persist',
    version: '1.0.0',
    type: 'output',
    category: 'output',
    description:
      'Durably writes normalized scanner observations, findings, evidence, controls, and graph edges.',
    icon: 'DatabaseZap',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
  },
  toolProvider: {
    kind: 'component',
    name: 'security_ingestion_persist',
    description: 'Persist a normalized ShipSec ingestion batch into the product database.',
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);
    const organizationId = context.organizationId ?? context.metadata.organizationId;
    if (!organizationId) {
      throw new ValidationError('Security ingestion persistence requires organizationId context.');
    }

    try {
      const response = await callAssetSyncBackend<PersistResponse>(
        '/security-ingestion/internal/batches',
        {
          body: { batch: parsedInputs.ingestionBatch },
          organizationId,
        },
      );

      context.logger.info(
        `[SecurityIngestionPersist] batch=${response.batchId} findings=${response.findingCount} controls=${response.controlResultCount} edges=${response.graphEdgeCount}`,
      );

      return outputSchema.parse({
        persisted: true,
        batchId: response.batchId,
        scannerRunId: response.scannerRunId,
        assetCount: response.assetCount,
        observationCount: response.observationCount,
        findingCount: response.findingCount,
        controlResultCount: response.controlResultCount,
        graphEdgeCount: response.graphEdgeCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown persistence error';
      context.logger.error(`[SecurityIngestionPersist] ${message}`);
      if (parsedParams.failOnError) {
        throw error;
      }
      return emptyFailure(message);
    }
  },
});

componentRegistry.register(definition);

import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';

import { executeAssetInventorySync, truncateForLogs } from '../../asset-discovery/runtime';

const outputSchema = outputs({
  syncRunId: port(z.string().uuid(), {
    label: 'Sync Run ID',
    description: 'Asset sync run record identifier.',
  }),
  integrationId: port(z.string().uuid(), {
    label: 'Integration ID',
    description: 'AWS IAM role connection used to anchor the sync run.',
  }),
  status: port(z.enum(['success']), {
    label: 'Status',
    description: 'Component completion status.',
  }),
  assetsDiscovered: port(z.number(), {
    label: 'Assets Discovered',
    description: 'Total assets discovered during this sync.',
  }),
  assetsCreated: port(z.number(), {
    label: 'Assets Created',
    description: 'Assets newly indexed during this sync.',
  }),
  assetsUpdated: port(z.number(), {
    label: 'Assets Updated',
    description: 'Assets updated during this sync.',
  }),
  assetsStale: port(z.number(), {
    label: 'Assets Stale',
    description: 'Assets marked stale during this sync.',
  }),
  coveredRegions: port(z.array(z.string()), {
    label: 'Covered Regions',
    description: 'AWS regions included in the sync.',
  }),
  durationMs: port(z.number(), {
    label: 'Duration (ms)',
    description: 'Time spent running Cartography.',
  }),
});

const inputSchema = inputs({
  integrationId: port(z.string().uuid().optional(), {
    label: 'Integration ID',
    description:
      'Optional AWS IAM role connection ID. If omitted, the backend uses the first available AWS IAM role connection for the org.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

const parameterSchema = parameters({
  logTailLength: param(
    z.number().int().positive().default(4000).describe('Max stdout/stderr log tail length.'),
    {
      label: 'Log Tail Length',
      editor: 'number',
      description: 'How much of Cartography stdout/stderr to keep in component logs.',
    },
  ),
});

const definition = defineComponent({
  id: 'security.asset-inventory.sync',
  label: 'Asset Inventory Sync',
  category: 'security',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run the Cartography-backed cloud inventory sync and persist sync-run bookkeeping while exposing the execution as a normal ShipSec workflow run.',
  toolProvider: {
    kind: 'component',
    name: 'asset_inventory_sync',
    description: 'Sync AWS infrastructure inventory into Cartography and update cloud sync status.',
  },
  resolvePorts() {
    return {
      inputs: inputSchema,
      outputs: outputSchema,
    };
  },
  ui: {
    slug: 'asset-inventory-sync',
    version: '1.0.0',
    type: 'process',
    category: 'security',
    description: 'Run Cartography-backed AWS inventory indexing and persist cloud sync history.',
    icon: 'Database',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute(payload: any, context) {
    if (!context.organizationId) {
      throw new Error('Asset inventory sync requires organization context');
    }

    const runtimeInputs = inputSchema.parse(payload.inputs ?? {});
    const params = parameterSchema.parse(payload.params ?? {});

    const result = await executeAssetInventorySync({
      integrationId: runtimeInputs.integrationId,
      organizationId: context.organizationId,
      workflowId: context.workflowId ?? context.runId,
      workflowName: context.workflowName ?? 'Index Infra',
      runId: context.runId,
      componentRef: context.componentRef,
    });

    const logTailLength = typeof params.logTailLength === 'number' ? params.logTailLength : 4000;

    if (result.stdout.trim().length > 0) {
      context.logger.info(
        `[AssetInventorySync] stdout:\n${truncateForLogs(result.stdout, logTailLength)}`,
      );
    }
    if (result.stderr.trim().length > 0) {
      context.logger.warn(
        `[AssetInventorySync] stderr:\n${truncateForLogs(result.stderr, logTailLength)}`,
      );
    }

    return {
      syncRunId: result.syncRunId,
      integrationId: result.integrationId,
      status: result.status,
      assetsDiscovered: result.assetsDiscovered,
      assetsCreated: result.assetsCreated,
      assetsUpdated: result.assetsUpdated,
      assetsStale: result.assetsStale,
      coveredRegions: result.coveredRegions,
      durationMs: result.durationMs,
    };
  },
});

componentRegistry.register(definition);

/**
 * Cartography-backed asset sync activities.
 *
 * The worker delegates authoritative graph reads and audit materialization to the backend,
 * but owns the Cartography execution lifecycle.
 */

import '../../components';
import {
  initializeAssetSyncRuntime,
  prepareAssetSyncContext,
  refreshAssetInventoryFromGraph,
  runPreparedCartographySync,
  type PreparedAssetSyncContext,
  type SyncConnectionBinding,
  type SyncContextTarget,
  truncateForLogs,
  updateAssetSyncRunStatus,
} from '../../asset-discovery/runtime';

/**
 * Initialize asset sync activity dependencies.
 * Called once during worker startup.
 */
export function initializeAssetSyncActivities(config: {
  backendUrl: string;
  internalToken: string;
}) {
  initializeAssetSyncRuntime(config);
}

export async function prepareSyncContextActivity(input: {
  integrationId?: string;
  organizationId: string;
  temporalWorkflowId?: string;
  temporalRunId?: string;
}): Promise<PreparedAssetSyncContext> {
  return prepareAssetSyncContext(input);
}

export async function runCartographySyncActivity(input: {
  organizationId: string;
  syncRunId: string;
  integrationId: string;
  neo4jDatabase: string;
  targets: SyncContextTarget[];
  coveredRegions: string[];
}): Promise<{
  stderr: string;
  stdout: string;
  durationMs: number;
  coveredRegions: string[];
}> {
  const start = Date.now();
  console.log(
    `[CartographySync] Starting syncRunId=${input.syncRunId} targets=${input.targets.length} neo4jDatabase=${input.neo4jDatabase}`,
  );

  try {
    const result = await runPreparedCartographySync({
      organizationId: input.organizationId,
      workflowId: `asset-sync:${input.organizationId}`,
      workflowName: 'assetSyncWorkflow',
      runId: input.syncRunId,
      componentRef: 'asset-sync.cartography',
      neo4jDatabase: input.neo4jDatabase,
      targets: input.targets,
      coveredRegions: input.coveredRegions,
    });

    if (result.stdout.trim().length > 0) {
      console.log(`[CartographySync] stdout:\n${truncateForLogs(result.stdout)}`);
    }
    if (result.stderr.trim().length > 0) {
      console.warn(`[CartographySync] stderr:\n${truncateForLogs(result.stderr)}`);
    }

    return {
      stderr: result.stderr,
      stdout: result.stdout,
      durationMs: result.durationMs,
      coveredRegions: input.coveredRegions,
    };
  } finally {
    console.log(
      `[CartographySync] Finished syncRunId=${input.syncRunId} durationMs=${Date.now() - start}`,
    );
  }
}

export async function refreshInventoryFromGraphActivity(input: {
  integrationId: string;
  organizationId: string;
  syncRunId: string;
  connectionBindings: SyncConnectionBinding[];
}): Promise<{
  assetsDiscovered: number;
  assetsCreated: number;
  assetsUpdated: number;
  assetsStale: number;
  coveredRegions: string[];
}> {
  return refreshAssetInventoryFromGraph(input);
}

export async function updateSyncRunStatusActivity(input: {
  syncRunId: string;
  status: string;
  assetsDiscovered?: number;
  assetsCreated?: number;
  assetsUpdated?: number;
  assetsStale?: number;
  coveredRegions?: string[];
  errors?: { message: string; timestamp: string }[];
}): Promise<void> {
  await updateAssetSyncRunStatus(input);
}

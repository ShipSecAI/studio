import { proxyActivities, workflowInfo } from '@temporalio/workflow';

interface AssetSyncActivities {
  prepareSyncContextActivity(input: {
    integrationId?: string;
    organizationId: string;
    temporalWorkflowId?: string;
    temporalRunId?: string;
  }): Promise<{
    syncRunId: string;
    integrationId: string;
    neo4jDatabase: string;
    targets: {
      connectionId: string;
      displayName: string;
      accountIdentifier: string | null;
      region: string | null;
    }[];
    coveredRegions: string[];
    connectionBindings: {
      connectionId: string;
      accountIdentifier: string | null;
    }[];
  }>;

  runCartographySyncActivity(input: {
    organizationId: string;
    syncRunId: string;
    neo4jDatabase: string;
    targets: {
      connectionId: string;
      displayName: string;
      accountIdentifier: string | null;
      region: string | null;
    }[];
    coveredRegions: string[];
  }): Promise<{
    stderr: string;
    stdout: string;
    durationMs: number;
    coveredRegions: string[];
  }>;

  refreshInventoryFromGraphActivity(input: {
    integrationId: string;
    organizationId: string;
    syncRunId: string;
    connectionBindings: {
      connectionId: string;
      accountIdentifier: string | null;
    }[];
  }): Promise<{
    assetsDiscovered: number;
    assetsCreated: number;
    assetsUpdated: number;
    assetsStale: number;
    coveredRegions: string[];
  }>;

  updateSyncRunStatusActivity(input: {
    syncRunId: string;
    status: string;
    assetsDiscovered?: number;
    assetsCreated?: number;
    assetsUpdated?: number;
    assetsStale?: number;
    coveredRegions?: string[];
    errors?: { message: string; timestamp: string }[];
  }): Promise<void>;
}

const {
  prepareSyncContextActivity,
  refreshInventoryFromGraphActivity,
  updateSyncRunStatusActivity,
} = proxyActivities<
  Pick<
    AssetSyncActivities,
    | 'prepareSyncContextActivity'
    | 'refreshInventoryFromGraphActivity'
    | 'updateSyncRunStatusActivity'
  >
>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5s',
    maximumInterval: '30s',
  },
});

const { runCartographySyncActivity } = proxyActivities<
  Pick<AssetSyncActivities, 'runCartographySyncActivity'>
>({
  startToCloseTimeout: '60 minutes',
  retry: {
    maximumAttempts: 1,
  },
});

export interface AssetSyncWorkflowInput {
  integrationId: string;
  organizationId: string;
}

/**
 * Asset sync workflow — runs Cartography against the org graph, then refreshes
 * the Postgres audit/read model from the resulting graph snapshot.
 *
 * Workflow ID: `asset-sync-org-${organizationId}` (deterministic, single-flight per org)
 *
 * Key design decisions:
 * - Worker receives a backend-prepared org sync context with ephemeral credentials
 * - Cartography is the source of truth for current active inventory
 * - Postgres remains the audit/read model for lifecycle and sync-run history
 */
export async function assetSyncWorkflow(
  input: AssetSyncWorkflowInput,
): Promise<{ success: boolean; stats: Record<string, number> }> {
  const { integrationId, organizationId } = input;

  const syncContext = await prepareSyncContextActivity({
    integrationId,
    organizationId,
    temporalWorkflowId: workflowInfo().workflowId,
    temporalRunId: workflowInfo().runId,
  });

  try {
    const syncResult = await runCartographySyncActivity({
      organizationId,
      syncRunId: syncContext.syncRunId,
      neo4jDatabase: syncContext.neo4jDatabase,
      targets: syncContext.targets,
      coveredRegions: syncContext.coveredRegions,
    });

    const refreshResult = await refreshInventoryFromGraphActivity({
      integrationId: syncContext.integrationId,
      organizationId,
      syncRunId: syncContext.syncRunId,
      connectionBindings: syncContext.connectionBindings,
    });

    await updateSyncRunStatusActivity({
      syncRunId: syncContext.syncRunId,
      status: 'completed',
      ...refreshResult,
      coveredRegions:
        refreshResult.coveredRegions.length > 0
          ? refreshResult.coveredRegions
          : syncResult.coveredRegions,
    });

    return {
      success: true,
      stats: {
        assetsDiscovered: refreshResult.assetsDiscovered,
        assetsCreated: refreshResult.assetsCreated,
        assetsUpdated: refreshResult.assetsUpdated,
        assetsStale: refreshResult.assetsStale,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateSyncRunStatusActivity({
      syncRunId: syncContext.syncRunId,
      status: 'failed',
      errors: [{ message: errorMessage, timestamp: new Date().toISOString() }],
    });

    throw error;
  }
}

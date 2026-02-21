import { proxyActivities } from '@temporalio/workflow';

interface AssetSyncActivities {
  createSyncRunActivity(input: {
    integrationId: string;
    organizationId: string;
    temporalWorkflowId?: string;
    temporalRunId?: string;
  }): Promise<{
    syncRunId: string;
    accountIdentifier: string;
    regions: string[];
    syncStartTime: string;
  }>;

  discoverAndReconcilePageActivity(input: {
    integrationId: string;
    organizationId: string;
    accountIdentifier: string;
    regions: string[];
    cursor?: string;
    syncRunId: string;
  }): Promise<{
    createdCount: number;
    updatedCount: number;
    unchangedCount: number;
    discoveredCount: number;
    nextCursor?: string;
    coveredRegions: string[];
    scannedScopes?: { assetType: string; region: string }[];
  }>;

  persistSyncRunScopesActivity(input: {
    syncRunId: string;
    organizationId: string;
    scopes: { assetType: string; region: string }[];
  }): Promise<void>;

  markStaleAssetsActivity(input: {
    organizationId: string;
    integrationId: string;
    accountIdentifier: string;
    syncRunId: string;
    syncStartTime: string;
  }): Promise<{
    newlyStale: {
      id: string;
      assetType: string;
      externalId: string;
      name: string | null;
      provider: string;
      region: string | null;
      accountIdentifier: string | null;
    }[];
    newlyRemoved: {
      id: string;
      assetType: string;
      externalId: string;
      name: string | null;
      provider: string;
      region: string | null;
      accountIdentifier: string | null;
    }[];
    staleCount: number;
    removedCount: number;
  }>;

  emitStaleAndRemovedEventsActivity(input: {
    organizationId: string;
    integrationId: string;
    syncRunId: string;
    newlyStale: {
      id: string;
      assetType: string;
      externalId: string;
      name: string | null;
      provider: string;
      region: string | null;
      accountIdentifier: string | null;
    }[];
    newlyRemoved: {
      id: string;
      assetType: string;
      externalId: string;
      name: string | null;
      provider: string;
      region: string | null;
      accountIdentifier: string | null;
    }[];
  }): Promise<void>;

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
  createSyncRunActivity,
  discoverAndReconcilePageActivity,
  persistSyncRunScopesActivity,
  markStaleAssetsActivity,
  emitStaleAndRemovedEventsActivity,
  updateSyncRunStatusActivity,
} = proxyActivities<AssetSyncActivities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5s',
    maximumInterval: '30s',
  },
});

export interface AssetSyncWorkflowInput {
  integrationId: string;
  organizationId: string;
}

/**
 * Asset sync workflow — discovers cloud resources and reconciles with the database.
 *
 * Workflow ID: `asset-sync-${integrationId}` (deterministic, single-flight via overlap:skip)
 *
 * Key design decisions:
 * - Credentials are NEVER passed through workflow — each activity resolves them internally
 * - Page-by-page discover+reconcile to avoid giant Temporal payloads
 * - Exact-pair stale scoping with multi-connection guard
 * - Best-effort Kafka events (DB is authoritative)
 */
export async function assetSyncWorkflow(
  input: AssetSyncWorkflowInput,
): Promise<{ success: boolean; stats: Record<string, number> }> {
  const { integrationId, organizationId } = input;

  // Step 1: Create sync run record + resolve account info
  const { syncRunId, accountIdentifier, regions, syncStartTime } = await createSyncRunActivity({
    integrationId,
    organizationId,
  });

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalDiscovered = 0;
  // totalUnchanged available for future reporting
  const allCoveredRegions = new Set<string>();
  const allScannedScopes: { assetType: string; region: string }[] = [];

  try {
    // Step 2: Page-by-page discover + reconcile loop
    let cursor: string | undefined;
    do {
      const result = await discoverAndReconcilePageActivity({
        integrationId,
        organizationId,
        accountIdentifier,
        regions,
        cursor,
        syncRunId,
      });

      totalCreated += result.createdCount;
      totalUpdated += result.updatedCount;
      totalDiscovered += result.discoveredCount;
      // totalUnchanged tracked for future reporting
      for (const r of result.coveredRegions) allCoveredRegions.add(r);

      // Collect scanned scopes from the composite provider
      if (result.scannedScopes) {
        allScannedScopes.push(...result.scannedScopes);
      }

      cursor = result.nextCursor;
    } while (cursor);

    // Step 3: Persist scanned scopes BEFORE stale marking
    if (allScannedScopes.length > 0) {
      await persistSyncRunScopesActivity({
        syncRunId,
        organizationId,
        scopes: allScannedScopes,
      });
    }

    // Step 4: Mark stale assets (uses exact-pair scoping)
    const staleResult = await markStaleAssetsActivity({
      organizationId,
      integrationId,
      accountIdentifier,
      syncRunId,
      syncStartTime,
    });

    // Step 5: Emit Kafka events for stale/removed (best-effort)
    if (staleResult.newlyStale.length > 0 || staleResult.newlyRemoved.length > 0) {
      await emitStaleAndRemovedEventsActivity({
        organizationId,
        integrationId,
        syncRunId,
        newlyStale: staleResult.newlyStale,
        newlyRemoved: staleResult.newlyRemoved,
      });
    }

    // Step 6: Mark sync run as completed
    const stats = {
      assetsDiscovered: totalDiscovered,
      assetsCreated: totalCreated,
      assetsUpdated: totalUpdated,
      assetsStale: staleResult.staleCount,
    };

    await updateSyncRunStatusActivity({
      syncRunId,
      status: 'completed',
      ...stats,
      coveredRegions: Array.from(allCoveredRegions),
    });

    return { success: true, stats };
  } catch (error) {
    // On failure: mark run as failed
    const errorMessage = error instanceof Error ? error.message : String(error);
    await updateSyncRunStatusActivity({
      syncRunId,
      status: 'failed',
      errors: [{ message: errorMessage, timestamp: new Date().toISOString() }],
    });

    throw error;
  }
}

/**
 * Asset sync activities — called by the assetSyncWorkflow.
 *
 * Key design: credentials are resolved INSIDE each activity (activity-local),
 * NEVER passed through the Temporal workflow history.
 */

import { getDiscoveryEngine } from '../../discovery/discovery-engine';

let backendBaseUrl: string;
let internalToken: string;

/**
 * Initialize asset sync activity dependencies.
 * Called once during worker startup.
 */
export function initializeAssetSyncActivities(config: {
  backendUrl: string;
  internalToken: string;
}) {
  backendBaseUrl = config.backendUrl;
  internalToken = config.internalToken;
}

async function callBackend<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    organizationId?: string;
  } = {},
): Promise<T> {
  const response = await fetch(`${backendBaseUrl}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
      ...(options.organizationId ? { 'X-Organization-Id': options.organizationId } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend API error (${response.status}): ${text}`);
  }

  return response.json() as T;
}

// ── Activity 1: Create Sync Run ──────────────────────────────────────────────

export async function createSyncRunActivity(input: {
  integrationId: string;
  organizationId: string;
  temporalWorkflowId?: string;
  temporalRunId?: string;
}): Promise<{
  syncRunId: string;
  accountIdentifier: string;
  regions: string[];
  syncStartTime: string;
}> {
  // Get connection info to resolve accountIdentifier and regions
  const connInfo = await callBackend<{
    accountIdentifier: string;
    regions: string[];
  }>(`/integrations/connections/${input.integrationId}/token`, {
    organizationId: input.organizationId,
  });

  // Create the sync run record
  const run = await callBackend<{
    id: string;
    startedAt: string;
  }>('/asset-discovery/internal/sync-runs', {
    body: {
      integrationId: input.integrationId,
      accountIdentifier: connInfo.accountIdentifier,
      regions: connInfo.regions,
      temporalWorkflowId: input.temporalWorkflowId,
      temporalRunId: input.temporalRunId,
    },
    organizationId: input.organizationId,
  });

  return {
    syncRunId: run.id,
    accountIdentifier: connInfo.accountIdentifier,
    regions: connInfo.regions,
    syncStartTime: run.startedAt,
  };
}

// ── Activity 2: Discover and Reconcile Page ──────────────────────────────────

export async function discoverAndReconcilePageActivity(input: {
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
}> {
  // CRITICAL: Resolve credentials INSIDE the activity (never in workflow)
  const creds = await callBackend<{
    credentials: {
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    };
  }>(`/integrations/connections/${input.integrationId}/credentials`, {
    organizationId: input.organizationId,
  });

  // Discover a page of assets
  const engine = getDiscoveryEngine();
  const page = await engine.discover(
    'aws',
    {
      integrationId: input.integrationId,
      organizationId: input.organizationId,
      credentials: creds.credentials,
      accountIdentifier: input.accountIdentifier,
      regions: input.regions,
    },
    input.cursor,
  );

  if (page.assets.length === 0) {
    return {
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      discoveredCount: 0,
      nextCursor: page.nextCursor,
      coveredRegions: page.coveredRegions,
      scannedScopes: page.scannedScopes,
    };
  }

  // Reconcile with database (upsert + diff detection)
  const result = await callBackend<{
    created: {
      id: string;
      assetType: string;
      externalId: string;
      name: string | null;
      provider: string;
      region: string | null;
      accountIdentifier: string | null;
    }[];
    updated: {
      id: string;
      assetType: string;
      externalId: string;
      name: string | null;
      provider: string;
      region: string | null;
      accountIdentifier: string | null;
      changedFields: string[];
    }[];
    unchangedCount: number;
  }>('/asset-discovery/internal/assets/reconcile', {
    body: {
      integrationId: input.integrationId,
      accountIdentifier: input.accountIdentifier,
      syncRunId: input.syncRunId,
      assets: page.assets,
    },
    organizationId: input.organizationId,
  });

  return {
    createdCount: result.created.length,
    updatedCount: result.updated.length,
    unchangedCount: result.unchangedCount,
    discoveredCount: page.assets.length,
    nextCursor: page.nextCursor,
    coveredRegions: page.coveredRegions,
    scannedScopes: page.scannedScopes,
  };
}

// ── Activity 2b: Persist Sync Run Scopes ─────────────────────────────────────

export async function persistSyncRunScopesActivity(input: {
  syncRunId: string;
  organizationId: string;
  scopes: { assetType: string; region: string }[];
}): Promise<void> {
  await callBackend(`/asset-discovery/internal/sync-runs/${input.syncRunId}/scopes`, {
    body: { scopes: input.scopes },
    organizationId: input.organizationId,
  });
}

// ── Activity 3: Mark Stale Assets ────────────────────────────────────────────

export async function markStaleAssetsActivity(input: {
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
}> {
  const result = await callBackend<{
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
  }>('/asset-discovery/internal/assets/mark-stale', {
    body: {
      integrationId: input.integrationId,
      accountIdentifier: input.accountIdentifier,
      syncRunId: input.syncRunId,
      syncStartTime: input.syncStartTime,
    },
    organizationId: input.organizationId,
  });

  return {
    ...result,
    staleCount: result.newlyStale.length,
    removedCount: result.newlyRemoved.length,
  };
}

// ── Activity 4: Emit Stale and Removed Events ───────────────────────────────

export async function emitStaleAndRemovedEventsActivity(input: {
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
}): Promise<void> {
  // TODO Phase 5: Publish Kafka events for stale/removed assets
  console.log(
    `[AssetSync] Stale/removed events: ${input.newlyStale.length} stale, ${input.newlyRemoved.length} removed (syncRunId: ${input.syncRunId})`,
  );
}

// ── Activity 5: Update Sync Run Status ───────────────────────────────────────

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
  await callBackend(`/asset-discovery/internal/sync-runs/${input.syncRunId}/status`, {
    body: {
      status: input.status,
      assetsDiscovered: input.assetsDiscovered,
      assetsCreated: input.assetsCreated,
      assetsUpdated: input.assetsUpdated,
      assetsStale: input.assetsStale,
      coveredRegions: input.coveredRegions,
      errors: input.errors,
    },
  });
}

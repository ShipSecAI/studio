/**
 * Cartography-backed asset sync activities.
 *
 * The worker delegates authoritative graph reads and audit materialization to the backend,
 * but owns the Cartography execution lifecycle.
 */

import '../../components';
import { createExecutionContext, componentRegistry } from '@shipsec/component-sdk';
import {
  DEFAULT_AWS_REQUESTED_SYNCS,
  DEFAULT_NEO4J_DATABASE,
  runCartographyWithRunner,
} from '../../components/security/cartography-sync';

let backendBaseUrl: string;
let internalToken: string;

interface SyncContextTarget {
  connectionId: string;
  displayName: string;
  accountIdentifier: string | null;
  region: string | null;
}

interface ResolvedAwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SyncConnectionBinding {
  connectionId: string;
  accountIdentifier: string | null;
}

/**
 * Initialize asset sync activity dependencies.
 * Called once during worker startup.
 */
export function initializeAssetSyncActivities(config: {
  backendUrl: string;
  internalToken: string;
}) {
  backendBaseUrl = config.backendUrl.replace(/\/$/, '');
  if (!backendBaseUrl.endsWith('/api/v1')) {
    backendBaseUrl = `${backendBaseUrl}/api/v1`;
  }
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

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export async function prepareSyncContextActivity(input: {
  integrationId: string;
  organizationId: string;
  temporalWorkflowId?: string;
  temporalRunId?: string;
}): Promise<{
  syncRunId: string;
  neo4jDatabase: string;
  targets: SyncContextTarget[];
  coveredRegions: string[];
  connectionBindings: SyncConnectionBinding[];
}> {
  return callBackend('/asset-discovery/internal/sync-context', {
    body: input,
    organizationId: input.organizationId,
  });
}

export async function runCartographySyncActivity(input: {
  organizationId: string;
  syncRunId: string;
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
    const targetsWithCreds = await Promise.all(
      input.targets.map(async (target) => ({
        ...target,
        ...(await resolveAwsCredentials(input.organizationId, target.connectionId)),
      })),
    );
    const component = componentRegistry.get('security.cartography.sync');
    if (!component) {
      throw new Error('Cartography component is not registered');
    }
    const context = createExecutionContext({
      runId: input.syncRunId,
      componentRef: 'asset-sync.cartography',
      organizationId: input.organizationId,
      workflowId: `asset-sync:${input.organizationId}`,
      workflowName: 'assetSyncWorkflow',
    });

    const result = await runCartographyWithRunner(
      {
        selectedModules: ['aws'],
        neo4jUri: process.env.CARTOGRAPHY_NEO4J_URI?.trim() || 'bolt://neo4j:7687',
        neo4jDatabase:
          input.neo4jDatabase || process.env.NEO4J_DATABASE?.trim() || DEFAULT_NEO4J_DATABASE,
        awsProfiles: targetsWithCreds.map((target, index) => ({
          profileName: buildProfileName(target.connectionId, index),
          region: target.region?.trim() || input.coveredRegions[0] || 'us-east-1',
          accessKeyId: target.accessKeyId,
          secretAccessKey: target.secretAccessKey,
          sessionToken: target.sessionToken,
        })),
        awsRegions: input.coveredRegions,
        awsRequestedSyncs:
          process.env.CARTOGRAPHY_AWS_REQUESTED_SYNCS?.trim() || DEFAULT_AWS_REQUESTED_SYNCS,
        awsBestEffort: true,
        image: process.env.CARTOGRAPHY_IMAGE?.trim(),
      },
      context,
    );

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
  return callBackend('/asset-discovery/internal/assets/refresh-from-graph', {
    body: input,
    organizationId: input.organizationId,
  });
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

async function resolveAwsCredentials(
  organizationId: string,
  connectionId: string,
): Promise<ResolvedAwsCredentials> {
  const payload = await callBackend<{
    data?: {
      accessKeyId?: string;
      secretAccessKey?: string;
      sessionToken?: string;
    };
  }>(`/integrations/connections/${connectionId}/credentials`, {
    organizationId,
  });

  const accessKeyId = payload.data?.accessKeyId;
  const secretAccessKey = payload.data?.secretAccessKey;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(`Resolved credentials missing access keys for connection ${connectionId}`);
  }

  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: payload.data?.sessionToken,
  };
}

function buildProfileName(connectionId: string, index: number): string {
  const normalized = connectionId.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 32);
  return normalized.length > 0 ? normalized : `profile_${index + 1}`;
}

function truncateForLogs(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

import {
  DEFAULT_AWS_REQUESTED_SYNCS,
  DEFAULT_NEO4J_DATABASE,
  runCartographyWithRunner,
} from '../components/security/cartography-sync';
import { createExecutionContext } from '@shipsec/component-sdk';

let backendBaseUrl: string;
let internalToken: string;

export interface SyncContextTarget {
  connectionId: string;
  displayName: string;
  accountIdentifier: string | null;
  region: string | null;
}

export interface ResolvedAwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface SyncConnectionBinding {
  connectionId: string;
  accountIdentifier: string | null;
}

export interface PreparedAssetSyncContext {
  syncRunId: string;
  integrationId: string;
  neo4jDatabase: string;
  targets: SyncContextTarget[];
  coveredRegions: string[];
  connectionBindings: SyncConnectionBinding[];
}

export function initializeAssetSyncRuntime(config: { backendUrl: string; internalToken: string }) {
  backendBaseUrl = config.backendUrl.replace(/\/$/, '');
  if (!backendBaseUrl.endsWith('/api/v1')) {
    backendBaseUrl = `${backendBaseUrl}/api/v1`;
  }
  internalToken = config.internalToken;
}

export async function callAssetSyncBackend<T>(
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

export async function prepareAssetSyncContext(input: {
  integrationId?: string;
  organizationId: string;
  temporalWorkflowId?: string;
  temporalRunId?: string;
}): Promise<PreparedAssetSyncContext> {
  return callAssetSyncBackend('/asset-discovery/internal/sync-context', {
    body: input,
    organizationId: input.organizationId,
  });
}

export async function refreshAssetInventoryFromGraph(input: {
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
  return callAssetSyncBackend('/asset-discovery/internal/assets/refresh-from-graph', {
    body: input,
    organizationId: input.organizationId,
  });
}

export async function updateAssetSyncRunStatus(input: {
  syncRunId: string;
  status: string;
  assetsDiscovered?: number;
  assetsCreated?: number;
  assetsUpdated?: number;
  assetsStale?: number;
  coveredRegions?: string[];
  errors?: { message: string; timestamp: string }[];
}): Promise<void> {
  await callAssetSyncBackend(`/asset-discovery/internal/sync-runs/${input.syncRunId}/status`, {
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

export async function resolveAwsCredentials(
  organizationId: string,
  connectionId: string,
): Promise<ResolvedAwsCredentials> {
  const payload = await callAssetSyncBackend<{
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

export function buildProfileName(connectionId: string, index: number): string {
  const normalized = connectionId.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 32);
  return normalized.length > 0 ? normalized : `profile_${index + 1}`;
}

export function truncateForLogs(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

export async function runPreparedCartographySync(input: {
  organizationId: string;
  workflowId: string;
  workflowName: string;
  runId: string;
  componentRef: string;
  neo4jDatabase: string;
  targets: SyncContextTarget[];
  coveredRegions: string[];
}): Promise<{
  stdout: string;
  stderr: string;
  durationMs: number;
}> {
  const targetsWithCreds = await Promise.all(
    input.targets.map(async (target) => ({
      ...target,
      ...(await resolveAwsCredentials(input.organizationId, target.connectionId)),
    })),
  );

  const context = createExecutionContext({
    runId: input.runId,
    componentRef: input.componentRef,
    organizationId: input.organizationId,
    workflowId: input.workflowId,
    workflowName: input.workflowName,
  });

  return runCartographyWithRunner(
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
}

export async function executeAssetInventorySync(input: {
  integrationId?: string;
  organizationId: string;
  workflowId: string;
  workflowName: string;
  runId: string;
  componentRef: string;
}): Promise<{
  syncRunId: string;
  integrationId: string;
  status: 'success';
  assetsDiscovered: number;
  assetsCreated: number;
  assetsUpdated: number;
  assetsStale: number;
  coveredRegions: string[];
  stdout: string;
  stderr: string;
  durationMs: number;
}> {
  const prepared = await prepareAssetSyncContext({
    integrationId: input.integrationId,
    organizationId: input.organizationId,
    temporalWorkflowId: input.workflowId,
    temporalRunId: input.runId,
  });

  try {
    const cartographyResult = await runPreparedCartographySync({
      organizationId: input.organizationId,
      workflowId: input.workflowId,
      workflowName: input.workflowName,
      runId: input.runId,
      componentRef: input.componentRef,
      neo4jDatabase: prepared.neo4jDatabase,
      targets: prepared.targets,
      coveredRegions: prepared.coveredRegions,
    });

    const inventory = await refreshAssetInventoryFromGraph({
      integrationId: prepared.integrationId,
      organizationId: input.organizationId,
      syncRunId: prepared.syncRunId,
      connectionBindings: prepared.connectionBindings,
    });

    await updateAssetSyncRunStatus({
      syncRunId: prepared.syncRunId,
      status: 'completed',
      assetsDiscovered: inventory.assetsDiscovered,
      assetsCreated: inventory.assetsCreated,
      assetsUpdated: inventory.assetsUpdated,
      assetsStale: inventory.assetsStale,
      coveredRegions: inventory.coveredRegions,
    });

    return {
      syncRunId: prepared.syncRunId,
      integrationId: prepared.integrationId,
      status: 'success',
      assetsDiscovered: inventory.assetsDiscovered,
      assetsCreated: inventory.assetsCreated,
      assetsUpdated: inventory.assetsUpdated,
      assetsStale: inventory.assetsStale,
      coveredRegions: inventory.coveredRegions,
      stdout: cartographyResult.stdout,
      stderr: cartographyResult.stderr,
      durationMs: cartographyResult.durationMs,
    };
  } catch (error) {
    await updateAssetSyncRunStatus({
      syncRunId: prepared.syncRunId,
      status: 'failed',
      errors: [
        {
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        },
      ],
    }).catch(() => undefined);
    throw error;
  }
}

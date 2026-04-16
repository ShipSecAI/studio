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

export interface ResolvedGcpCredentials {
  targetServiceAccountEmail: string;
  defaultProjectId?: string;
  organizationId?: string;
  clientEmail?: string;
}

type ResolvedConnectionCredentials =
  | {
      provider: 'aws';
      credentialType: 'iam_role';
      accountId?: string | null;
      region?: string | null;
      data: {
        accessKeyId?: string;
        secretAccessKey?: string;
        sessionToken?: string;
        region?: string;
      };
    }
  | {
      provider: 'gcp';
      credentialType: 'service_account';
      accountId?: string | null;
      region?: string | null;
      data: {
        targetServiceAccountEmail?: string;
        defaultProjectId?: string;
        organizationId?: string;
        clientEmail?: string;
      };
    };

function isResolvedGcpCredentials(
  value: ResolvedConnectionCredentials,
): value is Extract<ResolvedConnectionCredentials, { provider: 'gcp' }> {
  return value.provider === 'gcp';
}

function isResolvedAwsCredentials(
  value: ResolvedConnectionCredentials,
): value is Extract<ResolvedConnectionCredentials, { provider: 'aws' }> {
  return value.provider === 'aws';
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

export async function resolveConnectionCredentials(
  organizationId: string,
  connectionId: string,
): Promise<ResolvedConnectionCredentials> {
  const payload = await callAssetSyncBackend<{
    provider?: string;
    credentialType?: string;
    accountId?: string | null;
    region?: string | null;
    data?: {
      accessKeyId?: string;
      secretAccessKey?: string;
      sessionToken?: string;
      region?: string;
      targetServiceAccountEmail?: string;
      defaultProjectId?: string;
      organizationId?: string;
      clientEmail?: string;
    };
  }>(`/integrations/connections/${connectionId}/credentials`, {
    organizationId,
  });

  if (payload.provider === 'aws' && payload.credentialType === 'iam_role') {
    const accessKeyId = payload.data?.accessKeyId;
    const secretAccessKey = payload.data?.secretAccessKey;
    if (!accessKeyId || !secretAccessKey) {
      throw new Error(`Resolved credentials missing access keys for connection ${connectionId}`);
    }

    return {
      provider: 'aws',
      credentialType: 'iam_role',
      accountId: payload.accountId,
      region: payload.region,
      data: {
        accessKeyId,
        secretAccessKey,
        sessionToken: payload.data?.sessionToken,
        region: payload.data?.region,
      },
    };
  }

  if (payload.provider === 'gcp' && payload.credentialType === 'service_account') {
    const targetServiceAccountEmail = payload.data?.targetServiceAccountEmail;
    if (!targetServiceAccountEmail) {
      throw new Error(
        `Resolved credentials missing target service-account email for connection ${connectionId}`,
      );
    }

    return {
      provider: 'gcp',
      credentialType: 'service_account',
      accountId: payload.accountId,
      region: payload.region,
      data: {
        targetServiceAccountEmail,
        defaultProjectId: payload.data?.defaultProjectId,
        organizationId: payload.data?.organizationId,
        clientEmail: payload.data?.clientEmail,
      },
    };
  }

  throw new Error(
    `Unsupported resolved credential type for connection ${connectionId}: ${payload.provider ?? 'unknown'}/${payload.credentialType ?? 'unknown'}`,
  );
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
      resolvedCredentials: await resolveConnectionCredentials(
        input.organizationId,
        target.connectionId,
      ),
    })),
  );

  const providers = new Set(targetsWithCreds.map((target) => target.resolvedCredentials.provider));
  if (providers.size > 1) {
    throw new Error('Mixed-provider Cartography sync is not supported in a single worker run');
  }

  const context = createExecutionContext({
    runId: input.runId,
    componentRef: input.componentRef,
    organizationId: input.organizationId,
    workflowId: input.workflowId,
    workflowName: input.workflowName,
  });

  const [provider] = providers;
  if (provider === 'gcp') {
    if (targetsWithCreds.length !== 1) {
      throw new Error(
        `GCP Cartography sync requires exactly one target per run (received ${targetsWithCreds.length})`,
      );
    }

    const [{ resolvedCredentials }] = targetsWithCreds;
    if (!isResolvedGcpCredentials(resolvedCredentials)) {
      throw new Error('Expected resolved GCP credentials for GCP Cartography sync');
    }
    if (!resolvedCredentials.data.targetServiceAccountEmail) {
      throw new Error('Expected targetServiceAccountEmail for GCP Cartography sync');
    }

    return runCartographyWithRunner(
      {
        selectedModules: ['gcp'],
        neo4jUri: process.env.CARTOGRAPHY_NEO4J_URI?.trim() || 'bolt://neo4j:7687',
        neo4jDatabase:
          input.neo4jDatabase || process.env.NEO4J_DATABASE?.trim() || DEFAULT_NEO4J_DATABASE,
        gcpCredential: {
          targetServiceAccountEmail: resolvedCredentials.data.targetServiceAccountEmail,
          defaultProjectId: resolvedCredentials.data.defaultProjectId,
          organizationId: resolvedCredentials.data.organizationId,
          clientEmail: resolvedCredentials.data.clientEmail,
        },
        image: process.env.CARTOGRAPHY_IMAGE?.trim(),
      },
      context,
    );
  }

  const awsTargets = targetsWithCreds.map((target) => {
    if (!isResolvedAwsCredentials(target.resolvedCredentials)) {
      throw new Error('Expected resolved AWS credentials for AWS Cartography sync');
    }

    return {
      ...target,
      resolvedCredentials: target.resolvedCredentials,
    };
  });

  return runCartographyWithRunner(
    {
      selectedModules: ['aws'],
      neo4jUri: process.env.CARTOGRAPHY_NEO4J_URI?.trim() || 'bolt://neo4j:7687',
      neo4jDatabase:
        input.neo4jDatabase || process.env.NEO4J_DATABASE?.trim() || DEFAULT_NEO4J_DATABASE,
      awsProfiles: awsTargets.map((target, index) => ({
        profileName: buildProfileName(target.connectionId, index),
        region: target.region?.trim() || input.coveredRegions[0] || 'us-east-1',
        accessKeyId: target.resolvedCredentials.data.accessKeyId!,
        secretAccessKey: target.resolvedCredentials.data.secretAccessKey!,
        sessionToken: target.resolvedCredentials.data.sessionToken,
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

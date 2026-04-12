/**
 * Cartography-backed asset sync activities.
 *
 * The worker delegates authoritative graph reads and audit materialization to the backend,
 * but owns the Cartography execution lifecycle.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

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
  const tempDir = await mkdtemp(join(tmpdir(), 'shipsec-cartography-'));
  const awsDir = join(tempDir, '.aws');
  console.log(
    `[CartographySync] Starting syncRunId=${input.syncRunId} targets=${input.targets.length} neo4jDatabase=${input.neo4jDatabase}`,
  );

  try {
    await mkdir(awsDir, { recursive: true });
    const targetsWithCreds = await Promise.all(
      input.targets.map(async (target) => ({
        ...target,
        ...(await resolveAwsCredentials(input.organizationId, target.connectionId)),
      })),
    );
    await writeAwsProfiles(awsDir, targetsWithCreds);

    const image =
      process.env.CARTOGRAPHY_IMAGE?.trim() || 'ghcr.io/cartography-cncf/cartography:0.96.1';
    const neo4jUri = process.env.CARTOGRAPHY_NEO4J_URI?.trim() || 'bolt://neo4j:7687';
    const dockerNetwork = process.env.CARTOGRAPHY_DOCKER_NETWORK?.trim() || 'shipsec-network';
    const requestedSyncs =
      process.env.CARTOGRAPHY_AWS_REQUESTED_SYNCS?.trim() ||
      'iam,s3,ecr,secretsmanager,kms,sqs,dynamodb,ecs,ec2:instance,ec2:security_group,ec2:subnet,ec2:network_acls,ec2:vpc';

    const args = [
      'run',
      '--rm',
      '--network',
      dockerNetwork,
      '--platform',
      'linux/amd64',
      '-e',
      'HOME=/var/cartography',
      '-e',
      'AWS_CONFIG_FILE=/var/cartography/.aws/config',
      '-e',
      'AWS_SHARED_CREDENTIALS_FILE=/var/cartography/.aws/credentials',
      '-e',
      'AWS_STS_REGIONAL_ENDPOINTS=regional',
      '-e',
      `AWS_DEFAULT_REGION=${input.coveredRegions[0] || 'us-east-1'}`,
      '-e',
      `AWS_REGION=${input.coveredRegions[0] || 'us-east-1'}`,
      '-v',
      `${awsDir}:/var/cartography/.aws:ro`,
      image,
      '--neo4j-uri',
      neo4jUri,
      '--neo4j-database',
      input.neo4jDatabase,
      '--selected-modules',
      'aws',
      '--aws-requested-syncs',
      requestedSyncs,
      '--aws-best-effort-mode',
    ];

    const { code, stdout, stderr } = await runCommand('docker', args);
    if (code !== 0) {
      throw new Error(stderr || stdout || `Cartography exited with code ${code}`);
    }

    if (stdout.trim().length > 0) {
      console.log(`[CartographySync] stdout:\n${truncateForLogs(stdout)}`);
    }
    if (stderr.trim().length > 0) {
      console.warn(`[CartographySync] stderr:\n${truncateForLogs(stderr)}`);
    }

    return {
      stderr,
      stdout,
      durationMs: Date.now() - start,
      coveredRegions: input.coveredRegions,
    };
  } finally {
    console.log(
      `[CartographySync] Finished syncRunId=${input.syncRunId} durationMs=${Date.now() - start}`,
    );
    await rm(tempDir, { recursive: true, force: true });
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

async function writeAwsProfiles(
  awsDir: string,
  targets: (SyncContextTarget & ResolvedAwsCredentials)[],
): Promise<void> {
  const credentialsBlocks: string[] = [];
  const configBlocks: string[] = [];

  for (const [index, target] of targets.entries()) {
    const profileName = buildProfileName(target.connectionId, index);
    const region = target.region?.trim() || 'us-east-1';
    const header = index === 0 ? 'default' : profileName;
    const configHeader = index === 0 ? '[default]' : `[profile ${profileName}]`;

    credentialsBlocks.push(
      `[${header}]`,
      `aws_access_key_id = ${target.accessKeyId}`,
      `aws_secret_access_key = ${target.secretAccessKey}`,
    );
    if (target.sessionToken) {
      credentialsBlocks.push(`aws_session_token = ${target.sessionToken}`);
    }
    credentialsBlocks.push('');

    configBlocks.push(configHeader, `region = ${region}`, 'output = json', '');
  }

  await writeFile(join(awsDir, 'credentials'), credentialsBlocks.join('\n'));
  await writeFile(join(awsDir, 'config'), configBlocks.join('\n'));
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

async function runCommand(
  command: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function truncateForLogs(value: string, maxLength = 4000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

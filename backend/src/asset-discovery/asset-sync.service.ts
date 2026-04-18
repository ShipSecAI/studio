import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { AuthContext } from '../auth/types';
import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { integrationTokens } from '../database/schema/integrations';
import { IntegrationsService } from '../integrations/integrations.service';
import { AssetDiscoveryService } from './asset-discovery.service';
import { CloudGraphService } from './cloud-graph.service';
import { IndexInfraService } from '../schedules/index-infra.service';

// In-memory rate limit tracker (per-process; use Redis in production)
const syncRateMap = new Map<string, number>();

const ASSET_DISCOVERY_ENABLED = process.env.ASSET_DISCOVERY_ENABLED !== 'false';
const SYNC_RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes
const SUPPORTED_CLOUD_CREDENTIALS: readonly { provider: string; credentialType: string }[] = [
  { provider: 'aws', credentialType: 'iam_role' },
  { provider: 'gcp', credentialType: 'service_account' },
];

@Injectable()
export class AssetSyncService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly assetDiscoveryService: AssetDiscoveryService,
    private readonly cloudGraphService: CloudGraphService,
    private readonly indexInfraService: IndexInfraService,
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Manual sync trigger via REST API.
   * Rate limited: max 1 sync per integration per 5 minutes.
   */
  async triggerSync(integrationId: string, auth: AuthContext) {
    if (!ASSET_DISCOVERY_ENABLED) {
      throw new BadRequestException('Asset discovery is not enabled');
    }

    const orgId = auth?.organizationId;
    if (!orgId) throw new BadRequestException('Organization context required');

    await this.integrationsService.assertConnectionBelongsToOrg(integrationId, orgId);

    const [connection] = await this.db
      .select({
        provider: integrationTokens.provider,
        credentialType: integrationTokens.credentialType,
      })
      .from(integrationTokens)
      .where(
        and(eq(integrationTokens.id, integrationId), eq(integrationTokens.organizationId, orgId)),
      )
      .limit(1);

    if (!isSupportedCloudConnection(connection)) {
      throw new BadRequestException(
        'Only AWS IAM role and GCP service account connections support asset sync',
      );
    }

    const rateKey = `sync:${integrationId}`;
    const lastSync = syncRateMap.get(rateKey);
    if (lastSync && Date.now() - lastSync < SYNC_RATE_LIMIT_MS) {
      throw new BadRequestException('Sync rate limit exceeded. Try again in 5 minutes.');
    }

    syncRateMap.set(rateKey, Date.now());

    const run = await this.indexInfraService.triggerRun({
      auth,
      integrationId,
      trigger: {
        type: 'manual',
        sourceId: integrationId,
        label: 'Cloud inventory sync',
      },
    });

    return { workflowId: run.workflowId, runId: run.runId };
  }

  async prepareSyncContext(input: {
    organizationId: string;
    integrationId?: string;
    temporalWorkflowId?: string;
    temporalRunId?: string;
  }) {
    if (input.integrationId) {
      await this.integrationsService.assertConnectionBelongsToOrg(
        input.integrationId,
        input.organizationId,
      );
    }

    const orgConnections = await this.db
      .select({
        id: integrationTokens.id,
        provider: integrationTokens.provider,
        credentialType: integrationTokens.credentialType,
        displayName: integrationTokens.displayName,
        metadata: integrationTokens.metadata,
      })
      .from(integrationTokens)
      .where(eq(integrationTokens.organizationId, input.organizationId));

    const supportedConnections = orgConnections.filter((connection) =>
      isSupportedCloudConnection(connection),
    );

    if (input.integrationId) {
      const selectedConnection = orgConnections.find(
        (connection) => connection.id === input.integrationId,
      );
      if (!isSupportedCloudConnection(selectedConnection)) {
        throw new BadRequestException(
          'Only AWS IAM role and GCP service account connections support asset sync',
        );
      }
    }

    if (supportedConnections.length === 0) {
      throw new BadRequestException('No supported cloud connections available for org sync');
    }

    const effectiveConnection = input.integrationId
      ? supportedConnections.find((connection) => connection.id === input.integrationId)
      : supportedConnections[0];
    if (!effectiveConnection) {
      throw new BadRequestException('Failed to resolve supported cloud connection for sync');
    }
    const effectiveIntegrationId = effectiveConnection.id;
    const connections = input.integrationId ? [effectiveConnection] : supportedConnections;

    const targets = [];
    const coveredRegions = new Set<string>();
    const connectionBindings = [];

    for (const connection of connections) {
      const resolved = await this.integrationsService.resolveConnectionCredentials(connection.id);
      const bindingIdentifiers = new Set<string>();
      if (resolved.accountId) {
        bindingIdentifiers.add(resolved.accountId);
      }
      for (const identifier of extractConnectionIdentifiers(
        connection.provider,
        connection.credentialType,
        coerceMetadata(connection.metadata),
      )) {
        bindingIdentifiers.add(identifier);
      }

      if (bindingIdentifiers.size === 0) {
        continue;
      }

      const region =
        resolved.provider === 'aws'
          ? (resolved.region ??
            (typeof resolved.data?.region === 'string' ? resolved.data.region : null) ??
            null)
          : null;
      if (region) {
        coveredRegions.add(region);
      }

      targets.push({
        connectionId: connection.id,
        displayName: connection.displayName,
        accountIdentifier: resolved.accountId ?? Array.from(bindingIdentifiers)[0] ?? null,
        region,
      });
      for (const accountIdentifier of bindingIdentifiers) {
        connectionBindings.push({
          connectionId: connection.id,
          accountIdentifier,
        });
      }
    }

    if (targets.length === 0) {
      throw new BadRequestException('Failed to resolve usable cloud credentials for org sync');
    }

    const run = await this.assetDiscoveryService.createSyncRun(
      input.organizationId,
      effectiveIntegrationId,
      null,
      Array.from(coveredRegions),
      input.temporalWorkflowId,
      input.temporalRunId,
    );

    return {
      syncRunId: run.id,
      integrationId: effectiveIntegrationId,
      neo4jDatabase: this.cloudGraphService.getDatabaseName(),
      targets,
      coveredRegions: Array.from(coveredRegions),
      connectionBindings,
    };
  }
}

function isSupportedCloudConnection(
  connection: { provider?: string | null; credentialType?: string | null } | undefined,
): connection is { provider: string; credentialType: string } {
  if (!connection?.provider || !connection?.credentialType) {
    return false;
  }

  return SUPPORTED_CLOUD_CREDENTIALS.some(
    (supported) =>
      supported.provider === connection.provider &&
      supported.credentialType === connection.credentialType,
  );
}

function coerceMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }
  return metadata as Record<string, unknown>;
}

function extractConnectionIdentifiers(
  provider: string,
  credentialType: string,
  metadata: Record<string, unknown>,
): string[] {
  if (provider === 'aws' && credentialType === 'iam_role') {
    const accountId =
      (typeof metadata.accountId === 'string' && metadata.accountId.trim()) ||
      (typeof metadata.roleArn === 'string'
        ? metadata.roleArn.match(/^arn:aws:iam::(\d{12}):role\/.+$/)?.[1]
        : undefined);
    return accountId ? [accountId] : [];
  }

  if (provider !== 'gcp' || credentialType !== 'service_account') {
    return [];
  }

  const identifiers = new Set<string>();
  for (const value of [metadata.organizationId, metadata.defaultProjectId]) {
    if (typeof value === 'string' && value.trim()) {
      identifiers.add(value.trim());
    }
  }

  const discoveredResources = metadata.discoveredResources;
  if (Array.isArray(discoveredResources)) {
    for (const resource of discoveredResources) {
      if (
        resource &&
        typeof resource === 'object' &&
        typeof resource.id === 'string' &&
        resource.id.trim()
      ) {
        identifiers.add(resource.id.trim());
      }
    }
  }

  return Array.from(identifiers);
}

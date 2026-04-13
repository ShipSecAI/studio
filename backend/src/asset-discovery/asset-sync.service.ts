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

    if (connection?.provider !== 'aws' || connection?.credentialType !== 'iam_role') {
      throw new BadRequestException('Only AWS IAM role connections support asset sync');
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

    const connections = await this.db
      .select({
        id: integrationTokens.id,
        displayName: integrationTokens.displayName,
      })
      .from(integrationTokens)
      .where(
        and(
          eq(integrationTokens.organizationId, input.organizationId),
          eq(integrationTokens.provider, 'aws'),
          eq(integrationTokens.credentialType, 'iam_role'),
        ),
      );

    if (connections.length === 0) {
      throw new BadRequestException('No AWS IAM role connections available for org sync');
    }

    const effectiveIntegrationId = input.integrationId ?? connections[0]!.id;

    const targets = [];
    const coveredRegions = new Set<string>();
    const connectionBindings = [];

    for (const connection of connections) {
      const resolved = await this.integrationsService.resolveConnectionCredentials(connection.id);
      if (!resolved.accountId) {
        continue;
      }

      const region =
        resolved.region ??
        (typeof resolved.data?.region === 'string' ? resolved.data.region : null) ??
        null;
      if (region) {
        coveredRegions.add(region);
      }

      targets.push({
        connectionId: connection.id,
        displayName: connection.displayName,
        accountIdentifier: resolved.accountId ?? null,
        region,
      });
      connectionBindings.push({
        connectionId: connection.id,
        accountIdentifier: resolved.accountId ?? null,
      });
    }

    if (targets.length === 0) {
      throw new BadRequestException('Failed to resolve usable AWS credentials for org sync');
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

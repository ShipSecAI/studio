import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { and, eq } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { AuthContext } from '../auth/types';
import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { integrationTokens } from '../database/schema/integrations';
import { IntegrationsService } from '../integrations/integrations.service';
import { TemporalService } from '../temporal/temporal.service';

// In-memory rate limit tracker (per-process; use Redis in production)
const syncRateMap = new Map<string, number>();

const ASSET_DISCOVERY_ENABLED = process.env.ASSET_DISCOVERY_ENABLED !== 'false';
const SYNC_RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class AssetSyncService {
  private readonly logger = new Logger(AssetSyncService.name);

  constructor(
    private readonly temporalService: TemporalService,
    private readonly integrationsService: IntegrationsService,
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

    const workflowId = `asset-sync-${integrationId}`;
    await this.startSyncWorkflow(integrationId, orgId);

    return { workflowId };
  }

  async startSyncWorkflow(integrationId: string, organizationId: string): Promise<void> {
    const workflowId = `asset-sync-${integrationId}`;

    try {
      await this.temporalService.startWorkflow({
        workflowType: 'assetSyncWorkflow',
        workflowId,
        args: [{ integrationId, organizationId }],
      });
      this.logger.log(`Started asset sync workflow ${workflowId}`);
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        this.logger.log(`Asset sync workflow ${workflowId} already running, skipping`);
        return;
      }

      if (
        error instanceof Error &&
        (error.message.includes('already started') || error.message.includes('already running'))
      ) {
        this.logger.log(`Asset sync workflow ${workflowId} already running, skipping`);
        return;
      }

      throw error;
    }
  }
}

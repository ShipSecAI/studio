import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TemporalService } from '../temporal/temporal.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { AssetDiscoveryRepository } from './asset-discovery.repository';
import type { AuthContext } from '../auth/types';

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
    private readonly assetRepo: AssetDiscoveryRepository,
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

    // Rate limit check
    const rateKey = `sync:${integrationId}`;
    const lastSync = syncRateMap.get(rateKey);
    if (lastSync && Date.now() - lastSync < SYNC_RATE_LIMIT_MS) {
      throw new BadRequestException('Sync rate limit exceeded. Try again in 5 minutes.');
    }

    syncRateMap.set(rateKey, Date.now());

    const workflowId = `asset-sync-${integrationId}`;

    // Try to trigger via schedule first, fall back to direct start
    try {
      await this.temporalService.triggerSchedule(`asset-sync-${integrationId}`);
    } catch {
      // Schedule may not exist yet — start workflow directly
      this.logger.log(`Starting asset sync workflow directly for ${integrationId}`);
      await this.startSyncWorkflow(integrationId, orgId);
    }

    return { workflowId };
  }

  /**
   * Start a new asset sync workflow via TemporalService.startWorkflow().
   */
  async startSyncWorkflow(integrationId: string, organizationId: string) {
    const workflowId = `asset-sync-${integrationId}`;

    try {
      await this.temporalService.startWorkflow({
        workflowType: 'assetSyncWorkflow',
        workflowId,
        args: [{ integrationId, organizationId }],
      });

      this.logger.log(`Started asset sync workflow ${workflowId}`);
    } catch (error: any) {
      if (error?.message?.includes('already running') || error?.code === 'ALREADY_EXISTS') {
        this.logger.log(`Asset sync workflow ${workflowId} already running, skipping`);
        return;
      }
      throw error;
    }
  }

  /**
   * Create a Temporal schedule for recurring asset sync.
   * Uses the custom schedule method to support direct workflow types.
   */
  async createSyncSchedule(integrationId: string, organizationId: string) {
    if (!ASSET_DISCOVERY_ENABLED) return;

    const scheduleId = `asset-sync-${integrationId}`;

    try {
      await this.temporalService.createCustomSchedule({
        scheduleId,
        cronExpression: '0 */6 * * *', // Every 6 hours
        workflowType: 'assetSyncWorkflow',
        workflowId: `asset-sync-${integrationId}`,
        args: [{ integrationId, organizationId }],
        overlapPolicy: 'skip',
      });

      this.logger.log(`Created asset sync schedule ${scheduleId}`);

      // Trigger immediate first sync
      await this.temporalService.triggerSchedule(scheduleId);
    } catch (error: any) {
      this.logger.error(`Failed to create asset sync schedule: ${error.message}`, error.stack);
    }
  }

  /**
   * Delete a Temporal schedule for asset sync.
   */
  async deleteSyncSchedule(integrationId: string) {
    const scheduleId = `asset-sync-${integrationId}`;

    try {
      await this.temporalService.deleteSchedule(scheduleId);
      this.logger.log(`Deleted asset sync schedule ${scheduleId}`);
    } catch (error: any) {
      // Ignore "not found" — schedule may have already been deleted
      if (!error?.message?.includes('not found')) {
        this.logger.error(`Failed to delete schedule ${scheduleId}: ${error.message}`);
      }
    }

    // Also cancel any running workflow
    try {
      await this.temporalService.cancelWorkflow({
        workflowId: `asset-sync-${integrationId}`,
      });
    } catch {
      // Ignore — workflow may not be running
    }
  }

  // ── EventEmitter2 Lifecycle Handlers ─────────────────────────────────────

  @OnEvent('integration.aws.created')
  async onAwsConnectionCreated(event: { integrationId: string; organizationId: string }) {
    this.logger.log(`AWS connection created: ${event.integrationId}, creating sync schedule`);
    await this.createSyncSchedule(event.integrationId, event.organizationId);
  }

  @OnEvent('integration.aws.updated')
  async onAwsConnectionUpdated(event: { integrationId: string; organizationId: string }) {
    this.logger.log(`AWS connection updated: ${event.integrationId}, triggering sync`);
    try {
      await this.temporalService.triggerSchedule(`asset-sync-${event.integrationId}`);
    } catch {
      await this.startSyncWorkflow(event.integrationId, event.organizationId);
    }
  }

  @OnEvent('integration.deleted')
  async onConnectionDeleted(event: {
    integrationId: string;
    organizationId: string;
    accountIdentifier: string;
  }) {
    await this.deleteSyncSchedule(event.integrationId);

    // Clear integrationId on assets owned by the deleted connection
    await this.assetRepo.clearIntegrationId(event.organizationId, event.integrationId);

    this.logger.log(
      `Cleaned up assets for deleted connection ${event.integrationId} (account: ${event.accountIdentifier})`,
    );
  }
}

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AssetDiscoveryRepository } from './asset-discovery.repository';
import { AssetSyncRunsRepository } from './asset-sync-runs.repository';
import type { AuthContext } from '../auth/types';

@Injectable()
export class AssetDiscoveryService {
  private readonly logger = new Logger(AssetDiscoveryService.name);

  constructor(
    private readonly assetRepo: AssetDiscoveryRepository,
    private readonly syncRunsRepo: AssetSyncRunsRepository,
  ) {}

  private requireOrganizationId(auth: AuthContext | null): string {
    const orgId = auth?.organizationId;
    if (!orgId) throw new BadRequestException('Organization context required');
    return orgId;
  }

  // ── Asset Queries ──────────────────────────────────────────────────────────

  async listAssets(auth: AuthContext, options: Record<string, any> = {}) {
    const organizationId = this.requireOrganizationId(auth);
    return this.assetRepo.listAssets(organizationId, options);
  }

  async getAsset(auth: AuthContext, assetId: string) {
    const organizationId = this.requireOrganizationId(auth);
    const asset = await this.assetRepo.getAssetById(organizationId, assetId);
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async getSummary(auth: AuthContext) {
    const organizationId = this.requireOrganizationId(auth);
    return this.assetRepo.getSummary(organizationId);
  }

  // ── Sync Runs ──────────────────────────────────────────────────────────────

  async listSyncRuns(
    auth: AuthContext,
    options: { integrationId?: string; limit?: number; page?: number } = {},
  ) {
    const organizationId = this.requireOrganizationId(auth);
    return this.syncRunsRepo.listByOrg(organizationId, options);
  }

  async getSyncRun(auth: AuthContext, syncRunId: string) {
    const organizationId = this.requireOrganizationId(auth);
    const run = await this.syncRunsRepo.getById(syncRunId);
    if (!run || run.organizationId !== organizationId) {
      throw new NotFoundException('Sync run not found');
    }
    return run;
  }

  // ── Internal endpoints (called by worker activities) ───────────────────────

  async createSyncRun(
    organizationId: string,
    integrationId: string,
    accountIdentifier: string,
    regions: string[],
    temporalWorkflowId?: string,
    temporalRunId?: string,
  ) {
    const now = new Date();
    return this.syncRunsRepo.create({
      organizationId,
      integrationId,
      accountIdentifier,
      temporalWorkflowId,
      temporalRunId,
      status: 'running',
      coveredRegions: regions,
      startedAt: now,
    });
  }

  async reconcileAssets(
    organizationId: string,
    integrationId: string,
    accountIdentifier: string,
    syncRunId: string,
    assets: {
      assetType: string;
      externalId: string;
      name: string;
      region?: string;
      metadata: Record<string, unknown>;
    }[],
  ) {
    return this.assetRepo.reconcileAssets(
      organizationId,
      integrationId,
      accountIdentifier,
      syncRunId,
      assets,
    );
  }

  async persistSyncRunScopes(syncRunId: string, scopes: { assetType: string; region: string }[]) {
    return this.assetRepo.persistSyncRunScopes(syncRunId, scopes);
  }

  async markStaleAssets(
    organizationId: string,
    integrationId: string,
    accountIdentifier: string,
    syncRunId: string,
    syncStartTime: Date,
  ) {
    return this.assetRepo.markStaleAssets(
      organizationId,
      integrationId,
      accountIdentifier,
      syncRunId,
      syncStartTime,
    );
  }

  async updateSyncRunStatus(
    syncRunId: string,
    status: string,
    stats?: {
      assetsDiscovered?: number;
      assetsCreated?: number;
      assetsUpdated?: number;
      assetsStale?: number;
      coveredRegions?: string[];
      errors?: { message: string; timestamp: string }[];
    },
  ) {
    return this.syncRunsRepo.updateStatus(syncRunId, {
      status,
      ...stats,
      completedAt: status === 'completed' || status === 'failed' ? new Date() : undefined,
    });
  }
}

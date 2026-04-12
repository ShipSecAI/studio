import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AssetDiscoveryRepository } from './asset-discovery.repository';
import { AssetSyncRunsRepository } from './asset-sync-runs.repository';
import type { AuthContext } from '../auth/types';
import { CloudGraphService } from './cloud-graph.service';
import type { CartographySyncConnectionBinding } from './cartography-utils';
import { IntegrationsService } from '../integrations/integrations.service';

@Injectable()
export class AssetDiscoveryService {
  private readonly logger = new Logger(AssetDiscoveryService.name);

  constructor(
    private readonly assetRepo: AssetDiscoveryRepository,
    private readonly syncRunsRepo: AssetSyncRunsRepository,
    private readonly cloudGraphService: CloudGraphService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  private requireOrganizationId(auth: AuthContext | null): string {
    const orgId = auth?.organizationId;
    if (!orgId) throw new BadRequestException('Organization context required');
    return orgId;
  }

  // ── Asset Queries ──────────────────────────────────────────────────────────

  async listAssets(auth: AuthContext, options: Record<string, any> = {}) {
    const organizationId = this.requireOrganizationId(auth);
    const status = options.status;
    if (status === 'stale' || status === 'removed') {
      return {
        assets: [],
        total: 0,
        page: Number(options.page ?? 1),
        limit: Number(options.limit ?? 50),
      };
    }

    const accountIdentifiers =
      await this.integrationsService.listAwsAccountIdentifiersForOrg(organizationId);
    const snapshot = await this.cloudGraphService.listAssets(organizationId, accountIdentifiers);

    const filtered = snapshot
      .filter((asset) => !options.provider || asset.provider === options.provider)
      .filter((asset) => !options.assetType || asset.assetType === options.assetType)
      .filter((asset) => !options.region || asset.region === options.region)
      .filter((asset) => !options.integrationId || asset.integrationId === options.integrationId)
      .filter((asset) => {
        if (!options.search) return true;
        const search = String(options.search).toLowerCase();
        return (
          (asset.name ?? '').toLowerCase().includes(search) ||
          asset.externalId.toLowerCase().includes(search)
        );
      });

    const sortBy =
      options.sortBy === 'name'
        ? 'name'
        : options.sortBy === 'firstDiscoveredAt'
          ? 'firstDiscoveredAt'
          : 'lastSeenAt';
    const sortOrder = options.sortOrder === 'asc' ? 'asc' : 'desc';
    filtered.sort((a, b) => compareAssetValues(a[sortBy], b[sortBy], sortOrder));

    const limit = Math.min(Number(options.limit ?? 50), 200);
    const page = Number(options.page ?? 1);
    const offset = options.offset != null ? Number(options.offset) : Math.max(page - 1, 0) * limit;

    return {
      assets: filtered.slice(offset, offset + limit).map((asset) => ({
        ...asset,
        status: 'active',
        firstDiscoveredAt: asset.firstSeenAt,
        lastSeenAt: asset.lastSeenAt,
        createdAt: asset.firstSeenAt,
        updatedAt: asset.lastSeenAt,
      })),
      total: filtered.length,
      page,
      limit,
    };
  }

  async getAsset(auth: AuthContext, assetId: string) {
    const organizationId = this.requireOrganizationId(auth);
    const accountIdentifiers =
      await this.integrationsService.listAwsAccountIdentifiersForOrg(organizationId);
    const assets = await this.cloudGraphService.listAssets(organizationId, accountIdentifiers);
    const asset = assets.find((candidate) => candidate.id === assetId);
    if (!asset) throw new NotFoundException('Asset not found');
    return {
      ...asset,
      status: 'active',
      firstDiscoveredAt: asset.firstSeenAt,
      lastSeenAt: asset.lastSeenAt,
      createdAt: asset.firstSeenAt,
      updatedAt: asset.lastSeenAt,
    };
  }

  async getSummary(auth: AuthContext) {
    const organizationId = this.requireOrganizationId(auth);
    const accountIdentifiers =
      await this.integrationsService.listAwsAccountIdentifiersForOrg(organizationId);
    const [graphAssets, historicalStatuses] = await Promise.all([
      this.cloudGraphService.listAssets(organizationId, accountIdentifiers),
      this.assetRepo.getHistoricalStatusCounts(organizationId),
    ]);

    const byType = new Map<string, number>();
    const byRegion = new Map<string, number>();
    for (const asset of graphAssets) {
      byType.set(asset.assetType, (byType.get(asset.assetType) ?? 0) + 1);
      byRegion.set(asset.region ?? 'global', (byRegion.get(asset.region ?? 'global') ?? 0) + 1);
    }

    const byStatus = [{ status: 'active', count: graphAssets.length }, ...historicalStatuses];

    return {
      totalAssets: byStatus.reduce((sum, row) => sum + row.count, 0),
      byType: Array.from(byType.entries()).map(([assetType, count]) => ({ assetType, count })),
      byRegion: Array.from(byRegion.entries()).map(([region, count]) => ({ region, count })),
      byStatus,
    };
  }

  // ── Sync Runs ──────────────────────────────────────────────────────────────

  async listSyncRuns(
    auth: AuthContext,
    options: { integrationId?: string; limit?: number; page?: number; offset?: number } = {},
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
    accountIdentifier: string | null,
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

  async refreshFromGraphSnapshot(
    organizationId: string,
    _integrationId: string,
    _syncRunId: string,
    _connectionBindings: CartographySyncConnectionBinding[],
  ) {
    const accountIdentifiers =
      await this.integrationsService.listAwsAccountIdentifiersForOrg(organizationId);
    const graphAssets = await this.cloudGraphService.listAssets(organizationId, accountIdentifiers);

    return {
      assetsDiscovered: graphAssets.length,
      assetsCreated: graphAssets.length,
      assetsUpdated: 0,
      assetsStale: 0,
      coveredRegions: Array.from(
        new Set(
          graphAssets.map((asset) => asset.region).filter((region): region is string => !!region),
        ),
      ),
    };
  }
}

function compareAssetValues(
  left: string | null | undefined,
  right: string | null | undefined,
  sortOrder: 'asc' | 'desc',
): number {
  const lhs = left ?? '';
  const rhs = right ?? '';
  return sortOrder === 'asc' ? lhs.localeCompare(rhs) : rhs.localeCompare(lhs);
}

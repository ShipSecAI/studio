import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AssetDiscoveryRepository } from './asset-discovery.repository';
import { AssetSyncRunsRepository } from './asset-sync-runs.repository';
import type { AuthContext } from '../auth/types';
import { CloudGraphService } from './cloud-graph.service';
import type { CartographySyncConnectionBinding } from './cartography-utils';
import { DRIZZLE_TOKEN } from '../database/database.module';
import * as schema from '../database/schema';
import { integrationTokens } from '../database/schema/integrations';

@Injectable()
export class AssetDiscoveryService {
  private readonly logger = new Logger(AssetDiscoveryService.name);

  constructor(
    private readonly assetRepo: AssetDiscoveryRepository,
    private readonly syncRunsRepo: AssetSyncRunsRepository,
    private readonly cloudGraphService: CloudGraphService,
    @Inject(DRIZZLE_TOKEN)
    private readonly db: NodePgDatabase<typeof schema>,
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

    const snapshot = await this.listGraphAssetsForOrg(organizationId);

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

    const sortBy: 'name' | 'firstSeenAt' | 'lastSeenAt' =
      options.sortBy === 'name'
        ? 'name'
        : options.sortBy === 'firstDiscoveredAt'
          ? 'firstSeenAt'
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
    const assets = await this.listGraphAssetsForOrg(organizationId);
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
    const [graphAssets, historicalStatuses] = await Promise.all([
      this.listGraphAssetsForOrg(organizationId),
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
    integrationId: string,
    _syncRunId: string,
    connectionBindings: CartographySyncConnectionBinding[],
  ) {
    const previousCompletedSync = await this.syncRunsRepo.findLatestCompletedSyncForIntegration(
      organizationId,
      integrationId,
    );
    const graphAssets = await this.listGraphAssetsForOrg(
      organizationId,
      connectionBindings.length > 0 ? connectionBindings : undefined,
    );
    const currentDiscovered = graphAssets.length;
    const previousDiscovered = Number(previousCompletedSync?.assetsDiscovered ?? 0);
    const assetsCreated = Math.max(currentDiscovered - previousDiscovered, 0);
    const assetsStale = Math.max(previousDiscovered - currentDiscovered, 0);
    const assetsUpdated = Math.min(currentDiscovered, previousDiscovered);

    return {
      assetsDiscovered: currentDiscovered,
      assetsCreated,
      assetsUpdated,
      assetsStale,
      coveredRegions: Array.from(
        new Set(
          graphAssets.map((asset) => asset.region).filter((region): region is string => !!region),
        ),
      ),
    };
  }

  private async listGraphAssetsForOrg(
    organizationId: string,
    bindings?: CartographySyncConnectionBinding[],
  ) {
    const connectionBindings =
      bindings && bindings.length > 0
        ? dedupeConnectionBindings(bindings)
        : await this.listCloudConnectionBindingsForOrg(organizationId);
    return this.cloudGraphService.listAssets(organizationId, connectionBindings);
  }

  private async listCloudConnectionBindingsForOrg(
    organizationId: string,
  ): Promise<CartographySyncConnectionBinding[]> {
    const records = await this.db
      .select({
        id: integrationTokens.id,
        provider: integrationTokens.provider,
        credentialType: integrationTokens.credentialType,
        metadata: integrationTokens.metadata,
      })
      .from(integrationTokens)
      .where(eq(integrationTokens.organizationId, organizationId));

    const bindings: CartographySyncConnectionBinding[] = [];
    for (const record of records) {
      const accountIdentifiers = extractConnectionIdentifiers(
        record.provider,
        record.credentialType,
        coerceMetadata(record.metadata),
      );
      for (const accountIdentifier of accountIdentifiers) {
        bindings.push({
          connectionId: record.id,
          accountIdentifier,
        });
      }
    }

    return dedupeConnectionBindings(bindings);
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

function dedupeConnectionBindings(
  bindings: CartographySyncConnectionBinding[],
): CartographySyncConnectionBinding[] {
  const deduped = new Map<string, CartographySyncConnectionBinding>();
  for (const binding of bindings) {
    if (!binding.accountIdentifier) {
      continue;
    }

    deduped.set(`${binding.connectionId}:${binding.accountIdentifier}`, binding);
  }
  return Array.from(deduped.values());
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

function coerceMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  return metadata as Record<string, unknown>;
}

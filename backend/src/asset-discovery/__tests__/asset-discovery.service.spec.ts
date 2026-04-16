import { describe, expect, it, mock } from 'bun:test';

import { AssetDiscoveryService } from '../asset-discovery.service';

describe('AssetDiscoveryService.refreshFromGraphSnapshot', () => {
  it('derives sync counters from prior completed run totals', async () => {
    const service = new AssetDiscoveryService(
      {
        getHistoricalStatusCounts: mock(() => Promise.resolve([])),
      } as any,
      {
        findLatestCompletedSyncForIntegration: mock(() => Promise.resolve({ assetsDiscovered: 3 })),
      } as any,
      {
        listAssets: mock(() =>
          Promise.resolve([
            {
              id: 'asset-1',
              organizationId: 'org-1',
              integrationId: 'conn-1',
              provider: 'gcp',
              assetType: 'gcp_project',
              externalId: 'project-a',
              name: 'Project A',
              region: 'global',
              accountIdentifier: 'project-a',
              metadata: {},
              firstSeenAt: new Date().toISOString(),
              lastSeenAt: new Date().toISOString(),
            },
          ]),
        ),
      } as any,
      {} as any,
    );

    const result = await service.refreshFromGraphSnapshot('org-1', 'conn-1', 'sync-1', [
      { connectionId: 'conn-1', accountIdentifier: 'project-a' },
    ]);

    expect(result.assetsDiscovered).toBe(1);
    expect(result.assetsCreated).toBe(0);
    expect(result.assetsUpdated).toBe(1);
    expect(result.assetsStale).toBe(2);
  });
});

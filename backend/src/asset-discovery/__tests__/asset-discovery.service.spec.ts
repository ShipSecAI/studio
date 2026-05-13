import { describe, expect, it, mock } from 'bun:test';

import { AssetDiscoveryService } from '../asset-discovery.service';

describe('AssetDiscoveryService.refreshFromGraphSnapshot', () => {
  it('derives sync counters from prior completed run totals', async () => {
    const service = new AssetDiscoveryService(
      {
        getHistoricalStatusCounts: mock(() => Promise.resolve([])),
        upsertGraphSnapshots: mock(() =>
          Promise.resolve({
            created: 0,
            updated: 1,
            stale: 2,
          }),
        ),
        markStaleUnseenAssets: mock(() => Promise.resolve(2)),
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

describe('AssetDiscoveryService.listAssets', () => {
  it('binds CE cloud credentials when filtering graph assets', async () => {
    const cloudGraphListAssets = mock(() => Promise.resolve([]));
    const records = [
      {
        id: 'aws-access-key-connection',
        provider: 'aws',
        credentialType: 'access_key',
        metadata: { accountId: '123456789012' },
      },
      {
        id: 'gcp-service-account-key-connection',
        provider: 'gcp',
        credentialType: 'service_account_key',
        metadata: {
          defaultProjectId: 'shipsec',
          discoveredResources: [{ id: '281737364847' }],
        },
      },
    ];
    const db = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => Promise.resolve(records)),
        })),
      })),
    };
    const service = new AssetDiscoveryService(
      {
        getHistoricalStatusCounts: mock(() => Promise.resolve([])),
      } as any,
      {
        findLatestCompletedSyncForIntegration: mock(() => Promise.resolve(null)),
      } as any,
      {
        listAssets: cloudGraphListAssets,
      } as any,
      db as any,
    );

    await service.listAssets({ organizationId: 'org-1' } as any);

    expect(cloudGraphListAssets).toHaveBeenCalledWith('org-1', [
      { connectionId: 'aws-access-key-connection', accountIdentifier: '123456789012' },
      { connectionId: 'gcp-service-account-key-connection', accountIdentifier: 'shipsec' },
      { connectionId: 'gcp-service-account-key-connection', accountIdentifier: '281737364847' },
    ]);
  });
});

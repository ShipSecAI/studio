import { describe, expect, it, mock } from 'bun:test';

import { AssetSyncService } from '../asset-sync.service';

function makeDbWithConnections(connections: Record<string, unknown>[]) {
  return {
    select: () => ({
      from: () => ({
        where: () => connections,
      }),
    }),
  } as any;
}

describe('AssetSyncService.prepareSyncContext', () => {
  it('limits explicit integration syncs to the selected GCP connection', async () => {
    const assertConnectionBelongsToOrg = mock(() => Promise.resolve());
    const resolveConnectionCredentials = mock((connectionId: string) =>
      Promise.resolve({
        provider: 'gcp',
        credentialType: 'service_account',
        accountId: connectionId === 'gcp-1' ? 'project-a' : 'project-b',
        data: {},
      }),
    );
    const createSyncRun = mock(() => Promise.resolve({ id: 'sync-run-1' }));

    const service = new AssetSyncService(
      {
        assertConnectionBelongsToOrg,
        resolveConnectionCredentials,
      } as any,
      {
        createSyncRun,
      } as any,
      {
        getDatabaseName: () => 'neo4j',
      } as any,
      {} as any,
      makeDbWithConnections([
        {
          id: 'gcp-1',
          provider: 'gcp',
          credentialType: 'service_account',
          displayName: 'GCP One',
          metadata: {
            defaultProjectId: 'project-a',
            discoveredResources: [
              { id: 'project-a', type: 'project' },
              { id: 'project-c', type: 'project' },
            ],
          },
        },
        {
          id: 'gcp-2',
          provider: 'gcp',
          credentialType: 'service_account',
          displayName: 'GCP Two',
          metadata: {
            defaultProjectId: 'project-b',
          },
        },
      ]),
    );

    const context = await service.prepareSyncContext({
      organizationId: 'org-1',
      integrationId: 'gcp-1',
    });

    expect(context.integrationId).toBe('gcp-1');
    expect(context.targets).toHaveLength(1);
    expect(context.targets[0]?.connectionId).toBe('gcp-1');
    expect(context.connectionBindings).toEqual(
      expect.arrayContaining([
        { connectionId: 'gcp-1', accountIdentifier: 'project-a' },
        { connectionId: 'gcp-1', accountIdentifier: 'project-c' },
      ]),
    );
    expect(resolveConnectionCredentials).toHaveBeenCalledTimes(1);
    expect(resolveConnectionCredentials).toHaveBeenCalledWith('gcp-1');
  });

  it('includes multiple providers when no integration is pinned', async () => {
    const resolveConnectionCredentials = mock((connectionId: string) =>
      Promise.resolve(
        connectionId === 'aws-1'
          ? {
              provider: 'aws',
              credentialType: 'iam_role',
              accountId: '111111111111',
              region: 'us-east-1',
              data: { accessKeyId: 'AKIA', secretAccessKey: 'SECRET', region: 'us-east-1' },
            }
          : {
              provider: 'gcp',
              credentialType: 'service_account',
              accountId: 'project-a',
              data: { targetServiceAccountEmail: 'svc@example.com' },
            },
      ),
    );
    const createSyncRun = mock(() => Promise.resolve({ id: 'sync-run-1' }));

    const service = new AssetSyncService(
      {
        resolveConnectionCredentials,
      } as any,
      {
        createSyncRun,
      } as any,
      {
        getDatabaseName: () => 'neo4j',
      } as any,
      {} as any,
      makeDbWithConnections([
        {
          id: 'aws-1',
          provider: 'aws',
          credentialType: 'iam_role',
          displayName: 'AWS One',
          metadata: {
            accountId: '111111111111',
            region: 'us-east-1',
          },
        },
        {
          id: 'gcp-1',
          provider: 'gcp',
          credentialType: 'service_account',
          displayName: 'GCP One',
          metadata: {
            defaultProjectId: 'project-a',
          },
        },
      ]),
    );

    const context = await service.prepareSyncContext({
      organizationId: 'org-1',
    });

    expect(context.targets).toHaveLength(2);
    expect(context.targets.map((target: any) => target.connectionId)).toEqual(
      expect.arrayContaining(['aws-1', 'gcp-1']),
    );
    expect(resolveConnectionCredentials).toHaveBeenCalledTimes(2);
  });
});

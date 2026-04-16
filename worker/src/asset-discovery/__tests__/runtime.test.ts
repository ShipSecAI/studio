import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as cartographySync from '../../components/security/cartography-sync';
import {
  buildProfileName,
  initializeAssetSyncRuntime,
  runPreparedCartographySync,
} from '../runtime';

describe('asset discovery runtime', () => {
  beforeEach(() => {
    initializeAssetSyncRuntime({
      backendUrl: 'http://backend.internal',
      internalToken: 'internal-token',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes GCP impersonation targets through the gcp cartography module', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(((
      ..._args: Parameters<typeof fetch>
    ) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            provider: 'gcp',
            credentialType: 'service_account',
            accountId: 'demo-project',
            data: {
              targetServiceAccountEmail: 'svc@example.com',
              defaultProjectId: 'demo-project',
              organizationId: 'organizations/1234567890',
              clientEmail: 'svc@example.com',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )) as unknown as typeof fetch);
    const cartographySpy = vi.spyOn(cartographySync, 'runCartographyWithRunner').mockResolvedValue({
      command: ['--selected-modules', 'gcp'],
      stdout: 'ok',
      stderr: '',
      durationMs: 17,
    });

    const result = await runPreparedCartographySync({
      organizationId: 'org-123',
      workflowId: 'workflow-1',
      workflowName: 'Index Infra',
      runId: 'run-1',
      componentRef: 'asset-sync.cartography',
      neo4jDatabase: 'neo4j',
      targets: [
        {
          connectionId: 'conn-gcp-1',
          displayName: 'GCP connection',
          accountIdentifier: 'demo-project',
          region: null,
        },
      ],
      coveredRegions: [],
    });

    const gcpCredentialCalls = fetchSpy.mock.calls.filter((call) =>
      String(call[0]).includes('/integrations/connections/conn-gcp-1/credentials'),
    );
    expect(gcpCredentialCalls.length).toBe(1);
    expect(cartographySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedModules: ['gcp'],
        neo4jDatabase: 'neo4j',
        gcpCredential: {
          targetServiceAccountEmail: 'svc@example.com',
          defaultProjectId: 'demo-project',
          organizationId: 'organizations/1234567890',
          clientEmail: 'svc@example.com',
        },
      }),
      expect.anything(),
    );
    expect(result.durationMs).toBe(17);
  });

  it('preserves AWS multi-target profile generation in prepared syncs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(((input: URL | RequestInfo) => {
      const url = String(input);
      const body = url.includes('conn-aws-1')
        ? {
            provider: 'aws',
            credentialType: 'iam_role',
            accountId: '111111111111',
            data: {
              accessKeyId: 'AKIA111',
              secretAccessKey: 'secret-1',
              sessionToken: 'token-1',
              region: 'us-east-1',
            },
          }
        : {
            provider: 'aws',
            credentialType: 'iam_role',
            accountId: '222222222222',
            data: {
              accessKeyId: 'AKIA222',
              secretAccessKey: 'secret-2',
              region: 'us-west-2',
            },
          };

      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as unknown as typeof fetch);

    const cartographySpy = vi.spyOn(cartographySync, 'runCartographyWithRunner').mockResolvedValue({
      command: ['--selected-modules', 'aws'],
      stdout: 'ok',
      stderr: '',
      durationMs: 21,
    });

    await runPreparedCartographySync({
      organizationId: 'org-123',
      workflowId: 'workflow-1',
      workflowName: 'Index Infra',
      runId: 'run-1',
      componentRef: 'asset-sync.cartography',
      neo4jDatabase: 'neo4j',
      targets: [
        {
          connectionId: 'conn-aws-1',
          displayName: 'AWS account 1',
          accountIdentifier: '111111111111',
          region: 'us-east-1',
        },
        {
          connectionId: 'conn-aws-2',
          displayName: 'AWS account 2',
          accountIdentifier: '222222222222',
          region: 'us-west-2',
        },
      ],
      coveredRegions: ['us-east-1', 'us-west-2'],
    });

    expect(cartographySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedModules: ['aws'],
        awsRegions: ['us-east-1', 'us-west-2'],
        awsProfiles: [
          {
            profileName: buildProfileName('conn-aws-1', 0),
            region: 'us-east-1',
            accessKeyId: 'AKIA111',
            secretAccessKey: 'secret-1',
            sessionToken: 'token-1',
          },
          {
            profileName: buildProfileName('conn-aws-2', 1),
            region: 'us-west-2',
            accessKeyId: 'AKIA222',
            secretAccessKey: 'secret-2',
            sessionToken: undefined,
          },
        ],
      }),
      expect.anything(),
    );
  });
});

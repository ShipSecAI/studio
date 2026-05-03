import { afterEach, beforeAll, describe, expect, it, mock, vi } from 'bun:test';
import * as sdk from '@shipsec/component-sdk';

interface MockVolumeRecord {
  files: Record<string, string | Buffer> | null;
  cleanupCalled: boolean;
  getVolumeConfig: (
    containerPath?: string,
    readOnly?: boolean,
  ) => {
    source: string;
    target: string;
    readOnly: boolean;
  };
  initialize: (files: Record<string, string | Buffer>) => Promise<string>;
  cleanup: () => Promise<void>;
}

const createdVolumes: MockVolumeRecord[] = [];

mock.module('../../../utils/isolated-volume', () => ({
  createIsolatedVolume: () => {
    const source = `mock-volume-${createdVolumes.length + 1}`;
    const record: MockVolumeRecord = {
      files: null,
      cleanupCalled: false,
      async initialize(files) {
        record.files = files;
        return source;
      },
      getVolumeConfig(containerPath = '/inputs', readOnly = true) {
        return { source, target: containerPath, readOnly };
      },
      async cleanup() {
        record.cleanupCalled = true;
      },
    };
    createdVolumes.push(record);
    return record;
  },
}));

let componentRegistry: typeof import('@shipsec/component-sdk').componentRegistry;
let cartographySync: typeof import('../cartography-sync');

describe('cartography sync component', () => {
  beforeAll(async () => {
    cartographySync = await import('../cartography-sync');
    ({ componentRegistry } = await import('@shipsec/component-sdk'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    createdVolumes.length = 0;
    delete process.env.SHIPSEC_GCP_IMPERSONATION_SOURCE_CREDENTIALS_JSON;
    delete process.env.CLOUDFLARE_TOKEN;
    delete process.env.CLOUDFLARE_API_TOKEN;
  });

  it('mounts GCP impersonation credentials and sets GOOGLE_APPLICATION_CREDENTIALS', async () => {
    const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');
    process.env.SHIPSEC_GCP_IMPERSONATION_SOURCE_CREDENTIALS_JSON = JSON.stringify({
      type: 'service_account',
      project_id: 'shipsec',
      private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
      client_email: 'shipsec-platform@shipsec.iam.gserviceaccount.com',
    });
    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'cartography-sync-test',
      organizationId: 'org-123',
    });

    const result = await cartographySync.runCartographyWithRunner(
      {
        selectedModules: ['gcp'],
        neo4jUri: 'bolt://neo4j:7687',
        neo4jDatabase: 'neo4j',
        gcpCredential: {
          targetServiceAccountEmail: 'svc@example.com',
          defaultProjectId: 'demo-project',
          clientEmail: 'svc@example.com',
        },
      },
      context,
    );

    expect(runnerSpy).toHaveBeenCalledTimes(1);
    const runnerConfig = runnerSpy.mock.calls[0]?.[0] as any;
    expect(runnerConfig.command).toEqual(
      expect.arrayContaining(['--selected-modules', 'gcp', '--neo4j-uri', 'bolt://neo4j:7687']),
    );
    expect(runnerConfig.env.GOOGLE_APPLICATION_CREDENTIALS).toBe(
      cartographySync.GCP_APPLICATION_CREDENTIALS_PATH,
    );
    expect(runnerConfig.volumes).toContainEqual({
      source: 'mock-volume-1',
      target: cartographySync.GCP_APPLICATION_CREDENTIALS_DIR,
      readOnly: true,
    });
    expect(createdVolumes[0]?.files).toEqual({
      [cartographySync.GCP_APPLICATION_CREDENTIALS_FILENAME]: expect.any(String),
    });
    expect(
      createdVolumes[0]?.files?.[cartographySync.GCP_APPLICATION_CREDENTIALS_FILENAME],
    ).toContain('impersonated_service_account');
    expect(createdVolumes[0]?.cleanupCalled).toBe(true);
    expect(result.command).toEqual(runnerConfig.command);
  });

  it('mounts service account JSON directly for the GCP CE path', async () => {
    const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');
    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'cartography-sync-test',
      organizationId: 'org-123',
    });

    await cartographySync.runCartographyWithRunner(
      {
        selectedModules: ['gcp'],
        neo4jUri: 'bolt://neo4j:7687',
        neo4jDatabase: 'neo4j',
        gcpCredential: {
          authMode: 'service_account_key',
          targetServiceAccountEmail: 'svc@example.com',
          defaultProjectId: 'demo-project',
          clientEmail: 'svc@example.com',
          serviceAccountJson: JSON.stringify({
            type: 'service_account',
            project_id: 'demo-project',
            private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
            client_email: 'svc@example.com',
          }),
        },
      },
      context,
    );

    expect(runnerSpy).toHaveBeenCalledTimes(1);
    const runnerConfig = runnerSpy.mock.calls[0]?.[0] as any;
    expect(runnerConfig.env.GOOGLE_APPLICATION_CREDENTIALS).toBe(
      cartographySync.GCP_APPLICATION_CREDENTIALS_PATH,
    );
    expect(
      createdVolumes[0]?.files?.[cartographySync.GCP_APPLICATION_CREDENTIALS_FILENAME],
    ).toContain('"type":"service_account"');
  });

  it('preserves AWS multi-profile sync behavior', async () => {
    const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');
    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'cartography-sync-test',
      organizationId: 'org-123',
    });

    await cartographySync.runCartographyWithRunner(
      {
        selectedModules: ['aws'],
        neo4jUri: 'bolt://neo4j:7687',
        neo4jDatabase: 'neo4j',
        awsProfiles: [
          {
            profileName: 'primary',
            region: 'us-east-1',
            accessKeyId: 'AKIA111',
            secretAccessKey: 'secret-1',
          },
          {
            profileName: 'secondary',
            region: 'us-west-2',
            accessKeyId: 'AKIA222',
            secretAccessKey: 'secret-2',
            sessionToken: 'token-2',
          },
        ],
      },
      context,
    );

    expect(runnerSpy).toHaveBeenCalledTimes(1);
    const runnerConfig = runnerSpy.mock.calls[0]?.[0] as any;
    expect(runnerConfig.command).toEqual(
      expect.arrayContaining([
        '--selected-modules',
        'aws',
        '--aws-sync-all-profiles',
        '--aws-requested-syncs',
        cartographySync.DEFAULT_AWS_REQUESTED_SYNCS,
      ]),
    );
    expect(runnerConfig.env.AWS_DEFAULT_REGION).toBe('us-east-1');
    expect(runnerConfig.env.AWS_REGION).toBe('us-east-1');
    expect(runnerConfig.volumes).toContainEqual({
      source: 'mock-volume-1',
      target: '/var/cartography/.aws',
      readOnly: true,
    });
    expect(createdVolumes[0]?.files?.credentials).toContain('[default]');
    expect(createdVolumes[0]?.files?.credentials).toContain('[secondary]');
    expect(createdVolumes[0]?.files?.config).toContain('[profile secondary]');
    expect(createdVolumes[0]?.cleanupCalled).toBe(true);
  });

  it('passes Cloudflare token through env var for native Cartography sync', async () => {
    const runnerSpy = vi.spyOn(sdk, 'runComponentWithRunner').mockResolvedValue('');
    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'cartography-sync-test',
      organizationId: 'org-123',
    });

    await cartographySync.runCartographyWithRunner(
      {
        selectedModules: ['cloudflare'],
        neo4jUri: 'bolt://neo4j:7687',
        neo4jDatabase: 'neo4j',
        cloudflareToken: 'cf-secret-token',
      },
      context,
    );

    expect(runnerSpy).toHaveBeenCalledTimes(1);
    const runnerConfig = runnerSpy.mock.calls[0]?.[0] as any;
    expect(runnerConfig.command).toEqual(
      expect.arrayContaining([
        '--selected-modules',
        'cloudflare',
        '--cloudflare-token-env-var',
        cartographySync.CLOUDFLARE_TOKEN_ENV,
      ]),
    );
    expect(runnerConfig.command).not.toContain('cf-secret-token');
    expect(runnerConfig.env[cartographySync.CLOUDFLARE_TOKEN_ENV]).toBe('cf-secret-token');
  });

  it('requires gcpCredential when the gcp module is selected', async () => {
    const component: any = componentRegistry.get('security.cartography.sync');
    if (!component) {
      throw new Error('security.cartography.sync not registered');
    }

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'cartography-sync-test',
      organizationId: 'org-123',
    });

    await expect(
      component.execute(
        {
          inputs: {},
          params: {
            selectedModules: ['gcp'],
            neo4jUri: 'bolt://neo4j:7687',
            neo4jDatabase: 'neo4j',
          },
        },
        context,
      ),
    ).rejects.toThrow(
      'GCP module requires GCP credentials. Connect a GCP credential source to the gcpCredential input.',
    );
  });

  it('requires Cloudflare token when the cloudflare module is selected', async () => {
    const component: any = componentRegistry.get('security.cartography.sync');
    if (!component) {
      throw new Error('security.cartography.sync not registered');
    }

    const context = sdk.createExecutionContext({
      runId: 'test-run',
      componentRef: 'cartography-sync-test',
      organizationId: 'org-123',
    });

    await expect(
      component.execute(
        {
          inputs: {},
          params: {
            selectedModules: ['cloudflare'],
            neo4jUri: 'bolt://neo4j:7687',
            neo4jDatabase: 'neo4j',
          },
        },
        context,
      ),
    ).rejects.toThrow('Cloudflare module requires an API token.');
  });
});

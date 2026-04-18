import { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, expect, it, mock } from 'bun:test';
import { BadRequestException } from '@nestjs/common';

import { IntegrationsService } from '../integrations.service';
import type { IntegrationsRepository } from '../integrations.repository';
import type { TokenEncryptionService } from '../token.encryption';
import type { AwsService } from '../aws.service';
import type { GcpService } from '../gcp.service';
import type { SlackService } from '../slack.service';
import type { SetupTokenService } from '../setup-token.service';
import type { AuthContext } from '../../auth/types';

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    organizationId: 'org-1',
    roles: ['ADMIN'],
    ...overrides,
  } as AuthContext;
}

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    provider: 'gcp',
    credentialType: 'service_account',
    accessToken: { ciphertext: 'ct', iv: 'iv', authTag: 'at', keyId: 'k' },
    tokenType: 'Bearer',
    displayName: 'Prod GCP',
    organizationId: 'org-1',
    metadata: {
      defaultProjectId: 'project-1',
      organizationId: '123456789012',
      clientEmail: 'svc@example.iam.gserviceaccount.com',
      serviceAccountUniqueId: 'uid-1',
      discoveredResources: [{ id: 'project-1' }],
    },
    naturalKey: 'uid-1::123456789012::project-1',
    ...overrides,
  };
}

function createService(opts: {
  findById?: ReturnType<typeof mock>;
  findConnectionByNaturalKey?: ReturnType<typeof mock>;
  upsertConnection?: ReturnType<typeof mock>;
  updateConnectionHealth?: ReturnType<typeof mock>;
  decrypt?: ReturnType<typeof mock>;
  validateServiceAccount?: ReturnType<typeof mock>;
  discoverProjects?: ReturnType<typeof mock>;
  listGcpServiceAccountConnections?: ReturnType<typeof mock>;
}) {
  const repository = {
    findById: opts.findById ?? mock(() => Promise.resolve(null)),
    findConnectionByNaturalKey:
      opts.findConnectionByNaturalKey ?? mock(() => Promise.resolve(undefined)),
    upsertConnection:
      opts.upsertConnection ?? mock(() => Promise.resolve(makeRecord({ displayName: 'Prod GCP' }))),
    updateConnectionHealth: opts.updateConnectionHealth ?? mock(() => Promise.resolve()),
    updateLastUsedAt: mock(() => Promise.resolve()),
    listProviderConfigs: mock(() => Promise.resolve([])),
    listConnections: mock(() => Promise.resolve([])),
    listConnectionsByOrg: mock(() => Promise.resolve([])),
    listGcpServiceAccountConnections:
      opts.listGcpServiceAccountConnections ?? mock(() => Promise.resolve([])),
    deleteProviderConfig: mock(() => Promise.resolve()),
    upsertProviderConfig: mock(() => Promise.resolve({})),
  } as unknown as IntegrationsRepository;

  const encryption = {
    encrypt: mock((value: string) => Promise.resolve({ ciphertext: value } as any)),
    decrypt:
      opts.decrypt ??
      mock(() =>
        Promise.resolve('{"targetServiceAccountEmail":"svc@example.iam.gserviceaccount.com"}'),
      ),
  } as unknown as TokenEncryptionService;

  const awsService = {
    assumeRoleWithPlatformIdentity: mock(() =>
      Promise.resolve({ accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN' }),
    ),
  } as unknown as AwsService;

  const gcpService = {
    validateServiceAccount:
      opts.validateServiceAccount ??
      mock(() =>
        Promise.resolve({
          serviceAccountEmail: 'svc@example.iam.gserviceaccount.com',
          serviceAccountUniqueId: 'uid-1',
          defaultProjectId: 'project-1',
          organizationId: '123456789012',
          projects: [{ id: 'project-1', displayName: 'Project 1', type: 'project' as const }],
        }),
      ),
    discoverProjects:
      opts.discoverProjects ??
      mock(() =>
        Promise.resolve([{ id: 'project-1', displayName: 'Project 1', type: 'project' as const }]),
      ),
  } as unknown as GcpService;

  return new IntegrationsService(
    repository,
    encryption,
    awsService,
    gcpService,
    {} as SlackService,
    {} as SetupTokenService,
    new EventEmitter2(),
    {} as any,
  );
}

describe('gcp integration foundation', () => {
  it('redacts gcp metadata from public connection responses', async () => {
    const service = createService({
      findById: mock(() => Promise.resolve(makeRecord())),
    });

    const connection = await service.validateGcpConnection('conn-1');
    expect(connection.valid).toBe(true);

    const resolved = await service.resolveConnectionCredentials('conn-1');
    expect(resolved.provider).toBe('gcp');
    expect(resolved.data).toHaveProperty('targetServiceAccountEmail');
  });

  it('persists refreshed gcp credentials when reconnecting the same service account scope', async () => {
    const updates: any[] = [];
    const service = createService({
      findConnectionByNaturalKey: mock(() =>
        Promise.resolve(makeRecord({ displayName: 'Prod GCP' })),
      ),
      upsertConnection: mock((input: any) => {
        updates.push(input);
        return Promise.resolve(
          makeRecord({ accessToken: input.accessToken, metadata: input.metadata }),
        );
      }),
    });

    const result = await service.createGcpConnection(makeAuth(), {
      displayName: 'Renamed GCP Connection',
      targetServiceAccountEmail: 'svc2@example.iam.gserviceaccount.com',
    } as any);

    expect(result.provider).toBe('gcp');
    expect(updates.length).toBe(1);
    expect(updates[0].accessToken.ciphertext).toContain('svc2@example.iam.gserviceaccount.com');
    expect(updates[0].displayName).toBe('Renamed GCP Connection');
    expect(updates[0].naturalKey).toBe('uid-1::123456789012::project-1');
  });

  it('creates a distinct GCP connection when the service account scope is new', async () => {
    const upserts: any[] = [];
    const service = createService({
      findConnectionByNaturalKey: mock(() => Promise.resolve(undefined)),
      upsertConnection: mock((input: any) => {
        upserts.push(input);
        return Promise.resolve(
          makeRecord({
            id: 'conn-2',
            displayName: input.displayName,
            accessToken: input.accessToken,
            metadata: input.metadata,
          }),
        );
      }),
    });

    const result = await service.createGcpConnection(makeAuth(), {
      displayName: 'Sandbox GCP',
      targetServiceAccountEmail: 'sandbox@example.iam.gserviceaccount.com',
    } as any);

    expect(result.id).toBe('conn-2');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].displayName).toBe('Sandbox GCP');
    expect(upserts[0].naturalKey).toBe('uid-1::123456789012::project-1');
  });

  it('creates a distinct GCP connection when the display name is reused for a different scope', async () => {
    const upserts: any[] = [];
    const service = createService({
      findConnectionByNaturalKey: mock(() => Promise.resolve(undefined)),
      validateServiceAccount: mock(() =>
        Promise.resolve({
          serviceAccountEmail: 'other@example.iam.gserviceaccount.com',
          serviceAccountUniqueId: 'uid-2',
          defaultProjectId: 'project-2',
          organizationId: '123456789012',
          projects: [{ id: 'project-2', displayName: 'Project 2', type: 'project' as const }],
        }),
      ),
      upsertConnection: mock((input: any) => {
        upserts.push(input);
        return Promise.resolve(makeRecord({ id: 'conn-3', metadata: input.metadata }));
      }),
    });

    await service.createGcpConnection(makeAuth(), {
      displayName: 'Prod GCP',
      targetServiceAccountEmail: 'other@example.iam.gserviceaccount.com',
    } as any);

    expect(upserts).toHaveLength(1);
    expect(upserts[0].naturalKey).toBe('uid-2::123456789012::project-2');
  });

  it('rejects GCP connections whose discovered scope is already linked to another org', async () => {
    const service = createService({
      listGcpServiceAccountConnections: mock(() =>
        Promise.resolve([
          makeRecord({
            id: 'conn-other-org',
            organizationId: 'org-2',
            metadata: {
              defaultProjectId: 'shared-project',
              organizationId: null,
              discoveredResources: [{ id: 'shared-project' }],
            },
          }),
        ]),
      ),
      validateServiceAccount: mock(() =>
        Promise.resolve({
          serviceAccountEmail: 'svc@example.iam.gserviceaccount.com',
          serviceAccountUniqueId: 'uid-1',
          defaultProjectId: 'shared-project',
          organizationId: null,
          projects: [{ id: 'shared-project', displayName: 'Shared', type: 'project' as const }],
        }),
      ),
    });

    await expect(
      service.createGcpConnection(makeAuth(), {
        displayName: 'Prod GCP',
        targetServiceAccountEmail: 'svc@example.iam.gserviceaccount.com',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns typed discovered resources for gcp projects', async () => {
    const service = createService({
      findById: mock(() => Promise.resolve(makeRecord())),
    });

    const result = await service.discoverGcpProjects('conn-1');
    expect(result.resources[0]?.type).toBe('project');
  });

  it('returns a typed validation payload for gcp connections', async () => {
    const service = createService({
      findById: mock(() => Promise.resolve(makeRecord())),
    });

    const result = await service.validateGcpConnection('conn-1');

    expect(result.valid).toBe(true);
    expect(result.serviceAccountEmail).toBe('svc@example.iam.gserviceaccount.com');
    expect(result.projects?.[0]?.displayName).toBe('Project 1');
  });
});

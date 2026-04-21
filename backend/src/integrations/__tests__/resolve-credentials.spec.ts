import { describe, expect, it, mock } from 'bun:test';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { IntegrationsService } from '../integrations.service';
import type { IntegrationsRepository } from '../integrations.repository';
import type { TokenEncryptionService } from '../token.encryption';
import type { AwsService } from '../aws.service';
import type { SlackService } from '../slack.service';
import type { GcpService } from '../gcp.service';
import type { SetupTokenService } from '../setup-token.service';

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function makeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    provider: 'aws',
    credentialType: 'iam_role',
    accessToken: { ciphertext: 'ct', iv: 'iv', authTag: 'at', keyId: 'k' },
    tokenType: null,
    displayName: 'Test Connection',
    ...overrides,
  };
}

function createService(opts: {
  findById?: ReturnType<typeof mock>;
  decrypt?: ReturnType<typeof mock>;
  assumeRole?: ReturnType<typeof mock>;
}) {
  const repository = {
    findById: opts.findById ?? mock(() => Promise.resolve(null)),
    updateLastUsedAt: mock(() => Promise.resolve()),
  } as unknown as IntegrationsRepository;

  const encryption = {
    decrypt: opts.decrypt ?? mock(() => Promise.resolve('{}')),
  } as unknown as TokenEncryptionService;

  const awsService = {
    assumeRoleWithPlatformIdentity:
      opts.assumeRole ??
      mock(() =>
        Promise.resolve({
          accessKeyId: 'AKID',
          secretAccessKey: 'SECRET',
          sessionToken: 'TOKEN',
        }),
      ),
  } as unknown as AwsService;

  const gcpService = {
    validateServiceAccount: mock(() =>
      Promise.resolve({
        serviceAccountEmail: 'svc@example.iam.gserviceaccount.com',
        serviceAccountUniqueId: '1234567890',
        defaultProjectId: 'project-1',
        organizationId: 'org-1',
        projects: [
          {
            id: 'project-1',
            displayName: 'Project 1',
            type: 'project',
          },
        ],
      }),
    ),
    discoverProjects: mock(() =>
      Promise.resolve([
        {
          id: 'project-1',
          displayName: 'Project 1',
          type: 'project',
        },
      ]),
    ),
  } as unknown as GcpService;

  const slackService = {} as SlackService;
  const setupTokenService = {} as SetupTokenService;
  const eventEmitter = new EventEmitter2();

  return new IntegrationsService(
    repository,
    encryption,
    awsService,
    gcpService,
    slackService,
    setupTokenService,
    eventEmitter,
  );
}

/* -------------------------------------------------------------------------- */
/*  Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('resolveConnectionCredentials', () => {
  describe('connection not found', () => {
    it('throws NotFoundException (404) when connection does not exist', async () => {
      const service = createService({
        findById: mock(() => Promise.resolve(null)),
      });

      expect(service.resolveConnectionCredentials('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('decryption failure', () => {
    it('throws UnprocessableEntityException (422) when decryption fails', async () => {
      const service = createService({
        findById: mock(() => Promise.resolve(makeRecord())),
        decrypt: mock(() => Promise.reject(new Error('OperationError'))),
      });

      expect(service.resolveConnectionCredentials('conn-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('malformed JSON', () => {
    it('throws UnprocessableEntityException (422) when decrypted data is not valid JSON', async () => {
      const service = createService({
        findById: mock(() => Promise.resolve(makeRecord())),
        decrypt: mock(() => Promise.resolve('not-json')),
      });

      expect(service.resolveConnectionCredentials('conn-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('IAM role assumption — deterministic errors', () => {
    it.each([
      'AccessDenied',
      'AccessDeniedException',
      'InvalidIdentityToken',
      'MalformedPolicyDocument',
    ])('throws UnprocessableEntityException (422) for %s', async (errorName) => {
      const awsError = new Error('not authorized');
      (awsError as any).name = errorName;

      const service = createService({
        findById: mock(() => Promise.resolve(makeRecord())),
        decrypt: mock(() =>
          Promise.resolve(
            JSON.stringify({ roleArn: 'arn:aws:iam::123:role/R', externalId: 'ext' }),
          ),
        ),
        assumeRole: mock(() => Promise.reject(awsError)),
      });

      expect(service.resolveConnectionCredentials('conn-1')).rejects.toThrow(
        UnprocessableEntityException,
      );
    });
  });

  describe('IAM role assumption — transient errors', () => {
    it.each([
      'Throttling',
      'ThrottlingException',
      'ServiceUnavailable',
      'ServiceUnavailableException',
    ])('re-throws %s as-is (500) so worker can retry', async (errorName) => {
      const awsError = new Error('transient');
      (awsError as any).name = errorName;

      const service = createService({
        findById: mock(() => Promise.resolve(makeRecord())),
        decrypt: mock(() =>
          Promise.resolve(
            JSON.stringify({ roleArn: 'arn:aws:iam::123:role/R', externalId: 'ext' }),
          ),
        ),
        assumeRole: mock(() => Promise.reject(awsError)),
      });

      try {
        await service.resolveConnectionCredentials('conn-1');
        expect(true).toBe(false); // should not reach
      } catch (error: any) {
        // Should NOT be UnprocessableEntityException — it should be the original error
        expect(error).not.toBeInstanceOf(UnprocessableEntityException);
        expect(error.name).toBe(errorName);
      }
    });
  });

  describe('IAM role assumption — unknown errors', () => {
    it('re-throws unknown errors as-is (500) so worker can retry', async () => {
      const unknownError = new Error('something unexpected');
      (unknownError as any).name = 'SomeNewAwsError';

      const service = createService({
        findById: mock(() => Promise.resolve(makeRecord())),
        decrypt: mock(() =>
          Promise.resolve(
            JSON.stringify({ roleArn: 'arn:aws:iam::123:role/R', externalId: 'ext' }),
          ),
        ),
        assumeRole: mock(() => Promise.reject(unknownError)),
      });

      try {
        await service.resolveConnectionCredentials('conn-1');
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error).not.toBeInstanceOf(UnprocessableEntityException);
        expect(error.name).toBe('SomeNewAwsError');
      }
    });
  });

  describe('successful resolution', () => {
    it('returns resolved credentials for iam_role', async () => {
      const service = createService({
        findById: mock(() => Promise.resolve(makeRecord())),
        decrypt: mock(() =>
          Promise.resolve(
            JSON.stringify({
              roleArn: 'arn:aws:iam::123456789012:role/TestRole',
              externalId: 'ext-123',
              region: 'us-east-1',
            }),
          ),
        ),
        assumeRole: mock(() =>
          Promise.resolve({
            accessKeyId: 'AKID',
            secretAccessKey: 'SECRET',
            sessionToken: 'TOKEN',
          }),
        ),
      });

      const result = await service.resolveConnectionCredentials('conn-1');
      expect(result.credentialType).toBe('iam_role');
      expect(result.provider).toBe('aws');
      expect(result.data).toEqual({
        accessKeyId: 'AKID',
        secretAccessKey: 'SECRET',
        sessionToken: 'TOKEN',
        region: 'us-east-1',
      });
      expect(result.accountId).toBe('123456789012');
      expect(result.region).toBe('us-east-1');
    });

    it('returns resolved credentials for gcp service accounts', async () => {
      const service = createService({
        findById: mock(() =>
          Promise.resolve(
            makeRecord({
              provider: 'gcp',
              credentialType: 'service_account',
              metadata: {
                defaultProjectId: 'project-1',
                organizationId: 'org-1',
                clientEmail: 'svc@example.iam.gserviceaccount.com',
              },
            }),
          ),
        ),
        decrypt: mock(() =>
          Promise.resolve('{"targetServiceAccountEmail":"svc@example.iam.gserviceaccount.com"}'),
        ),
      });

      const result = await service.resolveConnectionCredentials('conn-1');

      expect(result.credentialType).toBe('service_account');
      expect(result.provider).toBe('gcp');
      expect(result.accountId).toBe('org-1');
      expect(result.data).toEqual({
        targetServiceAccountEmail: 'svc@example.iam.gserviceaccount.com',
        defaultProjectId: 'project-1',
        organizationId: 'org-1',
        clientEmail: 'svc@example.iam.gserviceaccount.com',
      });
    });
  });
});

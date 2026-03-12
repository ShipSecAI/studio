import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { AwsService } from '../aws.service';

const REGION_ENV_KEYS = ['SHIPSEC_AWS_REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION'] as const;

function clearRegionEnv() {
  delete process.env.SHIPSEC_AWS_REGION;
  delete process.env.AWS_REGION;
  delete process.env.AWS_DEFAULT_REGION;
}

describe('AwsService region resolution', () => {
  let originalEnv: Record<(typeof REGION_ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    originalEnv = {
      SHIPSEC_AWS_REGION: process.env.SHIPSEC_AWS_REGION,
      AWS_REGION: process.env.AWS_REGION,
      AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION,
    };
    clearRegionEnv();
  });

  afterEach(() => {
    clearRegionEnv();
    for (const key of REGION_ENV_KEYS) {
      const value = originalEnv[key];
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
  });

  it('defaults to us-east-1 when no region is provided', async () => {
    const service = new AwsService();
    const client = (service as any).getBootstrapStsClient();
    expect(await client.config.region()).toBe('us-east-1');
  });

  it('uses SHIPSEC_AWS_REGION when request region is omitted', async () => {
    process.env.SHIPSEC_AWS_REGION = 'ap-south-1';
    process.env.AWS_REGION = 'eu-west-1';
    process.env.AWS_DEFAULT_REGION = 'us-west-2';

    const service = new AwsService();
    const client = (service as any).getBootstrapStsClient();
    expect(await client.config.region()).toBe('ap-south-1');
  });

  it('prefers explicit region over environment defaults', async () => {
    process.env.AWS_REGION = 'eu-west-1';

    const service = new AwsService();
    const client = (service as any).getBootstrapStsClient('us-west-2');
    expect(await client.config.region()).toBe('us-west-2');
  });
});

describe('AwsService platform session caching', () => {
  const PLATFORM_ARN = 'arn:aws:iam::123456789012:role/ShipSec-Studio-Access';
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      SHIPSEC_PLATFORM_ROLE_ARN: process.env.SHIPSEC_PLATFORM_ROLE_ARN,
      SHIPSEC_AWS_ACCESS_KEY_ID: process.env.SHIPSEC_AWS_ACCESS_KEY_ID,
      SHIPSEC_AWS_SECRET_ACCESS_KEY: process.env.SHIPSEC_AWS_SECRET_ACCESS_KEY,
      SHIPSEC_AWS_SESSION_TOKEN: process.env.SHIPSEC_AWS_SESSION_TOKEN,
      AWS_REGION: process.env.AWS_REGION,
    };
    process.env.SHIPSEC_PLATFORM_ROLE_ARN = PLATFORM_ARN;
    process.env.AWS_REGION = 'us-east-1';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  it('returns cached credentials when still valid', async () => {
    const service = new AwsService();
    const fakeCreds = {
      accessKeyId: 'AKID',
      secretAccessKey: 'SECRET',
      sessionToken: 'TOKEN',
    };

    // Pre-populate the cache with credentials that expire in 30 minutes
    (service as any).platformSession = {
      credentials: fakeCreds,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };

    const result = await (service as any).getPlatformSessionCredentials();
    expect(result).toEqual(fakeCreds);
  });

  it('refreshes credentials when cache is within 5 minutes of expiry', async () => {
    const service = new AwsService();
    const staleCreds = {
      accessKeyId: 'OLD',
      secretAccessKey: 'OLD_SECRET',
      sessionToken: 'OLD_TOKEN',
    };

    // Cache with credentials expiring in 2 minutes (within buffer)
    (service as any).platformSession = {
      credentials: staleCreds,
      expiresAt: new Date(Date.now() + 2 * 60 * 1000),
    };

    const freshCreds = {
      AccessKeyId: 'NEW',
      SecretAccessKey: 'NEW_SECRET',
      SessionToken: 'NEW_TOKEN',
      Expiration: new Date(Date.now() + 60 * 60 * 1000),
    };

    // Mock the bootstrap client's send method
    const mockSend = mock(() => Promise.resolve({ Credentials: freshCreds }));
    (service as any).getBootstrapStsClient = () => ({ send: mockSend });

    const result = await (service as any).getPlatformSessionCredentials();
    expect(result.accessKeyId).toBe('NEW');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent calls into a single AssumeRole request', async () => {
    const service = new AwsService();

    const freshCreds = {
      AccessKeyId: 'CONCURRENT',
      SecretAccessKey: 'SECRET',
      SessionToken: 'TOKEN',
      Expiration: new Date(Date.now() + 60 * 60 * 1000),
    };

    const mockSend = mock(() => Promise.resolve({ Credentials: freshCreds }));
    (service as any).getBootstrapStsClient = () => ({ send: mockSend });

    // Fire 3 concurrent calls
    const [r1, r2, r3] = await Promise.all([
      (service as any).getPlatformSessionCredentials(),
      (service as any).getPlatformSessionCredentials(),
      (service as any).getPlatformSessionCredentials(),
    ]);

    expect(r1.accessKeyId).toBe('CONCURRENT');
    expect(r2.accessKeyId).toBe('CONCURRENT');
    expect(r3.accessKeyId).toBe('CONCURRENT');
    // Only one actual STS call should have been made
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('wraps AccessDenied errors with actionable message', async () => {
    const service = new AwsService();

    const accessDeniedError = new Error('not authorized');
    (accessDeniedError as any).name = 'AccessDeniedException';

    (service as any).getBootstrapStsClient = () => ({
      send: () => Promise.reject(accessDeniedError),
    });

    try {
      await (service as any).getPlatformSessionCredentials();
      expect(true).toBe(false); // should not reach
    } catch (error: any) {
      expect(error.message).toContain('Platform role assumption failed');
      expect(error.message).toContain('Grant sts:AssumeRole');
      expect(error.message).toContain(PLATFORM_ARN);
    }
  });
});

describe('AwsService startup verification', () => {
  const PLATFORM_ARN = 'arn:aws:iam::123456789012:role/ShipSec-Studio-Access';
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      SHIPSEC_PLATFORM_ROLE_ARN: process.env.SHIPSEC_PLATFORM_ROLE_ARN,
      SHIPSEC_AWS_STRICT_IDENTITY_CHECK: process.env.SHIPSEC_AWS_STRICT_IDENTITY_CHECK,
    };
    process.env.SHIPSEC_PLATFORM_ROLE_ARN = PLATFORM_ARN;
    process.env.SHIPSEC_AWS_STRICT_IDENTITY_CHECK = 'false';
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  it('continues startup when strict identity checks are disabled and credentials are unavailable', async () => {
    const service = new AwsService();
    const warnSpy = mock(() => {});
    (service as any).logger = { warn: warnSpy, log: mock(() => {}), error: mock(() => {}) };
    (service as any).getBootstrapStsClient = () => ({
      send: () =>
        Promise.reject(
          Object.assign(new Error('Could not load credentials from any providers'), {
            name: 'CredentialsProviderError',
          }),
        ),
    });

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AwsService bootstrapIsPlatformRole fast path', () => {
  it('uses bootstrap client directly when identity already matches', async () => {
    const service = new AwsService();
    (service as any).bootstrapIsPlatformRole = true;

    process.env.AWS_REGION = 'us-east-1';

    const client = await (service as any).getPlatformStsClient('us-east-1');
    // Should return a regular STSClient (not session-backed), verify by checking region
    expect(await client.config.region()).toBe('us-east-1');
  });
});

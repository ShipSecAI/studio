import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

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
    const client = (service as any).getPlatformStsClient();
    expect(await client.config.region()).toBe('us-east-1');
  });

  it('uses SHIPSEC_AWS_REGION when request region is omitted', async () => {
    process.env.SHIPSEC_AWS_REGION = 'ap-south-1';
    process.env.AWS_REGION = 'eu-west-1';
    process.env.AWS_DEFAULT_REGION = 'us-west-2';

    const service = new AwsService();
    const client = (service as any).getPlatformStsClient();
    expect(await client.config.region()).toBe('ap-south-1');
  });

  it('prefers explicit region over environment defaults', async () => {
    process.env.AWS_REGION = 'eu-west-1';

    const service = new AwsService();
    const client = (service as any).getPlatformStsClient('us-west-2');
    expect(await client.config.region()).toBe('us-west-2');
  });
});

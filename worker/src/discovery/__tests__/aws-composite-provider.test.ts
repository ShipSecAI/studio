import { describe, it, expect } from 'bun:test';
import { AwsCompositeProvider } from '../aws-composite-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import type { DiscoveryContext } from '../discovery-provider';

function makeContext(overrides?: Partial<DiscoveryContext>): DiscoveryContext {
  return {
    integrationId: 'int-1',
    organizationId: 'org-1',
    credentials: {
      accessKeyId: 'AKID',
      secretAccessKey: 'SECRET',
    },
    accountIdentifier: '123456789012',
    regions: ['us-east-1', 'us-west-2'],
    ...overrides,
  };
}

function makeMockProvider(serviceId: string, pages: ServiceDiscoveryPage[]): AwsServiceProvider {
  let callIndex = 0;
  return {
    serviceId,
    assetTypes: [`${serviceId}_resource`],
    isGlobal: false,
    discover: async (_ctx: DiscoveryContext, cursor?: string): Promise<ServiceDiscoveryPage> => {
      // If cursor is provided, it means we're continuing from a previous page
      const idx = cursor ? parseInt(cursor, 10) : callIndex++;
      if (idx >= pages.length) {
        return { assets: [], scannedScopes: [] };
      }
      return pages[idx];
    },
  };
}

function makeAccessDeniedProvider(serviceId: string): AwsServiceProvider {
  return {
    serviceId,
    assetTypes: [`${serviceId}_resource`],
    isGlobal: false,
    discover: async () => {
      const err = new Error('AccessDenied');
      (err as any).name = 'AccessDeniedException';
      throw err;
    },
  };
}

describe('AwsCompositeProvider', () => {
  it('discovers assets from multiple service providers', async () => {
    const composite = new AwsCompositeProvider();
    composite.registerService(
      makeMockProvider('svc1', [
        {
          assets: [{ assetType: 'svc1_resource', externalId: 'arn:1', name: 'res1', metadata: {} }],
          scannedScopes: [{ assetType: 'svc1_resource', region: 'us-east-1' }],
        },
      ]),
    );
    composite.registerService(
      makeMockProvider('svc2', [
        {
          assets: [{ assetType: 'svc2_resource', externalId: 'arn:2', name: 'res2', metadata: {} }],
          scannedScopes: [{ assetType: 'svc2_resource', region: 'us-east-1' }],
        },
      ]),
    );

    const ctx = makeContext();
    const result = await composite.discover(ctx);

    expect(result.assets).toHaveLength(2);
    expect(result.assets[0].assetType).toBe('svc1_resource');
    expect(result.assets[1].assetType).toBe('svc2_resource');
    expect(result.nextCursor).toBeUndefined();
    expect(result.scannedScopes).toHaveLength(2);
  });

  it('aggregates assetTypes from all registered services', () => {
    const composite = new AwsCompositeProvider();
    composite.registerService(makeMockProvider('svc1', [{ assets: [], scannedScopes: [] }]));
    composite.registerService(makeMockProvider('svc2', [{ assets: [], scannedScopes: [] }]));

    expect(composite.assetTypes).toEqual(['svc1_resource', 'svc2_resource']);
  });

  it('skips AccessDenied services without adding scopes', async () => {
    const composite = new AwsCompositeProvider();
    composite.registerService(makeAccessDeniedProvider('denied'));
    composite.registerService(
      makeMockProvider('allowed', [
        {
          assets: [
            { assetType: 'allowed_resource', externalId: 'arn:ok', name: 'ok', metadata: {} },
          ],
          scannedScopes: [{ assetType: 'allowed_resource', region: 'us-east-1' }],
        },
      ]),
    );

    const ctx = makeContext();
    const result = await composite.discover(ctx);

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].assetType).toBe('allowed_resource');
    // Only the allowed service's scopes should be present
    expect(result.scannedScopes).toHaveLength(1);
    expect(result.scannedScopes![0].assetType).toBe('allowed_resource');
  });

  it('propagates non-AccessDenied errors', async () => {
    const composite = new AwsCompositeProvider();
    composite.registerService({
      serviceId: 'broken',
      assetTypes: ['broken_resource'],
      isGlobal: false,
      discover: async () => {
        throw new Error('InternalServerError');
      },
    });

    const ctx = makeContext();
    await expect(composite.discover(ctx)).rejects.toThrow('InternalServerError');
  });

  it('returns composite cursor when service has more pages', async () => {
    const composite = new AwsCompositeProvider();
    composite.registerService(
      makeMockProvider('paged', [
        {
          assets: [{ assetType: 'paged_resource', externalId: 'arn:p1', name: 'p1', metadata: {} }],
          nextCursor: '1',
          scannedScopes: [{ assetType: 'paged_resource', region: 'us-east-1' }],
        },
      ]),
    );
    composite.registerService(
      makeMockProvider('second', [
        {
          assets: [
            { assetType: 'second_resource', externalId: 'arn:s1', name: 's1', metadata: {} },
          ],
          scannedScopes: [{ assetType: 'second_resource', region: 'us-east-1' }],
        },
      ]),
    );

    const ctx = makeContext();
    const result = await composite.discover(ctx);

    // Should return after the first service since it has a next cursor
    expect(result.nextCursor).toBeDefined();
    const cursor = JSON.parse(result.nextCursor!);
    expect(cursor.serviceIndex).toBe(0);
    expect(cursor.serviceCursor).toBe('1');
  });

  it('returns empty page when no services registered', async () => {
    const composite = new AwsCompositeProvider();
    const ctx = makeContext();
    const result = await composite.discover(ctx);

    expect(result.assets).toHaveLength(0);
    expect(result.nextCursor).toBeUndefined();
    expect(result.scannedScopes).toHaveLength(0);
  });

  it('merges coveredRegions from all services', async () => {
    const composite = new AwsCompositeProvider();
    composite.registerService(
      makeMockProvider('svc1', [
        {
          assets: [{ assetType: 'svc1_resource', externalId: 'arn:1', name: 'r1', metadata: {} }],
          scannedScopes: [
            { assetType: 'svc1_resource', region: 'us-east-1' },
            { assetType: 'svc1_resource', region: 'eu-west-1' },
          ],
        },
      ]),
    );
    composite.registerService(
      makeMockProvider('svc2', [
        {
          assets: [{ assetType: 'svc2_resource', externalId: 'arn:2', name: 'r2', metadata: {} }],
          scannedScopes: [
            { assetType: 'svc2_resource', region: 'us-east-1' },
            { assetType: 'svc2_resource', region: 'ap-southeast-1' },
          ],
        },
      ]),
    );

    const ctx = makeContext();
    const result = await composite.discover(ctx);

    expect(result.coveredRegions.sort()).toEqual(['ap-southeast-1', 'eu-west-1', 'us-east-1']);
  });
});

import {
  KMSClient,
  ListKeysCommand,
  DescribeKeyCommand,
  type KeyListEntry,
} from '@aws-sdk/client-kms';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, isAccessDenied } from './aws-utils';

interface KmsCursor {
  regionIndex: number;
  marker?: string;
}

const PAGE_SIZE = 100;

export class KmsServiceProvider implements AwsServiceProvider {
  serviceId = 'kms';
  assetTypes = ['kms_key'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: KmsCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, marker } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];
      const client = new KMSClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        const result = await withRetry(() =>
          client.send(new ListKeysCommand({ Limit: 1000, Marker: marker })),
        );

        for (const key of result.Keys ?? []) {
          const asset = await this.enrichKey(client, key, region);
          if (asset) assets.push(asset);
        }

        if (result.NextMarker && result.Truncated) {
          if (assets.length >= PAGE_SIZE) {
            return {
              assets,
              nextCursor: JSON.stringify({
                regionIndex,
                marker: result.NextMarker,
              } satisfies KmsCursor),
              scannedScopes,
            };
          }
          marker = result.NextMarker;
          continue;
        }

        scannedScopes.push({ assetType: 'kms_key', region });
        regionIndex++;
        marker = undefined;
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done ? undefined : JSON.stringify({ regionIndex, marker } satisfies KmsCursor),
      scannedScopes,
    };
  }

  private async enrichKey(
    client: KMSClient,
    key: KeyListEntry,
    region: string,
  ): Promise<DiscoveredAsset | null> {
    try {
      const desc = await withRetry(() =>
        client.send(new DescribeKeyCommand({ KeyId: key.KeyId! })),
      );
      const meta = desc.KeyMetadata!;

      // Skip AWS-managed keys
      if (meta.KeyManager === 'AWS') return null;

      return {
        assetType: 'kms_key',
        externalId: meta.Arn!,
        name: meta.KeyId!,
        region,
        metadata: {
          description: meta.Description,
          keyState: meta.KeyState,
          keyUsage: meta.KeyUsage,
          keySpec: meta.KeySpec,
          origin: meta.Origin,
          keyManager: meta.KeyManager,
          multiRegion: meta.MultiRegion,
          creationDate: meta.CreationDate?.toISOString(),
          enabled: meta.Enabled,
          expirationModel: meta.ExpirationModel,
        },
      };
    } catch (e) {
      if (isAccessDenied(e)) return null;
      throw e;
    }
  }
}

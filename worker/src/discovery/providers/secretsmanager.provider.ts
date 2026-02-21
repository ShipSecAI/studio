import {
  SecretsManagerClient,
  ListSecretsCommand,
  type SecretListEntry,
} from '@aws-sdk/client-secrets-manager';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry } from './aws-utils';

interface SmCursor {
  regionIndex: number;
  nextToken?: string;
}

const PAGE_SIZE = 100;

export class SecretsManagerServiceProvider implements AwsServiceProvider {
  serviceId = 'secretsmanager';
  assetTypes = ['secretsmanager_secret'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: SmCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, nextToken } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];
      const client = new SecretsManagerClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        const result = await withRetry(() =>
          client.send(new ListSecretsCommand({ MaxResults: PAGE_SIZE, NextToken: nextToken })),
        );

        for (const secret of result.SecretList ?? []) {
          assets.push(this.mapSecret(secret, region));
        }

        if (result.NextToken && assets.length >= PAGE_SIZE) {
          return {
            assets,
            nextCursor: JSON.stringify({
              regionIndex,
              nextToken: result.NextToken,
            } satisfies SmCursor),
            scannedScopes,
          };
        }

        if (result.NextToken) {
          nextToken = result.NextToken;
          continue;
        }

        scannedScopes.push({ assetType: 'secretsmanager_secret', region });
        regionIndex++;
        nextToken = undefined;
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done ? undefined : JSON.stringify({ regionIndex, nextToken } satisfies SmCursor),
      scannedScopes,
    };
  }

  private mapSecret(secret: SecretListEntry, region: string): DiscoveredAsset {
    return {
      assetType: 'secretsmanager_secret',
      externalId: secret.ARN!,
      name: secret.Name!,
      region,
      metadata: {
        description: secret.Description,
        kmsKeyId: secret.KmsKeyId,
        rotationEnabled: secret.RotationEnabled,
        rotationLambdaARN: secret.RotationLambdaARN,
        lastRotatedDate: secret.LastRotatedDate?.toISOString(),
        lastAccessedDate: secret.LastAccessedDate?.toISOString(),
        lastChangedDate: secret.LastChangedDate?.toISOString(),
        tags: secret.Tags?.map((t) => ({ key: t.Key, value: t.Value })),
      },
    };
  }
}

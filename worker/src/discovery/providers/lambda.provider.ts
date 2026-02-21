import {
  LambdaClient,
  ListFunctionsCommand,
  type FunctionConfiguration,
} from '@aws-sdk/client-lambda';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry } from './aws-utils';

interface LambdaCursor {
  regionIndex: number;
  marker?: string;
}

const PAGE_SIZE = 100;

export class LambdaServiceProvider implements AwsServiceProvider {
  serviceId = 'lambda';
  assetTypes = ['lambda_function'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: LambdaCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, marker } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];

      const client = new LambdaClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        const result = await withRetry(() =>
          client.send(new ListFunctionsCommand({ MaxItems: PAGE_SIZE, Marker: marker })),
        );

        for (const fn of result.Functions ?? []) {
          assets.push(this.mapFunction(fn, region));
        }

        if (result.NextMarker && assets.length >= PAGE_SIZE) {
          return {
            assets,
            nextCursor: JSON.stringify({
              regionIndex,
              marker: result.NextMarker,
            } satisfies LambdaCursor),
            scannedScopes,
          };
        }

        if (result.NextMarker) {
          marker = result.NextMarker;
          continue;
        }

        scannedScopes.push({ assetType: 'lambda_function', region });
        regionIndex++;
        marker = undefined;
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done ? undefined : JSON.stringify({ regionIndex, marker } satisfies LambdaCursor),
      scannedScopes,
    };
  }

  private mapFunction(fn: FunctionConfiguration, region: string): DiscoveredAsset {
    return {
      assetType: 'lambda_function',
      externalId: fn.FunctionArn!,
      name: fn.FunctionName!,
      region,
      metadata: {
        runtime: fn.Runtime,
        handler: fn.Handler,
        codeSize: fn.CodeSize,
        memorySize: fn.MemorySize,
        timeout: fn.Timeout,
        lastModified: fn.LastModified,
        description: fn.Description,
        role: fn.Role,
        layers: fn.Layers?.map((l) => l.Arn),
        architectures: fn.Architectures,
        ephemeralStorage: fn.EphemeralStorage?.Size,
        packageType: fn.PackageType,
        vpcConfig: fn.VpcConfig
          ? {
              vpcId: fn.VpcConfig.VpcId,
              subnetIds: fn.VpcConfig.SubnetIds,
              securityGroupIds: fn.VpcConfig.SecurityGroupIds,
            }
          : undefined,
      },
    };
  }
}

import { APIGatewayClient, GetRestApisCommand, type RestApi } from '@aws-sdk/client-api-gateway';
import { ApiGatewayV2Client, GetApisCommand, type Api } from '@aws-sdk/client-apigatewayv2';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, isAccessDenied, synthesizeArn } from './aws-utils';

interface ApigwCursor {
  regionIndex: number;
  v1Position?: string;
  v1Done?: boolean;
  v2NextToken?: string;
}

const PAGE_SIZE = 100;

export class ApiGatewayServiceProvider implements AwsServiceProvider {
  serviceId = 'apigateway';
  assetTypes = ['apigateway_rest_api', 'apigateway_http_api'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: ApigwCursor = cursorStr
      ? JSON.parse(cursorStr)
      : { regionIndex: 0, v1Done: false };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, v1Position, v1Done, v2NextToken } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];

      // REST APIs (v1)
      if (!v1Done) {
        const v1Assets = await this.discoverV1(region, context, v1Position);
        assets.push(...v1Assets.assets);

        if (v1Assets.nextPosition && assets.length >= PAGE_SIZE) {
          return {
            assets,
            nextCursor: JSON.stringify({
              regionIndex,
              v1Position: v1Assets.nextPosition,
              v1Done: false,
            } satisfies ApigwCursor),
            scannedScopes,
          };
        }

        if (v1Assets.nextPosition) {
          v1Position = v1Assets.nextPosition;
          continue;
        }

        scannedScopes.push({ assetType: 'apigateway_rest_api', region });
        v1Done = true;
        v1Position = undefined;
      }

      // HTTP APIs (v2)
      const v2Assets = await this.discoverV2(region, context, v2NextToken);
      assets.push(...v2Assets.assets);

      if (v2Assets.nextToken && assets.length >= PAGE_SIZE) {
        return {
          assets,
          nextCursor: JSON.stringify({
            regionIndex,
            v1Done: true,
            v2NextToken: v2Assets.nextToken,
          } satisfies ApigwCursor),
          scannedScopes,
        };
      }

      if (v2Assets.nextToken) {
        v2NextToken = v2Assets.nextToken;
        continue;
      }

      scannedScopes.push({ assetType: 'apigateway_http_api', region });
      regionIndex++;
      v1Done = false;
      v1Position = undefined;
      v2NextToken = undefined;
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done
        ? undefined
        : JSON.stringify({ regionIndex, v1Position, v1Done, v2NextToken } satisfies ApigwCursor),
      scannedScopes,
    };
  }

  private async discoverV1(
    region: string,
    context: DiscoveryContext,
    position?: string,
  ): Promise<{ assets: DiscoveredAsset[]; nextPosition?: string }> {
    const client = new APIGatewayClient({
      region,
      credentials: {
        accessKeyId: context.credentials.accessKeyId,
        secretAccessKey: context.credentials.secretAccessKey,
        sessionToken: context.credentials.sessionToken,
      },
    });

    try {
      const result = await withRetry(() =>
        client.send(new GetRestApisCommand({ limit: 500, position })),
      );

      const assets = (result.items ?? []).map((api) =>
        this.mapRestApi(api, region, context.accountIdentifier),
      );

      return { assets, nextPosition: result.position };
    } catch (e) {
      if (isAccessDenied(e)) return { assets: [] };
      throw e;
    } finally {
      client.destroy();
    }
  }

  private async discoverV2(
    region: string,
    context: DiscoveryContext,
    nextToken?: string,
  ): Promise<{ assets: DiscoveredAsset[]; nextToken?: string }> {
    const client = new ApiGatewayV2Client({
      region,
      credentials: {
        accessKeyId: context.credentials.accessKeyId,
        secretAccessKey: context.credentials.secretAccessKey,
        sessionToken: context.credentials.sessionToken,
      },
    });

    try {
      const result = await withRetry(() =>
        client.send(new GetApisCommand({ MaxResults: '500', NextToken: nextToken })),
      );

      const assets = (result.Items ?? []).map((api) =>
        this.mapHttpApi(api, region, context.accountIdentifier),
      );

      return { assets, nextToken: result.NextToken };
    } catch (e) {
      if (isAccessDenied(e)) return { assets: [] };
      throw e;
    } finally {
      client.destroy();
    }
  }

  private mapRestApi(api: RestApi, region: string, accountId: string): DiscoveredAsset {
    return {
      assetType: 'apigateway_rest_api',
      externalId: synthesizeArn({
        service: 'apigateway',
        region,
        accountId,
        resourceType: 'restapis',
        resourceId: api.id!,
      }),
      name: api.name!,
      region,
      metadata: {
        description: api.description,
        createdDate: api.createdDate?.toISOString(),
        apiKeySource: api.apiKeySource,
        endpointConfiguration: api.endpointConfiguration?.types,
        minimumCompressionSize: api.minimumCompressionSize,
        disableExecuteApiEndpoint: api.disableExecuteApiEndpoint,
      },
    };
  }

  private mapHttpApi(api: Api, region: string, accountId: string): DiscoveredAsset {
    return {
      assetType: 'apigateway_http_api',
      externalId: synthesizeArn({
        service: 'apigateway',
        region,
        accountId,
        resourceType: 'apis',
        resourceId: api.ApiId!,
      }),
      name: api.Name!,
      region,
      metadata: {
        description: api.Description,
        protocolType: api.ProtocolType,
        apiEndpoint: api.ApiEndpoint,
        createdDate: api.CreatedDate?.toISOString(),
        disableExecuteApiEndpoint: api.DisableExecuteApiEndpoint,
        corsConfiguration: api.CorsConfiguration
          ? {
              allowOrigins: api.CorsConfiguration.AllowOrigins,
              allowMethods: api.CorsConfiguration.AllowMethods,
              allowHeaders: api.CorsConfiguration.AllowHeaders,
            }
          : undefined,
      },
    };
  }
}

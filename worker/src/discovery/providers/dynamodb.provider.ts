import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry } from './aws-utils';

interface DdbCursor {
  regionIndex: number;
  lastTableName?: string;
}

const PAGE_SIZE = 100;

export class DynamoDbServiceProvider implements AwsServiceProvider {
  serviceId = 'dynamodb';
  assetTypes = ['dynamodb_table'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: DdbCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, lastTableName } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];
      const client = new DynamoDBClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        const result = await withRetry(() =>
          client.send(
            new ListTablesCommand({
              Limit: PAGE_SIZE,
              ExclusiveStartTableName: lastTableName,
            }),
          ),
        );

        for (const tableName of result.TableNames ?? []) {
          const desc = await withRetry(() =>
            client.send(new DescribeTableCommand({ TableName: tableName })),
          );
          if (desc.Table) {
            assets.push(this.mapTable(desc.Table, region));
          }
        }

        if (result.LastEvaluatedTableName && assets.length >= PAGE_SIZE) {
          return {
            assets,
            nextCursor: JSON.stringify({
              regionIndex,
              lastTableName: result.LastEvaluatedTableName,
            } satisfies DdbCursor),
            scannedScopes,
          };
        }

        if (result.LastEvaluatedTableName) {
          lastTableName = result.LastEvaluatedTableName;
          continue;
        }

        scannedScopes.push({ assetType: 'dynamodb_table', region });
        regionIndex++;
        lastTableName = undefined;
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done
        ? undefined
        : JSON.stringify({ regionIndex, lastTableName } satisfies DdbCursor),
      scannedScopes,
    };
  }

  private mapTable(table: TableDescription, region: string): DiscoveredAsset {
    return {
      assetType: 'dynamodb_table',
      externalId: table.TableArn!,
      name: table.TableName!,
      region,
      metadata: {
        tableStatus: table.TableStatus,
        itemCount: table.ItemCount,
        tableSizeBytes: table.TableSizeBytes,
        billingMode: table.BillingModeSummary?.BillingMode,
        creationDateTime: table.CreationDateTime?.toISOString(),
        keySchema: table.KeySchema?.map((k) => ({
          attributeName: k.AttributeName,
          keyType: k.KeyType,
        })),
        globalSecondaryIndexes: table.GlobalSecondaryIndexes?.map((gsi) => ({
          indexName: gsi.IndexName,
          indexStatus: gsi.IndexStatus,
          itemCount: gsi.ItemCount,
        })),
        streamEnabled: table.StreamSpecification?.StreamEnabled,
        sseDescription: table.SSEDescription
          ? {
              status: table.SSEDescription.Status,
              sseType: table.SSEDescription.SSEType,
              kmsMasterKeyArn: table.SSEDescription.KMSMasterKeyArn,
            }
          : undefined,
        deletionProtectionEnabled: table.DeletionProtectionEnabled,
      },
    };
  }
}

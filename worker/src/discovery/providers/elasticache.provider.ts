import {
  ElastiCacheClient,
  DescribeCacheClustersCommand,
  type CacheCluster,
} from '@aws-sdk/client-elasticache';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, synthesizeArn } from './aws-utils';

interface ElastiCacheCursor {
  regionIndex: number;
  marker?: string;
}

const PAGE_SIZE = 100;

export class ElastiCacheServiceProvider implements AwsServiceProvider {
  serviceId = 'elasticache';
  assetTypes = ['elasticache_cluster'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: ElastiCacheCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, marker } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];
      const client = new ElastiCacheClient({
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
            new DescribeCacheClustersCommand({
              MaxRecords: PAGE_SIZE,
              Marker: marker,
              ShowCacheNodeInfo: true,
            }),
          ),
        );

        for (const cluster of result.CacheClusters ?? []) {
          assets.push(this.mapCluster(cluster, region, context.accountIdentifier));
        }

        if (result.Marker && assets.length >= PAGE_SIZE) {
          return {
            assets,
            nextCursor: JSON.stringify({
              regionIndex,
              marker: result.Marker,
            } satisfies ElastiCacheCursor),
            scannedScopes,
          };
        }

        if (result.Marker) {
          marker = result.Marker;
          continue;
        }

        scannedScopes.push({ assetType: 'elasticache_cluster', region });
        regionIndex++;
        marker = undefined;
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done
        ? undefined
        : JSON.stringify({ regionIndex, marker } satisfies ElastiCacheCursor),
      scannedScopes,
    };
  }

  private mapCluster(cluster: CacheCluster, region: string, accountId: string): DiscoveredAsset {
    return {
      assetType: 'elasticache_cluster',
      externalId:
        cluster.ARN ??
        synthesizeArn({
          service: 'elasticache',
          region,
          accountId,
          resourceType: 'cluster',
          resourceId: cluster.CacheClusterId!,
        }),
      name: cluster.CacheClusterId!,
      region,
      metadata: {
        engine: cluster.Engine,
        engineVersion: cluster.EngineVersion,
        cacheNodeType: cluster.CacheNodeType,
        cacheClusterStatus: cluster.CacheClusterStatus,
        numCacheNodes: cluster.NumCacheNodes,
        preferredAvailabilityZone: cluster.PreferredAvailabilityZone,
        cacheSubnetGroupName: cluster.CacheSubnetGroupName,
        replicationGroupId: cluster.ReplicationGroupId,
        snapshotRetentionLimit: cluster.SnapshotRetentionLimit,
        autoMinorVersionUpgrade: cluster.AutoMinorVersionUpgrade,
        transitEncryptionEnabled: cluster.TransitEncryptionEnabled,
        atRestEncryptionEnabled: cluster.AtRestEncryptionEnabled,
        cacheClusterCreateTime: cluster.CacheClusterCreateTime?.toISOString(),
      },
    };
  }
}

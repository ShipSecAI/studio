import {
  RDSClient,
  DescribeDBInstancesCommand,
  DescribeDBClustersCommand,
  type DBInstance,
  type DBCluster,
} from '@aws-sdk/client-rds';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry } from './aws-utils';

interface RdsCursor {
  regionIndex: number;
  /** 0=instances, 1=clusters */
  phase: number;
  marker?: string;
}

const PAGE_SIZE = 100;

export class RdsServiceProvider implements AwsServiceProvider {
  serviceId = 'rds';
  assetTypes = ['rds_instance', 'rds_cluster'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: RdsCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0, phase: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, phase, marker } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];

      const client = new RDSClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        // Phase 0: DB Instances
        if (phase === 0) {
          const result = await withRetry(() =>
            client.send(new DescribeDBInstancesCommand({ MaxRecords: PAGE_SIZE, Marker: marker })),
          );

          for (const db of result.DBInstances ?? []) {
            assets.push(this.mapInstance(db, region));
          }

          if (result.Marker && assets.length >= PAGE_SIZE) {
            return {
              assets,
              nextCursor: JSON.stringify({ regionIndex, phase: 0, marker: result.Marker }),
              scannedScopes,
            };
          }

          if (!result.Marker) {
            scannedScopes.push({ assetType: 'rds_instance', region });
            phase = 1;
            marker = undefined;
          } else {
            marker = result.Marker;
            continue;
          }
        }

        // Phase 1: DB Clusters (Aurora)
        if (phase === 1 && assets.length < PAGE_SIZE) {
          const result = await withRetry(() =>
            client.send(new DescribeDBClustersCommand({ MaxRecords: PAGE_SIZE, Marker: marker })),
          );

          for (const cluster of result.DBClusters ?? []) {
            assets.push(this.mapCluster(cluster, region));
          }

          if (result.Marker && assets.length >= PAGE_SIZE) {
            return {
              assets,
              nextCursor: JSON.stringify({ regionIndex, phase: 1, marker: result.Marker }),
              scannedScopes,
            };
          }

          scannedScopes.push({ assetType: 'rds_cluster', region });
          regionIndex++;
          phase = 0;
          marker = undefined;
        }
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done ? undefined : JSON.stringify({ regionIndex, phase, marker }),
      scannedScopes,
    };
  }

  private mapInstance(db: DBInstance, region: string): DiscoveredAsset {
    return {
      assetType: 'rds_instance',
      externalId: db.DBInstanceArn!,
      name: db.DBInstanceIdentifier!,
      region,
      metadata: {
        dbInstanceClass: db.DBInstanceClass,
        engine: db.Engine,
        engineVersion: db.EngineVersion,
        status: db.DBInstanceStatus,
        publiclyAccessible: db.PubliclyAccessible,
        storageEncrypted: db.StorageEncrypted,
        kmsKeyId: db.KmsKeyId,
        multiAZ: db.MultiAZ,
        allocatedStorage: db.AllocatedStorage,
        endpoint: db.Endpoint
          ? { address: db.Endpoint.Address, port: db.Endpoint.Port }
          : undefined,
        vpcId: db.DBSubnetGroup?.VpcId,
        securityGroups: db.VpcSecurityGroups?.map((sg) => sg.VpcSecurityGroupId),
        autoMinorVersionUpgrade: db.AutoMinorVersionUpgrade,
        backupRetentionPeriod: db.BackupRetentionPeriod,
        instanceCreateTime: db.InstanceCreateTime?.toISOString(),
      },
    };
  }

  private mapCluster(cluster: DBCluster, region: string): DiscoveredAsset {
    return {
      assetType: 'rds_cluster',
      externalId: cluster.DBClusterArn!,
      name: cluster.DBClusterIdentifier!,
      region,
      metadata: {
        engine: cluster.Engine,
        engineVersion: cluster.EngineVersion,
        status: cluster.Status,
        storageEncrypted: cluster.StorageEncrypted,
        kmsKeyId: cluster.KmsKeyId,
        multiAZ: cluster.MultiAZ,
        endpoint: cluster.Endpoint,
        readerEndpoint: cluster.ReaderEndpoint,
        port: cluster.Port,
        members: cluster.DBClusterMembers?.map((m) => ({
          instanceId: m.DBInstanceIdentifier,
          isClusterWriter: m.IsClusterWriter,
        })),
        deletionProtection: cluster.DeletionProtection,
        backupRetentionPeriod: cluster.BackupRetentionPeriod,
        clusterCreateTime: cluster.ClusterCreateTime?.toISOString(),
      },
    };
  }
}

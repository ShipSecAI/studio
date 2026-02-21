import {
  ECSClient,
  ListClustersCommand,
  DescribeClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  type Cluster,
  type Service,
} from '@aws-sdk/client-ecs';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, isAccessDenied } from './aws-utils';

interface EcsCursor {
  regionIndex: number;
  clusterToken?: string;
}

const PAGE_SIZE = 100;

export class EcsServiceProvider implements AwsServiceProvider {
  serviceId = 'ecs';
  assetTypes = ['ecs_cluster', 'ecs_service'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: EcsCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, clusterToken } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];
      const client = new ECSClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        // List clusters
        const listResult = await withRetry(() =>
          client.send(new ListClustersCommand({ nextToken: clusterToken })),
        );

        const clusterArns = listResult.clusterArns ?? [];

        if (clusterArns.length > 0) {
          // Describe clusters in batches of 100
          const descResult = await withRetry(() =>
            client.send(new DescribeClustersCommand({ clusters: clusterArns })),
          );

          for (const cluster of descResult.clusters ?? []) {
            assets.push(this.mapCluster(cluster, region));

            // List services for each cluster
            const services = await this.listServicesForCluster(client, cluster.clusterArn!, region);
            assets.push(...services);
          }
        }

        if (listResult.nextToken && assets.length >= PAGE_SIZE) {
          return {
            assets,
            nextCursor: JSON.stringify({
              regionIndex,
              clusterToken: listResult.nextToken,
            } satisfies EcsCursor),
            scannedScopes,
          };
        }

        if (listResult.nextToken) {
          clusterToken = listResult.nextToken;
          continue;
        }

        scannedScopes.push(
          { assetType: 'ecs_cluster', region },
          { assetType: 'ecs_service', region },
        );
        regionIndex++;
        clusterToken = undefined;
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done
        ? undefined
        : JSON.stringify({ regionIndex, clusterToken } satisfies EcsCursor),
      scannedScopes,
    };
  }

  private async listServicesForCluster(
    client: ECSClient,
    clusterArn: string,
    region: string,
  ): Promise<DiscoveredAsset[]> {
    const assets: DiscoveredAsset[] = [];
    let nextToken: string | undefined;

    try {
      do {
        const listResult = await withRetry(() =>
          client.send(new ListServicesCommand({ cluster: clusterArn, nextToken })),
        );

        const serviceArns = listResult.serviceArns ?? [];
        if (serviceArns.length > 0) {
          const descResult = await withRetry(() =>
            client.send(
              new DescribeServicesCommand({ cluster: clusterArn, services: serviceArns }),
            ),
          );

          for (const svc of descResult.services ?? []) {
            assets.push(this.mapService(svc, region));
          }
        }

        nextToken = listResult.nextToken;
      } while (nextToken);
    } catch (e) {
      if (!isAccessDenied(e)) throw e;
    }

    return assets;
  }

  private mapCluster(cluster: Cluster, region: string): DiscoveredAsset {
    return {
      assetType: 'ecs_cluster',
      externalId: cluster.clusterArn!,
      name: cluster.clusterName!,
      region,
      metadata: {
        status: cluster.status,
        runningTasksCount: cluster.runningTasksCount,
        pendingTasksCount: cluster.pendingTasksCount,
        activeServicesCount: cluster.activeServicesCount,
        registeredContainerInstancesCount: cluster.registeredContainerInstancesCount,
        capacityProviders: cluster.capacityProviders,
      },
    };
  }

  private mapService(svc: Service, region: string): DiscoveredAsset {
    return {
      assetType: 'ecs_service',
      externalId: svc.serviceArn!,
      name: svc.serviceName!,
      region,
      metadata: {
        clusterArn: svc.clusterArn,
        status: svc.status,
        desiredCount: svc.desiredCount,
        runningCount: svc.runningCount,
        pendingCount: svc.pendingCount,
        launchType: svc.launchType,
        taskDefinition: svc.taskDefinition,
        deploymentController: svc.deploymentController?.type,
        schedulingStrategy: svc.schedulingStrategy,
        healthCheckGracePeriodSeconds: svc.healthCheckGracePeriodSeconds,
      },
    };
  }
}

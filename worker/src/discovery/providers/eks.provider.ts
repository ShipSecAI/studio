import {
  EKSClient,
  ListClustersCommand,
  DescribeClusterCommand,
  ListNodegroupsCommand,
  DescribeNodegroupCommand,
  type Cluster,
  type Nodegroup,
} from '@aws-sdk/client-eks';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry } from './aws-utils';

interface EksCursor {
  regionIndex: number;
  /** 0=clusters, 1=nodegroups */
  phase: number;
  nextToken?: string;
  clusters?: { name: string; arn: string }[];
  clusterIndex?: number;
}

const PAGE_SIZE = 100;

export class EksServiceProvider implements AwsServiceProvider {
  serviceId = 'eks';
  assetTypes = ['eks_cluster', 'eks_nodegroup'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: EksCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0, phase: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, phase, nextToken, clusters, clusterIndex } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];

      const client = new EKSClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        // Phase 0: List and describe clusters
        if (phase === 0) {
          const clusterList: { name: string; arn: string }[] = [];
          let token = nextToken;

          do {
            const result = await withRetry(() =>
              client.send(new ListClustersCommand({ maxResults: 100, nextToken: token })),
            );

            for (const name of result.clusters ?? []) {
              const desc = await withRetry(() => client.send(new DescribeClusterCommand({ name })));
              if (desc.cluster) {
                assets.push(this.mapCluster(desc.cluster, region));
                clusterList.push({ name, arn: desc.cluster.arn! });
              }
            }

            token = result.nextToken;
          } while (token && assets.length < PAGE_SIZE);

          scannedScopes.push({ assetType: 'eks_cluster', region });
          clusters = clusterList;
          clusterIndex = 0;
          phase = 1;
          nextToken = undefined;
        }

        // Phase 1: List nodegroups per cluster
        if (phase === 1 && clusters && assets.length < PAGE_SIZE) {
          while ((clusterIndex ?? 0) < clusters.length && assets.length < PAGE_SIZE) {
            const cluster = clusters[clusterIndex!];
            let token = nextToken;

            do {
              const result = await withRetry(() =>
                client.send(
                  new ListNodegroupsCommand({
                    clusterName: cluster.name,
                    maxResults: 100,
                    nextToken: token,
                  }),
                ),
              );

              for (const ngName of result.nodegroups ?? []) {
                const desc = await withRetry(() =>
                  client.send(
                    new DescribeNodegroupCommand({
                      clusterName: cluster.name,
                      nodegroupName: ngName,
                    }),
                  ),
                );
                if (desc.nodegroup) {
                  assets.push(this.mapNodegroup(desc.nodegroup, cluster.name, region));
                }
              }

              token = result.nextToken;
            } while (token && assets.length < PAGE_SIZE);

            clusterIndex = (clusterIndex ?? 0) + 1;
            nextToken = undefined;
          }

          scannedScopes.push({ assetType: 'eks_nodegroup', region });
          regionIndex++;
          phase = 0;
          nextToken = undefined;
          clusters = undefined;
          clusterIndex = undefined;
        }
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done
        ? undefined
        : JSON.stringify({ regionIndex, phase, nextToken, clusters, clusterIndex }),
      scannedScopes,
    };
  }

  private mapCluster(cluster: Cluster, region: string): DiscoveredAsset {
    return {
      assetType: 'eks_cluster',
      externalId: cluster.arn!,
      name: cluster.name!,
      region,
      metadata: {
        version: cluster.version,
        status: cluster.status,
        platformVersion: cluster.platformVersion,
        endpoint: cluster.endpoint,
        roleArn: cluster.roleArn,
        endpointPublicAccess: cluster.resourcesVpcConfig?.endpointPublicAccess,
        endpointPrivateAccess: cluster.resourcesVpcConfig?.endpointPrivateAccess,
        publicAccessCidrs: cluster.resourcesVpcConfig?.publicAccessCidrs,
        vpcId: cluster.resourcesVpcConfig?.vpcId,
        createdAt: cluster.createdAt?.toISOString(),
        logging: cluster.logging?.clusterLogging?.map((l) => ({
          types: l.types,
          enabled: l.enabled,
        })),
      },
    };
  }

  private mapNodegroup(ng: Nodegroup, clusterName: string, region: string): DiscoveredAsset {
    return {
      assetType: 'eks_nodegroup',
      externalId: ng.nodegroupArn!,
      name: `${clusterName}/${ng.nodegroupName}`,
      region,
      metadata: {
        nodegroupName: ng.nodegroupName,
        clusterName,
        status: ng.status,
        instanceTypes: ng.instanceTypes,
        amiType: ng.amiType,
        capacityType: ng.capacityType,
        scalingConfig: ng.scalingConfig,
        nodeRole: ng.nodeRole,
        diskSize: ng.diskSize,
        releaseVersion: ng.releaseVersion,
        createdAt: ng.createdAt?.toISOString(),
      },
    };
  }
}

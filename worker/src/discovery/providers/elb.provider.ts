import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  type LoadBalancer,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry } from './aws-utils';

interface ElbCursor {
  regionIndex: number;
  marker?: string;
}

export class ElbServiceProvider implements AwsServiceProvider {
  serviceId = 'elb';
  assetTypes = ['elb_load_balancer'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: ElbCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, marker } = cursor;

    while (regionIndex < context.regions.length && assets.length < 100) {
      const region = context.regions[regionIndex];

      const client = new ElasticLoadBalancingV2Client({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        const result = await withRetry(() =>
          client.send(new DescribeLoadBalancersCommand({ Marker: marker })),
        );

        for (const lb of result.LoadBalancers ?? []) {
          assets.push(this.mapLoadBalancer(lb, region));
        }

        if (result.NextMarker && assets.length >= 100) {
          return {
            assets,
            nextCursor: JSON.stringify({ regionIndex, marker: result.NextMarker }),
            scannedScopes,
          };
        }

        if (result.NextMarker) {
          marker = result.NextMarker;
          continue;
        }

        scannedScopes.push({ assetType: 'elb_load_balancer', region });
        regionIndex++;
        marker = undefined;
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done ? undefined : JSON.stringify({ regionIndex, marker }),
      scannedScopes,
    };
  }

  private mapLoadBalancer(lb: LoadBalancer, region: string): DiscoveredAsset {
    return {
      assetType: 'elb_load_balancer',
      externalId: lb.LoadBalancerArn!,
      name: lb.LoadBalancerName!,
      region,
      metadata: {
        type: lb.Type,
        scheme: lb.Scheme,
        state: lb.State?.Code,
        dnsName: lb.DNSName,
        vpcId: lb.VpcId,
        ipAddressType: lb.IpAddressType,
        availabilityZones: lb.AvailabilityZones?.map((az) => ({
          zoneName: az.ZoneName,
          subnetId: az.SubnetId,
        })),
        securityGroups: lb.SecurityGroups,
        createdTime: lb.CreatedTime?.toISOString(),
      },
    };
  }
}

import {
  EC2Client,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeNetworkAclsCommand,
  type Vpc,
  type Subnet,
  type NetworkAcl,
} from '@aws-sdk/client-ec2';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, synthesizeArn } from './aws-utils';

interface VpcCursor {
  regionIndex: number;
  /** 0=vpcs, 1=subnets, 2=nacls */
  phase: number;
  nextToken?: string;
}

const PAGE_SIZE = 100;

export class VpcServiceProvider implements AwsServiceProvider {
  serviceId = 'vpc';
  assetTypes = ['vpc', 'vpc_subnet', 'vpc_nacl'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: VpcCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0, phase: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, phase, nextToken } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];

      const client = new EC2Client({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        // Phase 0: VPCs
        if (phase === 0) {
          const result = await withRetry(() =>
            client.send(new DescribeVpcsCommand({ MaxResults: PAGE_SIZE, NextToken: nextToken })),
          );

          for (const vpc of result.Vpcs ?? []) {
            assets.push(this.mapVpc(vpc, region, context.accountIdentifier));
          }

          if (result.NextToken && assets.length >= PAGE_SIZE) {
            return {
              assets,
              nextCursor: JSON.stringify({ regionIndex, phase: 0, nextToken: result.NextToken }),
              scannedScopes,
            };
          }

          if (!result.NextToken) {
            scannedScopes.push({ assetType: 'vpc', region });
            phase = 1;
            nextToken = undefined;
          } else {
            nextToken = result.NextToken;
            continue;
          }
        }

        // Phase 1: Subnets
        if (phase === 1 && assets.length < PAGE_SIZE) {
          const result = await withRetry(() =>
            client.send(
              new DescribeSubnetsCommand({ MaxResults: PAGE_SIZE, NextToken: nextToken }),
            ),
          );

          for (const subnet of result.Subnets ?? []) {
            assets.push(this.mapSubnet(subnet, region, context.accountIdentifier));
          }

          if (result.NextToken && assets.length >= PAGE_SIZE) {
            return {
              assets,
              nextCursor: JSON.stringify({ regionIndex, phase: 1, nextToken: result.NextToken }),
              scannedScopes,
            };
          }

          if (!result.NextToken) {
            scannedScopes.push({ assetType: 'vpc_subnet', region });
            phase = 2;
            nextToken = undefined;
          } else {
            nextToken = result.NextToken;
            continue;
          }
        }

        // Phase 2: NACLs
        if (phase === 2 && assets.length < PAGE_SIZE) {
          const result = await withRetry(() =>
            client.send(
              new DescribeNetworkAclsCommand({ MaxResults: PAGE_SIZE, NextToken: nextToken }),
            ),
          );

          for (const nacl of result.NetworkAcls ?? []) {
            assets.push(this.mapNacl(nacl, region, context.accountIdentifier));
          }

          if (result.NextToken && assets.length >= PAGE_SIZE) {
            return {
              assets,
              nextCursor: JSON.stringify({ regionIndex, phase: 2, nextToken: result.NextToken }),
              scannedScopes,
            };
          }

          scannedScopes.push({ assetType: 'vpc_nacl', region });
          regionIndex++;
          phase = 0;
          nextToken = undefined;
        }
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done ? undefined : JSON.stringify({ regionIndex, phase, nextToken }),
      scannedScopes,
    };
  }

  private mapVpc(vpc: Vpc, region: string, accountId: string): DiscoveredAsset {
    const vpcId = vpc.VpcId!;
    const nameTag = vpc.Tags?.find((t) => t.Key === 'Name')?.Value;

    return {
      assetType: 'vpc',
      externalId: synthesizeArn({
        service: 'ec2',
        region,
        accountId,
        resourceType: 'vpc',
        resourceId: vpcId,
      }),
      name: nameTag || vpcId,
      region,
      metadata: {
        vpcId,
        cidrBlock: vpc.CidrBlock,
        isDefault: vpc.IsDefault,
        state: vpc.State,
        dhcpOptionsId: vpc.DhcpOptionsId,
        instanceTenancy: vpc.InstanceTenancy,
      },
    };
  }

  private mapSubnet(subnet: Subnet, region: string, accountId: string): DiscoveredAsset {
    const subnetId = subnet.SubnetId!;
    const nameTag = subnet.Tags?.find((t) => t.Key === 'Name')?.Value;

    return {
      assetType: 'vpc_subnet',
      externalId: synthesizeArn({
        service: 'ec2',
        region,
        accountId,
        resourceType: 'subnet',
        resourceId: subnetId,
      }),
      name: nameTag || subnetId,
      region,
      metadata: {
        subnetId,
        vpcId: subnet.VpcId,
        cidrBlock: subnet.CidrBlock,
        availabilityZone: subnet.AvailabilityZone,
        state: subnet.State,
        mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch,
        defaultForAz: subnet.DefaultForAz,
        availableIpAddressCount: subnet.AvailableIpAddressCount,
      },
    };
  }

  private mapNacl(nacl: NetworkAcl, region: string, accountId: string): DiscoveredAsset {
    const naclId = nacl.NetworkAclId!;
    const nameTag = nacl.Tags?.find((t) => t.Key === 'Name')?.Value;

    return {
      assetType: 'vpc_nacl',
      externalId: synthesizeArn({
        service: 'ec2',
        region,
        accountId,
        resourceType: 'network-acl',
        resourceId: naclId,
      }),
      name: nameTag || naclId,
      region,
      metadata: {
        networkAclId: naclId,
        vpcId: nacl.VpcId,
        isDefault: nacl.IsDefault,
        entryCount: nacl.Entries?.length ?? 0,
        associations: nacl.Associations?.map((a) => ({
          subnetId: a.SubnetId,
        })),
      },
    };
  }
}

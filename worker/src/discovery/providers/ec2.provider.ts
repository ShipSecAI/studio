import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeVolumesCommand,
  type Instance,
  type SecurityGroup,
  type Volume,
} from '@aws-sdk/client-ec2';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, synthesizeArn, isAccessDenied } from './aws-utils';

interface Ec2Cursor {
  regionIndex: number;
  /** 0=instances, 1=security_groups, 2=volumes */
  phase: number;
  nextToken?: string;
}

const PAGE_SIZE = 100;

export class Ec2ServiceProvider implements AwsServiceProvider {
  serviceId = 'ec2';
  assetTypes = ['ec2_instance', 'ec2_security_group', 'ec2_ebs_volume'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: Ec2Cursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0, phase: 0 };
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
        // Phase 0: Instances
        if (phase === 0) {
          try {
            const result = await withRetry(() =>
              client.send(
                new DescribeInstancesCommand({ MaxResults: PAGE_SIZE, NextToken: nextToken }),
              ),
            );

            for (const reservation of result.Reservations ?? []) {
              for (const instance of reservation.Instances ?? []) {
                assets.push(this.mapInstance(instance, region, context.accountIdentifier));
              }
            }

            if (result.NextToken && assets.length >= PAGE_SIZE) {
              return this.page(assets, scannedScopes, {
                regionIndex,
                phase: 0,
                nextToken: result.NextToken,
              });
            }

            nextToken = result.NextToken;
            if (!nextToken) {
              scannedScopes.push({ assetType: 'ec2_instance', region });
              phase = 1;
              nextToken = undefined;
            }
          } catch (e) {
            if (isAccessDenied(e)) {
              phase = 1;
              nextToken = undefined;
            } else throw e;
          }
        }

        // Phase 1: Security Groups
        if (phase === 1 && assets.length < PAGE_SIZE) {
          try {
            const result = await withRetry(() =>
              client.send(
                new DescribeSecurityGroupsCommand({ MaxResults: PAGE_SIZE, NextToken: nextToken }),
              ),
            );

            for (const sg of result.SecurityGroups ?? []) {
              assets.push(this.mapSecurityGroup(sg, region, context.accountIdentifier));
            }

            if (result.NextToken && assets.length >= PAGE_SIZE) {
              return this.page(assets, scannedScopes, {
                regionIndex,
                phase: 1,
                nextToken: result.NextToken,
              });
            }

            nextToken = result.NextToken;
            if (!nextToken) {
              scannedScopes.push({ assetType: 'ec2_security_group', region });
              phase = 2;
              nextToken = undefined;
            }
          } catch (e) {
            if (isAccessDenied(e)) {
              phase = 2;
              nextToken = undefined;
            } else throw e;
          }
        }

        // Phase 2: EBS Volumes
        if (phase === 2 && assets.length < PAGE_SIZE) {
          try {
            const result = await withRetry(() =>
              client.send(
                new DescribeVolumesCommand({ MaxResults: PAGE_SIZE, NextToken: nextToken }),
              ),
            );

            for (const vol of result.Volumes ?? []) {
              assets.push(this.mapVolume(vol, region, context.accountIdentifier));
            }

            if (result.NextToken && assets.length >= PAGE_SIZE) {
              return this.page(assets, scannedScopes, {
                regionIndex,
                phase: 2,
                nextToken: result.NextToken,
              });
            }

            nextToken = result.NextToken;
            if (!nextToken) {
              scannedScopes.push({ assetType: 'ec2_ebs_volume', region });
              // Done with this region
              regionIndex++;
              phase = 0;
              nextToken = undefined;
            }
          } catch (e) {
            if (isAccessDenied(e)) {
              regionIndex++;
              phase = 0;
              nextToken = undefined;
            } else throw e;
          }
        }
      } finally {
        client.destroy();
      }
    }

    // Check if more regions remain
    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done
        ? undefined
        : JSON.stringify({ regionIndex, phase, nextToken } satisfies Ec2Cursor),
      scannedScopes,
    };
  }

  private page(
    assets: DiscoveredAsset[],
    scannedScopes: { assetType: string; region: string }[],
    cursor: Ec2Cursor,
  ): ServiceDiscoveryPage {
    return { assets, nextCursor: JSON.stringify(cursor), scannedScopes };
  }

  private mapInstance(instance: Instance, region: string, accountId: string): DiscoveredAsset {
    const instanceId = instance.InstanceId!;
    const externalId = synthesizeArn({
      service: 'ec2',
      region,
      accountId,
      resourceType: 'instance',
      resourceId: instanceId,
    });
    const nameTag = instance.Tags?.find((t) => t.Key === 'Name')?.Value;

    return {
      assetType: 'ec2_instance',
      externalId,
      name: nameTag || instanceId,
      region,
      metadata: {
        instanceId,
        instanceType: instance.InstanceType,
        state: instance.State?.Name,
        publicIpAddress: instance.PublicIpAddress,
        privateIpAddress: instance.PrivateIpAddress,
        vpcId: instance.VpcId,
        subnetId: instance.SubnetId,
        imageId: instance.ImageId,
        launchTime: instance.LaunchTime?.toISOString(),
        platform: instance.Platform,
        architecture: instance.Architecture,
        securityGroups: instance.SecurityGroups?.map((sg) => ({
          groupId: sg.GroupId,
          groupName: sg.GroupName,
        })),
        iamInstanceProfile: instance.IamInstanceProfile?.Arn,
        monitoring: instance.Monitoring?.State,
      },
    };
  }

  private mapSecurityGroup(sg: SecurityGroup, region: string, accountId: string): DiscoveredAsset {
    const groupId = sg.GroupId!;
    const externalId = synthesizeArn({
      service: 'ec2',
      region,
      accountId,
      resourceType: 'security-group',
      resourceId: groupId,
    });

    return {
      assetType: 'ec2_security_group',
      externalId,
      name: sg.GroupName || groupId,
      region,
      metadata: {
        groupId,
        groupName: sg.GroupName,
        description: sg.Description,
        vpcId: sg.VpcId,
        inboundRuleCount: sg.IpPermissions?.length ?? 0,
        outboundRuleCount: sg.IpPermissionsEgress?.length ?? 0,
        inboundRules: sg.IpPermissions?.slice(0, 20).map((p) => ({
          protocol: p.IpProtocol,
          fromPort: p.FromPort,
          toPort: p.ToPort,
          ipRanges: p.IpRanges?.map((r) => r.CidrIp),
          ipv6Ranges: p.Ipv6Ranges?.map((r) => r.CidrIpv6),
        })),
      },
    };
  }

  private mapVolume(vol: Volume, region: string, accountId: string): DiscoveredAsset {
    const volumeId = vol.VolumeId!;
    const externalId = synthesizeArn({
      service: 'ec2',
      region,
      accountId,
      resourceType: 'volume',
      resourceId: volumeId,
    });
    const nameTag = vol.Tags?.find((t) => t.Key === 'Name')?.Value;

    return {
      assetType: 'ec2_ebs_volume',
      externalId,
      name: nameTag || volumeId,
      region,
      metadata: {
        volumeId,
        volumeType: vol.VolumeType,
        size: vol.Size,
        state: vol.State,
        encrypted: vol.Encrypted,
        kmsKeyId: vol.KmsKeyId,
        availabilityZone: vol.AvailabilityZone,
        createTime: vol.CreateTime?.toISOString(),
        attachments: vol.Attachments?.map((a) => ({
          instanceId: a.InstanceId,
          device: a.Device,
          state: a.State,
        })),
      },
    };
  }
}

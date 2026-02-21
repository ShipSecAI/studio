import {
  Route53Client,
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  type HostedZone,
  type ResourceRecordSet,
} from '@aws-sdk/client-route-53';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, synthesizeArn } from './aws-utils';

interface Route53Cursor {
  /** 0=zones, 1=records */
  phase: number;
  zoneMarker?: string;
  /** For records: zones to paginate */
  zones?: { id: string; name: string }[];
  zoneIndex?: number;
  recordName?: string;
  recordType?: string;
}

const PAGE_SIZE = 100;

export class Route53ServiceProvider implements AwsServiceProvider {
  serviceId = 'route53';
  assetTypes = ['route53_hosted_zone', 'route53_record'];
  isGlobal = true;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: Route53Cursor = cursorStr ? JSON.parse(cursorStr) : { phase: 0 };
    const assets: DiscoveredAsset[] = [];
    const region = 'global';

    const client = new Route53Client({
      region: 'us-east-1',
      credentials: {
        accessKeyId: context.credentials.accessKeyId,
        secretAccessKey: context.credentials.secretAccessKey,
        sessionToken: context.credentials.sessionToken,
      },
    });

    try {
      let { phase, zones, zoneIndex, recordName, recordType } = cursor;
      const { zoneMarker } = cursor;

      // Phase 0: List hosted zones
      if (phase === 0) {
        const allZones: { id: string; name: string }[] = [];
        let marker = zoneMarker;

        do {
          const result = await withRetry(() =>
            client.send(new ListHostedZonesCommand({ Marker: marker, MaxItems: 100 })),
          );

          for (const zone of result.HostedZones ?? []) {
            assets.push(this.mapZone(zone, context.accountIdentifier));
            allZones.push({
              id: zone.Id!.replace('/hostedzone/', ''),
              name: zone.Name!,
            });
          }

          marker = result.IsTruncated ? result.NextMarker : undefined;
        } while (marker);

        zones = allZones;
        zoneIndex = 0;
        phase = 1;
      }

      // Phase 1: List records per zone
      if (phase === 1 && zones) {
        while ((zoneIndex ?? 0) < zones.length && assets.length < PAGE_SIZE) {
          const zone = zones[zoneIndex!];

          const result = await withRetry(() =>
            client.send(
              new ListResourceRecordSetsCommand({
                HostedZoneId: zone.id,
                StartRecordName: recordName,
                StartRecordType: recordType as any,
                MaxItems: PAGE_SIZE,
              }),
            ),
          );

          for (const record of result.ResourceRecordSets ?? []) {
            assets.push(this.mapRecord(record, zone.id, zone.name, context.accountIdentifier));
          }

          if (result.IsTruncated) {
            recordName = result.NextRecordName;
            recordType = result.NextRecordType;

            if (assets.length >= PAGE_SIZE) {
              return this.page(assets, region, {
                phase: 1,
                zones,
                zoneIndex: zoneIndex!,
                recordName,
                recordType,
              });
            }
            continue;
          }

          // Done with this zone
          zoneIndex = (zoneIndex ?? 0) + 1;
          recordName = undefined;
          recordType = undefined;
        }
      }

      return {
        assets,
        nextCursor: undefined,
        scannedScopes: this.assetTypes.map((t) => ({ assetType: t, region })),
      };
    } finally {
      client.destroy();
    }
  }

  private page(
    assets: DiscoveredAsset[],
    region: string,
    cursor: Route53Cursor,
  ): ServiceDiscoveryPage {
    return {
      assets,
      nextCursor: JSON.stringify(cursor),
      scannedScopes: this.assetTypes.map((t) => ({ assetType: t, region })),
    };
  }

  private mapZone(zone: HostedZone, _accountId: string): DiscoveredAsset {
    const zoneId = zone.Id!.replace('/hostedzone/', '');
    return {
      assetType: 'route53_hosted_zone',
      externalId: `arn:aws:route53:::hostedzone/${zoneId}`,
      name: zone.Name!,
      region: 'global',
      metadata: {
        hostedZoneId: zoneId,
        recordCount: zone.ResourceRecordSetCount,
        isPrivateZone: zone.Config?.PrivateZone,
        comment: zone.Config?.Comment,
      },
    };
  }

  private mapRecord(
    record: ResourceRecordSet,
    zoneId: string,
    zoneName: string,
    accountId: string,
  ): DiscoveredAsset {
    const externalId = synthesizeArn({
      service: 'route53',
      region: 'global',
      accountId,
      resourceType: 'record',
      resourceId: `${zoneId}/${record.Name}/${record.Type}`,
    });

    return {
      assetType: 'route53_record',
      externalId,
      name: `${record.Name} (${record.Type})`,
      region: 'global',
      metadata: {
        hostedZoneId: zoneId,
        zoneName,
        type: record.Type,
        ttl: record.TTL,
        resourceRecords: record.ResourceRecords?.slice(0, 20).map((r) => r.Value),
        aliasTarget: record.AliasTarget
          ? {
              dnsName: record.AliasTarget.DNSName,
              hostedZoneId: record.AliasTarget.HostedZoneId,
              evaluateTargetHealth: record.AliasTarget.EvaluateTargetHealth,
            }
          : undefined,
      },
    };
  }
}

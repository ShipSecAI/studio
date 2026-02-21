import {
  GuardDutyClient,
  ListDetectorsCommand,
  GetDetectorCommand,
} from '@aws-sdk/client-guardduty';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, synthesizeArn } from './aws-utils';

interface GdCursor {
  regionIndex: number;
  nextToken?: string;
}

const PAGE_SIZE = 100;

export class GuardDutyServiceProvider implements AwsServiceProvider {
  serviceId = 'guardduty';
  assetTypes = ['guardduty_detector'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: GdCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, nextToken } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];
      const client = new GuardDutyClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        const result = await withRetry(() =>
          client.send(new ListDetectorsCommand({ MaxResults: 50, NextToken: nextToken })),
        );

        for (const detectorId of result.DetectorIds ?? []) {
          const detail = await withRetry(() =>
            client.send(new GetDetectorCommand({ DetectorId: detectorId })),
          );

          assets.push({
            assetType: 'guardduty_detector',
            externalId: synthesizeArn({
              service: 'guardduty',
              region,
              accountId: context.accountIdentifier,
              resourceType: 'detector',
              resourceId: detectorId,
            }),
            name: detectorId,
            region,
            metadata: {
              status: detail.Status,
              serviceRole: detail.ServiceRole,
              createdAt: detail.CreatedAt,
              updatedAt: detail.UpdatedAt,
              findingPublishingFrequency: detail.FindingPublishingFrequency,
              dataSources: detail.DataSources
                ? {
                    cloudTrail: detail.DataSources.CloudTrail?.Status,
                    dnsLogs: detail.DataSources.DNSLogs?.Status,
                    flowLogs: detail.DataSources.FlowLogs?.Status,
                    s3Logs: detail.DataSources.S3Logs?.Status,
                  }
                : undefined,
            },
          });
        }

        if (result.NextToken && assets.length >= PAGE_SIZE) {
          return {
            assets,
            nextCursor: JSON.stringify({
              regionIndex,
              nextToken: result.NextToken,
            } satisfies GdCursor),
            scannedScopes,
          };
        }

        if (result.NextToken) {
          nextToken = result.NextToken;
          continue;
        }

        scannedScopes.push({ assetType: 'guardduty_detector', region });
        regionIndex++;
        nextToken = undefined;
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done ? undefined : JSON.stringify({ regionIndex, nextToken } satisfies GdCursor),
      scannedScopes,
    };
  }
}

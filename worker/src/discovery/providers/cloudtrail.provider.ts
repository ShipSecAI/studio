import {
  CloudTrailClient,
  DescribeTrailsCommand,
  GetTrailStatusCommand,
  type Trail,
} from '@aws-sdk/client-cloudtrail';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, isAccessDenied } from './aws-utils';

export class CloudTrailServiceProvider implements AwsServiceProvider {
  serviceId = 'cloudtrail';
  assetTypes = ['cloudtrail_trail'];
  isGlobal = true;

  async discover(context: DiscoveryContext, _cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const client = new CloudTrailClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: context.credentials.accessKeyId,
        secretAccessKey: context.credentials.secretAccessKey,
        sessionToken: context.credentials.sessionToken,
      },
    });

    try {
      const result = await withRetry(() =>
        client.send(new DescribeTrailsCommand({ includeShadowTrails: false })),
      );

      const assets: DiscoveredAsset[] = [];

      for (const trail of result.trailList ?? []) {
        const asset = await this.enrichTrail(client, trail);
        assets.push(asset);
      }

      return {
        assets,
        nextCursor: undefined,
        scannedScopes: [{ assetType: 'cloudtrail_trail', region: 'global' }],
      };
    } finally {
      client.destroy();
    }
  }

  private async enrichTrail(client: CloudTrailClient, trail: Trail): Promise<DiscoveredAsset> {
    const metadata: Record<string, unknown> = {
      s3BucketName: trail.S3BucketName,
      s3KeyPrefix: trail.S3KeyPrefix,
      snsTopicArn: trail.SnsTopicARN,
      cloudWatchLogsLogGroupArn: trail.CloudWatchLogsLogGroupArn,
      cloudWatchLogsRoleArn: trail.CloudWatchLogsRoleArn,
      kmsKeyId: trail.KmsKeyId,
      hasCustomEventSelectors: trail.HasCustomEventSelectors,
      hasInsightSelectors: trail.HasInsightSelectors,
      isMultiRegionTrail: trail.IsMultiRegionTrail,
      isOrganizationTrail: trail.IsOrganizationTrail,
      includeGlobalServiceEvents: trail.IncludeGlobalServiceEvents,
      logFileValidationEnabled: trail.LogFileValidationEnabled,
      homeRegion: trail.HomeRegion,
    };

    try {
      const status = await withRetry(() =>
        client.send(new GetTrailStatusCommand({ Name: trail.TrailARN! })),
      );
      metadata.isLogging = status.IsLogging;
      metadata.latestDeliveryTime = status.LatestDeliveryTime?.toISOString();
      metadata.latestNotificationTime = status.LatestNotificationTime?.toISOString();
    } catch (e) {
      if (!isAccessDenied(e)) throw e;
    }

    return {
      assetType: 'cloudtrail_trail',
      externalId: trail.TrailARN!,
      name: trail.Name!,
      region: trail.HomeRegion ?? 'global',
      metadata,
    };
  }
}

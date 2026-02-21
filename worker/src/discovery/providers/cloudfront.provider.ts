import {
  CloudFrontClient,
  ListDistributionsCommand,
  type DistributionSummary,
} from '@aws-sdk/client-cloudfront';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry } from './aws-utils';

interface CloudFrontCursor {
  marker?: string;
}

export class CloudFrontServiceProvider implements AwsServiceProvider {
  serviceId = 'cloudfront';
  assetTypes = ['cloudfront_distribution'];
  isGlobal = true;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: CloudFrontCursor = cursorStr ? JSON.parse(cursorStr) : {};
    const assets: DiscoveredAsset[] = [];
    const region = 'global';

    const client = new CloudFrontClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: context.credentials.accessKeyId,
        secretAccessKey: context.credentials.secretAccessKey,
        sessionToken: context.credentials.sessionToken,
      },
    });

    try {
      let marker = cursor.marker;

      do {
        const result = await withRetry(() =>
          client.send(new ListDistributionsCommand({ Marker: marker, MaxItems: 100 })),
        );

        const list = result.DistributionList;
        for (const dist of list?.Items ?? []) {
          assets.push(this.mapDistribution(dist));
        }

        marker = list?.IsTruncated ? list.NextMarker : undefined;
      } while (marker);

      return {
        assets,
        nextCursor: undefined,
        scannedScopes: [{ assetType: 'cloudfront_distribution', region }],
      };
    } finally {
      client.destroy();
    }
  }

  private mapDistribution(dist: DistributionSummary): DiscoveredAsset {
    return {
      assetType: 'cloudfront_distribution',
      externalId: dist.ARN!,
      name: dist.DomainName!,
      region: 'global',
      metadata: {
        distributionId: dist.Id,
        domainName: dist.DomainName,
        status: dist.Status,
        enabled: dist.Enabled,
        httpVersion: dist.HttpVersion,
        isIPV6Enabled: dist.IsIPV6Enabled,
        priceClass: dist.PriceClass,
        viewerCertificate: dist.ViewerCertificate
          ? {
              sslSupportMethod: dist.ViewerCertificate.SSLSupportMethod,
              minimumProtocolVersion: dist.ViewerCertificate.MinimumProtocolVersion,
              certificateSource: dist.ViewerCertificate.CertificateSource,
            }
          : undefined,
        aliases: dist.Aliases?.Items,
        origins: dist.Origins?.Items?.slice(0, 10).map((o) => ({
          id: o.Id,
          domainName: o.DomainName,
          originPath: o.OriginPath,
        })),
        webAclId: dist.WebACLId || undefined,
        lastModifiedTime: dist.LastModifiedTime?.toISOString(),
      },
    };
  }
}

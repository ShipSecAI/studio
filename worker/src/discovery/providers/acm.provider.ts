import {
  ACMClient,
  ListCertificatesCommand,
  DescribeCertificateCommand,
  type CertificateSummary,
} from '@aws-sdk/client-acm';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, isAccessDenied } from './aws-utils';

interface AcmCursor {
  regionIndex: number;
  nextToken?: string;
}

const PAGE_SIZE = 100;

export class AcmServiceProvider implements AwsServiceProvider {
  serviceId = 'acm';
  assetTypes = ['acm_certificate'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: AcmCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, nextToken } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];
      const client = new ACMClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        const result = await withRetry(() =>
          client.send(new ListCertificatesCommand({ MaxItems: PAGE_SIZE, NextToken: nextToken })),
        );

        for (const cert of result.CertificateSummaryList ?? []) {
          const asset = await this.enrichCert(client, cert, region);
          if (asset) assets.push(asset);
        }

        if (result.NextToken && assets.length >= PAGE_SIZE) {
          return {
            assets,
            nextCursor: JSON.stringify({
              regionIndex,
              nextToken: result.NextToken,
            } satisfies AcmCursor),
            scannedScopes,
          };
        }

        if (result.NextToken) {
          nextToken = result.NextToken;
          continue;
        }

        scannedScopes.push({ assetType: 'acm_certificate', region });
        regionIndex++;
        nextToken = undefined;
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done ? undefined : JSON.stringify({ regionIndex, nextToken } satisfies AcmCursor),
      scannedScopes,
    };
  }

  private async enrichCert(
    client: ACMClient,
    cert: CertificateSummary,
    region: string,
  ): Promise<DiscoveredAsset | null> {
    try {
      const desc = await withRetry(() =>
        client.send(new DescribeCertificateCommand({ CertificateArn: cert.CertificateArn! })),
      );
      const detail = desc.Certificate!;

      return {
        assetType: 'acm_certificate',
        externalId: detail.CertificateArn!,
        name: detail.DomainName!,
        region,
        metadata: {
          status: detail.Status,
          type: detail.Type,
          issuer: detail.Issuer,
          serial: detail.Serial,
          subjectAlternativeNames: detail.SubjectAlternativeNames,
          notBefore: detail.NotBefore?.toISOString(),
          notAfter: detail.NotAfter?.toISOString(),
          keyAlgorithm: detail.KeyAlgorithm,
          inUseBy: detail.InUseBy,
          renewalEligibility: detail.RenewalEligibility,
          failureReason: detail.FailureReason,
        },
      };
    } catch (e) {
      if (isAccessDenied(e)) return null;
      throw e;
    }
  }
}

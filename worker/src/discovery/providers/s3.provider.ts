import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetPublicAccessBlockCommand,
  GetBucketEncryptionCommand,
  GetBucketVersioningCommand,
  type Bucket,
} from '@aws-sdk/client-s3';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, synthesizeArn, isAccessDenied } from './aws-utils';

export class S3ServiceProvider implements AwsServiceProvider {
  serviceId = 's3';
  assetTypes = ['s3_bucket'];
  isGlobal = true;

  async discover(context: DiscoveryContext, _cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const region = 'global';

    const client = new S3Client({
      region: 'us-east-1',
      credentials: {
        accessKeyId: context.credentials.accessKeyId,
        secretAccessKey: context.credentials.secretAccessKey,
        sessionToken: context.credentials.sessionToken,
      },
    });

    try {
      // S3 ListBuckets returns all buckets in one call (no pagination)
      const result = await withRetry(() => client.send(new ListBucketsCommand({})));
      const buckets = result.Buckets ?? [];

      const assets: DiscoveredAsset[] = [];
      for (const bucket of buckets) {
        if (!bucket.Name) continue;
        const asset = await this.enrichBucket(client, bucket, context.accountIdentifier);
        assets.push(asset);
      }

      return {
        assets,
        nextCursor: undefined,
        scannedScopes: [{ assetType: 's3_bucket', region }],
      };
    } finally {
      client.destroy();
    }
  }

  private async enrichBucket(
    client: S3Client,
    bucket: Bucket,
    accountId: string,
  ): Promise<DiscoveredAsset> {
    const name = bucket.Name!;
    const externalId = synthesizeArn({
      service: 's3',
      region: 'global',
      accountId,
      resourceType: 'bucket',
      resourceId: name,
    });

    const metadata: Record<string, unknown> = {
      creationDate: bucket.CreationDate?.toISOString(),
    };

    // Best-effort enrichment — any of these can fail
    try {
      const loc = await withRetry(() =>
        client.send(new GetBucketLocationCommand({ Bucket: name })),
      );
      metadata.location = loc.LocationConstraint ?? 'us-east-1';
    } catch (e) {
      if (!isAccessDenied(e)) metadata.locationError = 'failed';
    }

    try {
      const pab = await withRetry(() =>
        client.send(new GetPublicAccessBlockCommand({ Bucket: name })),
      );
      metadata.publicAccessBlock = {
        blockPublicAcls: pab.PublicAccessBlockConfiguration?.BlockPublicAcls,
        ignorePublicAcls: pab.PublicAccessBlockConfiguration?.IgnorePublicAcls,
        blockPublicPolicy: pab.PublicAccessBlockConfiguration?.BlockPublicPolicy,
        restrictPublicBuckets: pab.PublicAccessBlockConfiguration?.RestrictPublicBuckets,
      };
    } catch {
      /* optional */
    }

    try {
      const enc = await withRetry(() =>
        client.send(new GetBucketEncryptionCommand({ Bucket: name })),
      );
      const rules = enc.ServerSideEncryptionConfiguration?.Rules ?? [];
      metadata.encryption = rules.map((r) => ({
        sseAlgorithm: r.ApplyServerSideEncryptionByDefault?.SSEAlgorithm,
        kmsMasterKeyId: r.ApplyServerSideEncryptionByDefault?.KMSMasterKeyID,
        bucketKeyEnabled: r.BucketKeyEnabled,
      }));
    } catch {
      /* optional */
    }

    try {
      const ver = await withRetry(() =>
        client.send(new GetBucketVersioningCommand({ Bucket: name })),
      );
      metadata.versioning = ver.Status;
      metadata.mfaDelete = ver.MFADelete;
    } catch {
      /* optional */
    }

    return {
      assetType: 's3_bucket',
      externalId,
      name,
      region: 'global',
      metadata,
    };
  }
}

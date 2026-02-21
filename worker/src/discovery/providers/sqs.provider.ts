import { SQSClient, ListQueuesCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, isAccessDenied, synthesizeArn } from './aws-utils';

interface SqsCursor {
  regionIndex: number;
  nextToken?: string;
}

const PAGE_SIZE = 100;

export class SqsServiceProvider implements AwsServiceProvider {
  serviceId = 'sqs';
  assetTypes = ['sqs_queue'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: SqsCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, nextToken } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];
      const client = new SQSClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        const result = await withRetry(() =>
          client.send(new ListQueuesCommand({ MaxResults: 1000, NextToken: nextToken })),
        );

        for (const queueUrl of result.QueueUrls ?? []) {
          const asset = await this.enrichQueue(client, queueUrl, region, context.accountIdentifier);
          if (asset) assets.push(asset);
        }

        if (result.NextToken && assets.length >= PAGE_SIZE) {
          return {
            assets,
            nextCursor: JSON.stringify({
              regionIndex,
              nextToken: result.NextToken,
            } satisfies SqsCursor),
            scannedScopes,
          };
        }

        if (result.NextToken) {
          nextToken = result.NextToken;
          continue;
        }

        scannedScopes.push({ assetType: 'sqs_queue', region });
        regionIndex++;
        nextToken = undefined;
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done ? undefined : JSON.stringify({ regionIndex, nextToken } satisfies SqsCursor),
      scannedScopes,
    };
  }

  private async enrichQueue(
    client: SQSClient,
    queueUrl: string,
    region: string,
    accountId: string,
  ): Promise<DiscoveredAsset | null> {
    try {
      const attrs = await withRetry(() =>
        client.send(
          new GetQueueAttributesCommand({
            QueueUrl: queueUrl,
            AttributeNames: ['All'],
          }),
        ),
      );
      const a = attrs.Attributes ?? {};
      const queueName = queueUrl.split('/').pop() ?? queueUrl;

      return {
        assetType: 'sqs_queue',
        externalId:
          a.QueueArn ??
          synthesizeArn({
            service: 'sqs',
            region,
            accountId,
            resourceType: '',
            resourceId: queueName,
          }),
        name: queueName,
        region,
        metadata: {
          approximateNumberOfMessages: a.ApproximateNumberOfMessages
            ? Number(a.ApproximateNumberOfMessages)
            : undefined,
          approximateNumberOfMessagesDelayed: a.ApproximateNumberOfMessagesDelayed
            ? Number(a.ApproximateNumberOfMessagesDelayed)
            : undefined,
          approximateNumberOfMessagesNotVisible: a.ApproximateNumberOfMessagesNotVisible
            ? Number(a.ApproximateNumberOfMessagesNotVisible)
            : undefined,
          visibilityTimeout: a.VisibilityTimeout ? Number(a.VisibilityTimeout) : undefined,
          maximumMessageSize: a.MaximumMessageSize ? Number(a.MaximumMessageSize) : undefined,
          messageRetentionPeriod: a.MessageRetentionPeriod
            ? Number(a.MessageRetentionPeriod)
            : undefined,
          kmsMasterKeyId: a.KmsMasterKeyId,
          fifoQueue: a.FifoQueue === 'true',
          contentBasedDeduplication: a.ContentBasedDeduplication === 'true',
          redrivePolicy: a.RedrivePolicy ? JSON.parse(a.RedrivePolicy) : undefined,
          createdTimestamp: a.CreatedTimestamp,
        },
      };
    } catch (e) {
      if (isAccessDenied(e)) return null;
      throw e;
    }
  }
}

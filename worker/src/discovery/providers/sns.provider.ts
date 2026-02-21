import { SNSClient, ListTopicsCommand, GetTopicAttributesCommand } from '@aws-sdk/client-sns';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';
import { withRetry, isAccessDenied } from './aws-utils';

interface SnsCursor {
  regionIndex: number;
  nextToken?: string;
}

const PAGE_SIZE = 100;

export class SnsServiceProvider implements AwsServiceProvider {
  serviceId = 'sns';
  assetTypes = ['sns_topic'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: SnsCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const scannedScopes: { assetType: string; region: string }[] = [];

    let { regionIndex, nextToken } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];
      const client = new SNSClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        const result = await withRetry(() =>
          client.send(new ListTopicsCommand({ NextToken: nextToken })),
        );

        for (const topic of result.Topics ?? []) {
          if (!topic.TopicArn) continue;
          const asset = await this.enrichTopic(client, topic.TopicArn, region);
          if (asset) assets.push(asset);
        }

        if (result.NextToken && assets.length >= PAGE_SIZE) {
          return {
            assets,
            nextCursor: JSON.stringify({
              regionIndex,
              nextToken: result.NextToken,
            } satisfies SnsCursor),
            scannedScopes,
          };
        }

        if (result.NextToken) {
          nextToken = result.NextToken;
          continue;
        }

        scannedScopes.push({ assetType: 'sns_topic', region });
        regionIndex++;
        nextToken = undefined;
      } finally {
        client.destroy();
      }
    }

    const done = regionIndex >= context.regions.length;
    return {
      assets,
      nextCursor: done ? undefined : JSON.stringify({ regionIndex, nextToken } satisfies SnsCursor),
      scannedScopes,
    };
  }

  private async enrichTopic(
    client: SNSClient,
    topicArn: string,
    region: string,
  ): Promise<DiscoveredAsset | null> {
    try {
      const attrs = await withRetry(() =>
        client.send(new GetTopicAttributesCommand({ TopicArn: topicArn })),
      );
      const a = attrs.Attributes ?? {};
      const name = topicArn.split(':').pop() ?? topicArn;

      return {
        assetType: 'sns_topic',
        externalId: topicArn,
        name,
        region,
        metadata: {
          displayName: a.DisplayName,
          subscriptionsConfirmed: a.SubscriptionsConfirmed
            ? Number(a.SubscriptionsConfirmed)
            : undefined,
          subscriptionsPending: a.SubscriptionsPending ? Number(a.SubscriptionsPending) : undefined,
          subscriptionsDeleted: a.SubscriptionsDeleted ? Number(a.SubscriptionsDeleted) : undefined,
          kmsMasterKeyId: a.KmsMasterKeyId,
          fifoTopic: a.FifoTopic === 'true',
          contentBasedDeduplication: a.ContentBasedDeduplication === 'true',
        },
      };
    } catch (e) {
      if (isAccessDenied(e)) return null;
      throw e;
    }
  }
}

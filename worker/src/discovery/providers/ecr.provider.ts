import {
  ECRClient,
  DescribeRepositoriesCommand,
  DescribeImagesCommand,
  type Repository,
  type ImageDetail,
} from '@aws-sdk/client-ecr';
import type { DiscoveryContext, DiscoveredAsset } from '../discovery-provider';
import type { AwsServiceProvider, ServiceDiscoveryPage } from '../aws-service-provider';

/**
 * Cursor state for ECR pagination — encodes position across regions, repos, and images.
 */
interface EcrCursor {
  regionIndex: number;
  repoNextToken?: string;
  /** Current repo ARN being paginated for images */
  currentRepoArn?: string;
  currentRepoName?: string;
  imageNextToken?: string;
}

const PAGE_SIZE = 100;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

export class EcrServiceProvider implements AwsServiceProvider {
  serviceId = 'ecr';
  assetTypes = ['ecr_repository', 'ecr_image'];
  isGlobal = false;

  async discover(context: DiscoveryContext, cursorStr?: string): Promise<ServiceDiscoveryPage> {
    const cursor: EcrCursor = cursorStr ? JSON.parse(cursorStr) : { regionIndex: 0 };
    const assets: DiscoveredAsset[] = [];
    const coveredRegions = new Set<string>();

    let { regionIndex, repoNextToken, currentRepoArn, currentRepoName, imageNextToken } = cursor;

    while (regionIndex < context.regions.length && assets.length < PAGE_SIZE) {
      const region = context.regions[regionIndex];
      coveredRegions.add(region);

      const client = new ECRClient({
        region,
        credentials: {
          accessKeyId: context.credentials.accessKeyId,
          secretAccessKey: context.credentials.secretAccessKey,
          sessionToken: context.credentials.sessionToken,
        },
      });

      try {
        // If we're in the middle of paginating images for a repo, continue
        if (currentRepoArn && currentRepoName) {
          const imageResult = await this.describeImagesWithRetry(
            client,
            currentRepoName,
            imageNextToken,
            context.signal,
          );

          for (const image of imageResult.images) {
            if (assets.length >= PAGE_SIZE) {
              return {
                assets,
                nextCursor: JSON.stringify({
                  regionIndex,
                  currentRepoArn,
                  currentRepoName,
                  imageNextToken: imageResult.nextToken,
                } satisfies EcrCursor),
                scannedScopes: this.buildScopes(coveredRegions),
              };
            }

            assets.push(this.mapImage(image, currentRepoName, region, context.accountIdentifier));
          }

          if (imageResult.nextToken) {
            imageNextToken = imageResult.nextToken;
            continue;
          }

          // Done with this repo's images — move to next repo
          currentRepoArn = undefined;
          currentRepoName = undefined;
          imageNextToken = undefined;
        }

        // Paginate repositories in this region
        const repoResult = await this.describeReposWithRetry(client, repoNextToken, context.signal);

        for (const repo of repoResult.repos) {
          if (assets.length >= PAGE_SIZE) {
            return {
              assets,
              nextCursor: JSON.stringify({
                regionIndex,
                repoNextToken: repoResult.nextToken,
              } satisfies EcrCursor),
              scannedScopes: this.buildScopes(coveredRegions),
            };
          }

          // Add repo as asset
          assets.push(this.mapRepository(repo, region, context.accountIdentifier));

          // Start paginating images for this repo
          const imageResult = await this.describeImagesWithRetry(
            client,
            repo.repositoryName!,
            undefined,
            context.signal,
          );

          for (const image of imageResult.images) {
            if (assets.length >= PAGE_SIZE) {
              return {
                assets,
                nextCursor: JSON.stringify({
                  regionIndex,
                  repoNextToken: repoResult.nextToken,
                  currentRepoArn: repo.repositoryArn,
                  currentRepoName: repo.repositoryName,
                  imageNextToken: imageResult.nextToken,
                } satisfies EcrCursor),
                scannedScopes: this.buildScopes(coveredRegions),
              };
            }

            assets.push(
              this.mapImage(image, repo.repositoryName!, region, context.accountIdentifier),
            );
          }

          if (imageResult.nextToken) {
            currentRepoArn = repo.repositoryArn;
            currentRepoName = repo.repositoryName;
            imageNextToken = imageResult.nextToken;
            break;
          }
        }

        if (currentRepoArn) {
          continue;
        }

        if (repoResult.nextToken) {
          repoNextToken = repoResult.nextToken;
        } else {
          regionIndex++;
          repoNextToken = undefined;
        }
      } finally {
        client.destroy();
      }
    }

    const nextCursor =
      regionIndex < context.regions.length
        ? JSON.stringify({
            regionIndex,
            repoNextToken,
            currentRepoArn,
            currentRepoName,
            imageNextToken,
          } satisfies EcrCursor)
        : undefined;

    return {
      assets,
      nextCursor,
      scannedScopes: this.buildScopes(coveredRegions),
    };
  }

  private buildScopes(coveredRegions: Set<string>): { assetType: string; region: string }[] {
    const scopes: { assetType: string; region: string }[] = [];
    for (const region of coveredRegions) {
      for (const assetType of this.assetTypes) {
        scopes.push({ assetType, region });
      }
    }
    return scopes;
  }

  private mapRepository(repo: Repository, region: string, _accountId: string): DiscoveredAsset {
    return {
      assetType: 'ecr_repository',
      externalId: repo.repositoryArn!,
      name: repo.repositoryName!,
      region,
      metadata: {
        repositoryUri: repo.repositoryUri,
        registryId: repo.registryId,
        imageScanningConfiguration: repo.imageScanningConfiguration,
        imageTagMutability: repo.imageTagMutability,
        encryptionConfiguration: repo.encryptionConfiguration,
        createdAt: repo.createdAt?.toISOString(),
      },
    };
  }

  private mapImage(
    image: ImageDetail,
    repoName: string,
    region: string,
    _accountId: string,
  ): DiscoveredAsset {
    const digest = image.imageDigest ?? 'unknown';
    const arn = `arn:aws:ecr:${region}:${image.registryId}:repository/${repoName}@${digest}`;

    return {
      assetType: 'ecr_image',
      externalId: arn,
      name: `${repoName}@${digest.substring(0, 19)}`,
      region,
      metadata: {
        imageDigest: image.imageDigest,
        imageTags: image.imageTags,
        imageSizeInBytes: image.imageSizeInBytes,
        imagePushedAt: image.imagePushedAt?.toISOString(),
        imageManifestMediaType: image.imageManifestMediaType,
        artifactMediaType: image.artifactMediaType,
        lastRecordedPullTime: image.lastRecordedPullTime?.toISOString(),
        imageScanStatus: image.imageScanStatus,
        imageScanFindingsSummary: image.imageScanFindingsSummary,
      },
    };
  }

  private async describeReposWithRetry(
    client: ECRClient,
    nextToken?: string,
    signal?: AbortSignal,
  ): Promise<{ repos: Repository[]; nextToken?: string }> {
    return this.withRetry(async () => {
      const response = await client.send(
        new DescribeRepositoriesCommand({
          maxResults: 100,
          nextToken,
        }),
        { abortSignal: signal },
      );
      return {
        repos: response.repositories ?? [],
        nextToken: response.nextToken,
      };
    });
  }

  private async describeImagesWithRetry(
    client: ECRClient,
    repositoryName: string,
    nextToken?: string,
    signal?: AbortSignal,
  ): Promise<{ images: ImageDetail[]; nextToken?: string }> {
    return this.withRetry(async () => {
      const response = await client.send(
        new DescribeImagesCommand({
          repositoryName,
          maxResults: 100,
          nextToken,
        }),
        { abortSignal: signal },
      );
      return {
        images: response.imageDetails ?? [],
        nextToken: response.nextToken,
      };
    });
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const isThrottled =
          error?.name === 'ThrottlingException' ||
          error?.name === 'TooManyRequestsException' ||
          error?.$metadata?.httpStatusCode === 429;

        if (!isThrottled || attempt === maxRetries) {
          throw error;
        }

        const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
        const jitter = backoff * (0.5 + Math.random() * 0.5);
        await new Promise((resolve) => setTimeout(resolve, jitter));
      }
    }
    throw new Error('Unreachable');
  }
}

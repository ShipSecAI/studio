import { Injectable, Logger } from '@nestjs/common';

import type { GithubEventEnvelope, GithubPullRequestInfo, GithubRepositoryInfo } from './github.types';
import { GithubDispatchService } from './github-dispatch.service';

interface NormalizeResult extends GithubEventEnvelope {}

@Injectable()
export class GithubWebhookService {
  private readonly logger = new Logger(GithubWebhookService.name);

  constructor(private readonly dispatch: GithubDispatchService) {}

  async handleWebhook(envelope: GithubEventEnvelope): Promise<void> {
    this.logger.log(
      `[GitHub] ${envelope.event} delivery=${envelope.deliveryId} repo=${envelope.repository.fullName}`,
    );

    if (envelope.pullRequest?.head.sha) {
      this.logger.debug(
        `[GitHub] PR #${envelope.pullRequest.number} head=${envelope.pullRequest.head.sha} dedupe=${envelope.dedupeKey}`,
      );
    }

    await this.dispatch.dispatch(envelope);
  }

  normalizePayload(
    payload: any,
    metadata: { event: string; deliveryId: string; signature: string | undefined },
  ): NormalizeResult {
    const repo = this.extractRepo(payload);
    const pr = this.extractPullRequest(payload);

    const headSha = pr?.head.sha ?? 'no-sha';
    const dedupeKey = `${metadata.deliveryId}:${headSha}`;

    return {
      event: metadata.event,
      deliveryId: metadata.deliveryId,
      installationId: payload?.installation?.id ?? null,
      repository: repo,
      pullRequest: pr,
      dedupeKey,
      rawPayload: payload,
    };
  }

  private extractRepo(payload: any): GithubRepositoryInfo {
    const fullName: string =
      payload?.repository?.full_name ??
      [payload?.repository?.owner?.login, payload?.repository?.name]
        .filter(Boolean)
        .join('/') ??
      'unknown/unknown';

    const [owner, name] = fullName.split('/');

    return {
      owner: owner ?? 'unknown',
      name: name ?? 'unknown',
      fullName,
    };
  }

  private extractPullRequest(payload: any): GithubPullRequestInfo | null {
    const pr = payload?.pull_request;
    if (!pr) {
      return null;
    }

    const labels: string[] =
      Array.isArray(pr.labels) && pr.labels.length > 0
        ? pr.labels.map((label: any) => label?.name).filter(Boolean)
        : [];

    const headRepoFullName =
      pr.head?.repo?.full_name ??
      [pr.head?.repo?.owner?.login, pr.head?.repo?.name].filter(Boolean).join('/') ??
      null;
    const baseRepoFullName =
      pr.base?.repo?.full_name ??
      [pr.base?.repo?.owner?.login, pr.base?.repo?.name].filter(Boolean).join('/') ??
      null;

    return {
      number: pr.number ?? -1,
      head: {
        sha: pr.head?.sha ?? null,
        ref: pr.head?.ref ?? null,
        repoFullName: headRepoFullName,
        repoOwner: pr.head?.repo?.owner?.login ?? null,
      },
      base: {
        sha: pr.base?.sha ?? null,
        ref: pr.base?.ref ?? null,
        repoFullName: baseRepoFullName,
        repoOwner: pr.base?.repo?.owner?.login ?? null,
      },
      author: pr.user?.login ?? null,
      labels,
    };
  }
}

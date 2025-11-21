import { Injectable, Logger } from '@nestjs/common';

import type { GithubEventEnvelope } from './github.types';
import { TemporalService } from '../temporal/temporal.service';

@Injectable()
export class GithubDispatchService {
  private readonly logger = new Logger(GithubDispatchService.name);
  private readonly seen = new Set<string>();

  constructor(private readonly temporal: TemporalService) {}

  async dispatch(event: GithubEventEnvelope): Promise<void> {
    if (!event.pullRequest?.head.sha) {
      this.logger.warn(
        `[Dispatch] Skipping event without PR head SHA (delivery=${event.deliveryId}, repo=${event.repository.fullName})`,
      );
      return;
    }

    if (this.seen.has(event.dedupeKey)) {
      this.logger.log(
        `[Dispatch] Duplicate delivery ignored (dedupe=${event.dedupeKey}, repo=${event.repository.fullName})`,
      );
      return;
    }

    this.seen.add(event.dedupeKey);

    this.logger.log(
      `[Dispatch] Ready to enqueue GitHub PR event (repo=${event.repository.fullName}, pr=#${event.pullRequest.number}, head=${event.pullRequest.head.sha}, dedupe=${event.dedupeKey})`,
    );

    // Quick demo: start minimal workflow carrying the envelope as args.
    const workflowId = `github-demo-${event.dedupeKey}`.slice(0, 64);
    await this.temporal.startWorkflow({
      workflowType: 'minimalWorkflow',
      workflowId,
      args: [event],
      memo: {
        source: 'github-demo',
        repo: event.repository.fullName,
        delivery: event.deliveryId,
      },
    });
  }
}

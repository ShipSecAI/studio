import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';

import { IntegrationsService } from '../integrations/integrations.service';
import { SlackService } from '../integrations/slack.service';
import { SlackThreadMappingRepository } from './slack-thread-mapping.repository';
import { renderSlackMessagePayloads } from './slack-message-renderer';
import { ChatService } from '../chat/chat.service';
import { SlackTurnPostRepository } from './slack-turn-post.repository';

/**
 * Subscribes to chat session events via Redis pub/sub and relays
 * agent responses (and web user messages) to Slack threads.
 *
 * Does NOT depend on SlackBotService to avoid circular dependencies.
 */
@Injectable()
export class SlackEventBridge implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackEventBridge.name);
  private subscriber: Redis | null = null;
  private readonly subscribedSessions = new Set<string>();
  private readonly responseBuffers = new Map<string, { text: string; finalText?: string }>();
  // Serializes concurrent postTurnToThread calls for the same turnId (P1: race condition fix)
  private readonly turnLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly slack: SlackService,
    private readonly threadMappings: SlackThreadMappingRepository,
    private readonly chatService: ChatService,
    private readonly turnPosts: SlackTurnPostRepository,
  ) {}

  async onModuleInit() {
    if (process.env.SLACK_BOT_ENABLED !== 'true') {
      this.logger.log('Slack bot disabled — skipping event bridge initialization');
      return;
    }

    try {
      const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
      this.subscriber = new Redis(redisUrl);

      this.subscriber.on('message', (channel, message) => {
        this.handleRedisMessage(channel, message).catch((err) => {
          this.logger.error(`Error handling Redis message: ${err.message}`);
        });
      });

      await this.subscribeToActiveSessions();

      this.logger.log('Slack event bridge initialized');
    } catch (err: any) {
      this.logger.error(`Failed to initialize Slack event bridge: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
  }

  async subscribeToSession(sessionId: string): Promise<void> {
    if (!this.subscriber || this.subscribedSessions.has(sessionId)) return;

    const channel = `chat:stream:${sessionId}`;
    await this.subscriber.subscribe(channel);
    this.subscribedSessions.add(sessionId);
    this.logger.debug(`Subscribed to session ${sessionId}`);
  }

  async unsubscribeFromSession(sessionId: string): Promise<void> {
    if (!this.subscriber || !this.subscribedSessions.has(sessionId)) return;

    const channel = `chat:stream:${sessionId}`;
    await this.subscriber.unsubscribe(channel);
    this.subscribedSessions.delete(sessionId);
    this.responseBuffers.delete(sessionId);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async subscribeToActiveSessions(): Promise<void> {
    const mappings = await this.threadMappings.findAllActiveMappings();
    for (const mapping of mappings) {
      await this.subscribeToSession(mapping.sessionId);
    }
    this.logger.log(`Subscribed to ${mappings.length} active Slack-mapped sessions`);
  }

  private async handleRedisMessage(channel: string, rawMessage: string): Promise<void> {
    const sessionId = channel.replace('chat:stream:', '');
    if (!this.subscribedSessions.has(sessionId)) return;

    try {
      const event = JSON.parse(rawMessage);
      const chunk = event.chunk ?? event;

      switch (chunk.type) {
        case 'text-delta':
          this.accumulateText(event.turnId, chunk.textDelta ?? chunk.delta ?? '');
          break;

        case 'finish':
          if (typeof chunk.responseText === 'string' && chunk.responseText.length > 0) {
            this.setFinalText(event.turnId, chunk.responseText);
          }
          break;

        case 'data-turn-status': {
          const data = (chunk.data ?? {}) as Record<string, unknown>;
          const status = data.status as string | undefined;
          const isTerminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(
            status ?? '',
          );

          if (status === 'completed') {
            const text = await this.resolveCompletedText(sessionId, event.turnId);
            if (text?.trim()) {
              await this.postTurnToThread(sessionId, event.turnId, text);
            }
          } else if (status === 'running') {
            await this.postTurnStatusPlaceholder(sessionId, event.turnId, status);
          } else if (isTerminal && status) {
            const stale = this.getBufferedText(event.turnId);
            if (stale?.length) {
              this.logger.warn(
                `Turn ${status} for session ${sessionId}, discarding ${stale.length} chars`,
              );
            }
            await this.postTurnStatusPlaceholder(sessionId, event.turnId, status);
          }

          if (isTerminal) {
            this.responseBuffers.delete(event.turnId);
          }

          if (status === 'queued') {
            const clientId = (data.clientSubmissionId as string) ?? '';
            if (!clientId.startsWith('slack-')) {
              const preview = (data.preview as string) ?? (data.text as string);
              if (preview) {
                await this.postToThread(sessionId, preview, true);
              }
            }
          }
          break;
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to parse Redis message for ${sessionId}: ${err.message}`);
    }
  }

  private accumulateText(turnId: string, delta: string): void {
    if (delta.length === 0) return;
    const current = this.responseBuffers.get(turnId) ?? { text: '' };
    current.text += delta;
    this.responseBuffers.set(turnId, current);
  }

  private setFinalText(turnId: string, text: string): void {
    const current = this.responseBuffers.get(turnId) ?? { text: '' };
    current.finalText = text;
    this.responseBuffers.set(turnId, current);
  }

  private getBufferedText(turnId: string): string {
    const current = this.responseBuffers.get(turnId);
    return current?.finalText ?? current?.text ?? '';
  }

  private async resolveCompletedText(sessionId: string, turnId: string): Promise<string> {
    const retries = [0, 100, 250, 500];

    for (const delayMs of retries) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const persisted = await this.chatService.getAssistantTextForTurnInternal(sessionId, turnId);
      if (persisted?.trim()) {
        return persisted;
      }
    }

    return this.getBufferedText(turnId);
  }

  /**
   * Post a message to the Slack thread mapped to a session.
   * Handles token resolution and chunking internally.
   */
  private async postToThread(sessionId: string, text: string, isUserEcho = false): Promise<void> {
    const mapping = await this.threadMappings.findBySessionId(sessionId);
    if (!mapping) return;

    let botToken: string;
    try {
      const credentials = await this.integrations.resolveConnectionCredentials(
        mapping.connectionId,
      );
      botToken = credentials.data?.accessToken as string;
      if (!botToken) return;
    } catch {
      this.logger.error(`Failed to resolve bot token for connection ${mapping.connectionId}`);
      return;
    }

    const message = isUserEcho ? `_via ShipSec:_ ${text}` : text;
    const isDm = mapping.slackThreadTs.startsWith('dm:');
    const payloads = renderSlackMessagePayloads(message);

    for (const payload of payloads) {
      // DMs: post as channel message (no threading). Channels: post as thread reply.
      const result = isDm
        ? await this.slack.sendMessage(
            botToken,
            mapping.slackChannelId,
            payload.text,
            payload.blocks,
          )
        : await this.slack.postThreadMessage(
            botToken,
            mapping.slackChannelId,
            payload.text,
            mapping.slackThreadTs,
            payload.blocks,
          );
      if (!result.ok) {
        this.logger.error(`Failed to post to Slack thread: ${result.error}`);
        break;
      }
    }
  }

  private async postTurnToThread(sessionId: string, turnId: string, text: string): Promise<void> {
    const prev = this.turnLocks.get(turnId) ?? Promise.resolve();
    const next = prev.then(() => this.doPostTurnToThread(sessionId, turnId, text));
    this.turnLocks.set(
      turnId,
      next.catch(() => {}),
    );
    return next;
  }

  private async doPostTurnToThread(sessionId: string, turnId: string, text: string): Promise<void> {
    const mapping = await this.threadMappings.findBySessionId(sessionId);
    if (!mapping) return;

    let botToken: string;
    try {
      const credentials = await this.integrations.resolveConnectionCredentials(
        mapping.connectionId,
      );
      botToken = credentials.data?.accessToken as string;
      if (!botToken) return;
    } catch {
      this.logger.error(`Failed to resolve bot token for connection ${mapping.connectionId}`);
      return;
    }

    const payloads = renderSlackMessagePayloads(text);
    const contentHash = createHash('sha256').update(JSON.stringify(payloads)).digest('hex');
    const record = await this.turnPosts.reserve(sessionId, turnId);

    if (record.lastContentHash === contentHash && record.primaryMessageTs) {
      return;
    }

    const continuationTs = [...(record.continuationMessageTs ?? [])];
    let primaryTs = record.primaryMessageTs ?? null;

    const ensurePrimary = async () => {
      if (!primaryTs) {
        const created = await this.slack.postThreadMessage(
          botToken,
          mapping.slackChannelId,
          payloads[0].text,
          mapping.slackThreadTs,
          payloads[0].blocks,
        );
        if (!created.ok || !created.ts) {
          throw new Error(created.error ?? 'Failed to create primary Slack turn message');
        }
        primaryTs = created.ts;
        this.logger.log(`Created primary Slack message for turn ${turnId}: ${primaryTs}`);
        return;
      }

      const updated = await this.slack.updateMessage(
        botToken,
        mapping.slackChannelId,
        primaryTs,
        payloads[0].text,
        payloads[0].blocks,
      );
      if (!updated.ok) {
        throw new Error(updated.error ?? 'Failed to update primary Slack turn message');
      }
      this.logger.log(`Updated primary Slack message for turn ${turnId}: ${primaryTs}`);
    };

    try {
      await ensurePrimary();

      for (let i = 1; i < payloads.length; i++) {
        const existingTs = continuationTs[i - 1];
        if (existingTs) {
          const updated = await this.slack.updateMessage(
            botToken,
            mapping.slackChannelId,
            existingTs,
            payloads[i].text,
            payloads[i].blocks,
          );
          if (!updated.ok) {
            throw new Error(updated.error ?? `Failed to update continuation Slack message ${i}`);
          }
          continue;
        }

        const created = await this.slack.postThreadMessage(
          botToken,
          mapping.slackChannelId,
          payloads[i].text,
          mapping.slackThreadTs,
          payloads[i].blocks,
        );
        if (!created.ok || !created.ts) {
          throw new Error(created.error ?? `Failed to create continuation Slack message ${i}`);
        }
        continuationTs.push(created.ts);
      }

      while (continuationTs.length > payloads.length - 1) {
        const extraTs = continuationTs[continuationTs.length - 1];
        if (!extraTs) break;
        const deleted = await this.slack.deleteMessage(botToken, mapping.slackChannelId, extraTs);
        if (!deleted.ok) {
          this.logger.warn(`Failed to delete orphaned Slack message ${extraTs}: ${deleted.error}`);
          break;
        }
        continuationTs.pop();
      }

      await this.turnPosts.saveMessages(turnId, {
        primaryMessageTs: primaryTs!,
        continuationMessageTs: continuationTs,
        lastContentHash: contentHash,
      });
    } catch (error) {
      this.logger.error(
        `Failed to sync Slack turn ${turnId} for session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private getTurnStatusText(status: string): string | null {
    switch (status) {
      case 'running':
        return ':mag: ShipSecBot is investigating...';
      case 'failed':
        return ':warning: ShipSecBot hit an error before finishing this reply.';
      case 'interrupted':
        return ':pause_button: ShipSecBot stopped that reply.';
      case 'cancelled':
        return ':no_entry_sign: ShipSecBot cancelled that reply.';
      default:
        return null;
    }
  }

  private async postTurnStatusPlaceholder(
    sessionId: string,
    turnId: string,
    status: string,
  ): Promise<void> {
    const text = this.getTurnStatusText(status);
    if (!text) {
      return;
    }
    await this.postTurnToThread(sessionId, turnId, text);
  }
}

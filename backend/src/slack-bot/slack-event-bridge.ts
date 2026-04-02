import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { IntegrationsService } from '../integrations/integrations.service';
import { SlackService } from '../integrations/slack.service';
import { SlackThreadMappingRepository } from './slack-thread-mapping.repository';

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
  private readonly responseBuffers = new Map<string, string>();

  constructor(
    private readonly integrations: IntegrationsService,
    private readonly slack: SlackService,
    private readonly threadMappings: SlackThreadMappingRepository,
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
          this.accumulateText(sessionId, chunk.textDelta ?? chunk.delta ?? '');
          break;

        case 'data-turn-status': {
          const data = (chunk.data ?? {}) as Record<string, unknown>;
          const status = data.status as string | undefined;
          const isTerminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(
            status ?? '',
          );

          if (status === 'completed') {
            const text = this.responseBuffers.get(sessionId);
            if (text?.trim()) {
              await this.postToThread(sessionId, text);
            }
          } else if (isTerminal) {
            const stale = this.responseBuffers.get(sessionId);
            if (stale) {
              this.logger.warn(
                `Turn ${status} for session ${sessionId}, discarding ${stale.length} chars`,
              );
            }
          }

          if (isTerminal) {
            this.responseBuffers.delete(sessionId);
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

  private accumulateText(sessionId: string, delta: string): void {
    const current = this.responseBuffers.get(sessionId) ?? '';
    this.responseBuffers.set(sessionId, current + delta);
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

    // Chunk long messages for Slack readability
    const chunks = this.chunkMessage(message, 3500);
    for (const chunk of chunks) {
      // DMs: post as channel message (no threading). Channels: post as thread reply.
      const result = isDm
        ? await this.slack.sendMessage(botToken, mapping.slackChannelId, chunk)
        : await this.slack.postThreadMessage(
            botToken,
            mapping.slackChannelId,
            chunk,
            mapping.slackThreadTs,
          );
      if (!result.ok) {
        this.logger.error(`Failed to post to Slack thread: ${result.error}`);
        break;
      }
    }
  }

  private chunkMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      let breakAt = remaining.lastIndexOf('\n', maxLength);
      if (breakAt <= 0) breakAt = maxLength;
      chunks.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).trimStart();
    }
    return chunks;
  }
}

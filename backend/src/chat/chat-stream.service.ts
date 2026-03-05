import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { TERMINAL_REDIS } from '../terminal/terminal-stream.service';

export interface ChatStreamEvent {
  type: string;
  [key: string]: unknown;
}

export interface ChatStreamSubscription {
  unsubscribe(): void;
}

interface SubscriptionCallbacks {
  onEvent: (event: ChatStreamEvent) => void;
  onComplete: () => void;
  onError: (err: Error) => void;
  shouldComplete?: (event: ChatStreamEvent) => boolean;
}

@Injectable()
export class ChatStreamService {
  private readonly logger = new Logger(ChatStreamService.name);
  private subscriber: Redis | null = null;
  private readonly subscriptionsByChannel = new Map<string, Map<string, SubscriptionCallbacks>>();
  private nextSubscriptionId = 0;

  constructor(@Optional() @Inject(TERMINAL_REDIS) private readonly redis: Redis | null) {
    if (this.redis) {
      // Create a duplicate connection for subscribing (Redis requires separate connections
      // for pub/sub subscribers vs regular commands)
      this.subscriber = this.redis.duplicate();
      this.subscriber.on('message', this.handleMessage);
      this.logger.log('Chat stream service initialized with Redis pub/sub');
    } else {
      this.logger.warn('Chat stream service: Redis not available, streaming disabled');
    }
  }

  private readonly handleMessage = (channel: string, message: string) => {
    const channelSubscriptions = this.subscriptionsByChannel.get(channel);
    if (!channelSubscriptions || channelSubscriptions.size === 0) {
      return;
    }

    let event: ChatStreamEvent;
    try {
      event = JSON.parse(message) as ChatStreamEvent;
    } catch {
      return;
    }

    for (const [subscriptionId, callbacks] of channelSubscriptions.entries()) {
      try {
        callbacks.onEvent(event);

        if (callbacks.shouldComplete?.(event)) {
          setTimeout(() => {
            this.unsubscribeChannelSubscription(channel, subscriptionId);
            callbacks.onComplete();
          }, 100);
        }
      } catch {
        // Best-effort fan-out to subscribers
      }
    }
  };

  private unsubscribeChannelSubscription(channel: string, subscriptionId: string): void {
    const channelSubscriptions = this.subscriptionsByChannel.get(channel);
    if (!channelSubscriptions) {
      return;
    }

    channelSubscriptions.delete(subscriptionId);
    if (channelSubscriptions.size > 0) {
      return;
    }

    this.subscriptionsByChannel.delete(channel);
    this.subscriber?.unsubscribe(channel).catch(() => {});
  }

  /**
   * Subscribe to a chat session's stream channel.
   * Calls onEvent for each event, onComplete when the agent finishes, onError on errors.
   * Returns a subscription that can be unsubscribed.
   */
  subscribe(sessionId: string, callbacks: SubscriptionCallbacks): ChatStreamSubscription {
    if (!this.subscriber) {
      // No Redis - emit idle immediately and complete
      callbacks.onEvent({ type: 'status', status: 'idle' });
      callbacks.onComplete();
      return { unsubscribe: () => {} };
    }

    const channel = `chat:stream:${sessionId}`;
    const subscriptionId = `sub-${++this.nextSubscriptionId}`;
    let unsubscribed = false;

    const cleanup = (): void => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.unsubscribeChannelSubscription(channel, subscriptionId);
    };

    const existingSubscriptions = this.subscriptionsByChannel.get(channel);
    if (existingSubscriptions) {
      existingSubscriptions.set(subscriptionId, callbacks);
    } else {
      const channelSubscriptions = new Map<string, SubscriptionCallbacks>();
      channelSubscriptions.set(subscriptionId, callbacks);
      this.subscriptionsByChannel.set(channel, channelSubscriptions);

      this.subscriber.subscribe(channel).catch((err: Error) => {
        this.logger.error(`Failed to subscribe to ${channel}: ${err}`);
        cleanup();
        callbacks.onError(err);
      });
    }

    return { unsubscribe: cleanup };
  }

  isAvailable(): boolean {
    return (
      this.redis != null &&
      this.subscriber != null &&
      this.redis.status === 'ready' &&
      this.subscriber.status === 'ready'
    );
  }

  async publish(sessionId: string, event: Record<string, unknown>): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.publish(`chat:stream:${sessionId}`, JSON.stringify(event));
    } catch (error) {
      // DB-backed replay is authoritative; losing pub/sub fanout should not fail event ingestion.
      this.logger.warn(
        `Failed to publish chat stream event for session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

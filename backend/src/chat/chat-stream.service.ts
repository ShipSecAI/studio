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

@Injectable()
export class ChatStreamService {
  private readonly logger = new Logger(ChatStreamService.name);
  private subscriber: Redis | null = null;

  constructor(@Optional() @Inject(TERMINAL_REDIS) private readonly redis: Redis | null) {
    if (this.redis) {
      // Create a duplicate connection for subscribing (Redis requires separate connections
      // for pub/sub subscribers vs regular commands)
      this.subscriber = this.redis.duplicate();
      this.logger.log('Chat stream service initialized with Redis pub/sub');
    } else {
      this.logger.warn('Chat stream service: Redis not available, streaming disabled');
    }
  }

  /**
   * Subscribe to a chat session's stream channel.
   * Calls onEvent for each event, onComplete when the agent finishes, onError on errors.
   * Returns a subscription that can be unsubscribed.
   */
  subscribe(
    sessionId: string,
    callbacks: {
      onEvent: (event: ChatStreamEvent) => void;
      onComplete: () => void;
      onError: (err: Error) => void;
      shouldComplete?: (event: ChatStreamEvent) => boolean;
    },
  ): ChatStreamSubscription {
    if (!this.subscriber) {
      // No Redis - emit idle immediately and complete
      callbacks.onEvent({ type: 'status', status: 'idle' });
      callbacks.onComplete();
      return { unsubscribe: () => {} };
    }

    const channel = `chat:stream:${sessionId}`;
    let unsubscribed = false;

    const cleanup = () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.subscriber?.unsubscribe(channel).catch(() => {});
      this.subscriber?.off('message', messageHandler);
    };

    const messageHandler = (ch: string, message: string) => {
      if (ch !== channel || unsubscribed) return;
      try {
        const event = JSON.parse(message) as ChatStreamEvent;
        callbacks.onEvent(event);

        if (callbacks.shouldComplete?.(event)) {
          setTimeout(() => {
            cleanup();
            callbacks.onComplete();
          }, 100);
        }
      } catch {
        // Ignore parse errors
      }
    };

    this.subscriber.on('message', messageHandler);
    this.subscriber.subscribe(channel).catch((err: Error) => {
      this.logger.error(`Failed to subscribe to ${channel}: ${err}`);
      cleanup();
      callbacks.onError(err);
    });

    return { unsubscribe: cleanup };
  }
}

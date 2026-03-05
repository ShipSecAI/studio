import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer } from 'kafkajs';
import { getTopicResolver } from '../common/kafka-topic-resolver';
import { createKafkaClient } from '../common/kafka-client';

import { ChatSessionEventRepository } from './chat-session-event.repository';
import { ChatTurnDraftRepository } from './chat-turn-draft.repository';
import { ChatTurnRepository } from './chat-turn.repository';
import { ChatSessionRepository } from './chat-session.repository';
import { ChatStreamService } from './chat-stream.service';
import { applyTurnStatus } from './chat-turn-status.util';

interface KafkaChatChunkPayload {
  sessionId: string;
  turnId: string;
  runId: string;
  generationId: string;
  eventId: string;
  chunk: Record<string, unknown>;
}

@Injectable()
export class ChatStreamIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatStreamIngestService.name);
  private readonly kafkaBrokers: string[];
  private readonly kafkaTopic: string;
  private readonly kafkaGroupId: string;
  private readonly kafkaClientId: string;
  private consumer: Consumer | undefined;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectResetTimer: NodeJS.Timeout | null = null;
  private connectInFlight: Promise<void> | null = null;
  private reconnectAttempts = 0;
  private isShuttingDown = false;

  constructor(
    private readonly sessionEventRepository: ChatSessionEventRepository,
    private readonly turnDraftRepository: ChatTurnDraftRepository,
    private readonly turnRepository: ChatTurnRepository,
    private readonly sessionRepository: ChatSessionRepository,
    private readonly chatStreamService: ChatStreamService,
  ) {
    const brokerEnv = process.env.LOG_KAFKA_BROKERS ?? '';
    this.kafkaBrokers = brokerEnv
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);

    const topicResolver = getTopicResolver();
    this.kafkaTopic = topicResolver.getChatStreamTopic();
    this.kafkaGroupId = process.env.CHAT_STREAM_KAFKA_GROUP_ID ?? 'shipsec-chat-stream-ingestor';
    this.kafkaClientId = process.env.CHAT_STREAM_KAFKA_CLIENT_ID ?? 'shipsec-backend-chat-stream';
  }

  async onModuleInit(): Promise<void> {
    if (this.kafkaBrokers.length === 0) {
      this.logger.warn(
        'No Kafka brokers configured, skipping chat stream ingest service initialization',
      );
      return;
    }

    this.ensureConnected().catch((error) => {
      this.logger.error('Failed to initialize Kafka chat stream ingestion', error as Error);
    });
  }

  private ensureConnected(): Promise<void> {
    if (this.isShuttingDown) return Promise.resolve();
    if (this.connectInFlight) return this.connectInFlight;

    this.connectInFlight = this.connectToKafka().finally(() => {
      this.connectInFlight = null;
    });
    return this.connectInFlight;
  }

  private async disconnectConsumer(consumer: Consumer): Promise<void> {
    (consumer as any).removeAllListeners?.();
    await consumer.disconnect().catch(() => {});
  }

  private async connectToKafka(): Promise<void> {
    if (this.isShuttingDown) return;

    if (this.consumer) {
      const old = this.consumer;
      this.consumer = undefined;
      await this.disconnectConsumer(old);
    }

    let nextConsumer: Consumer | undefined;
    try {
      const kafka = createKafkaClient({
        clientId: this.kafkaClientId,
        brokers: this.kafkaBrokers,
        requestTimeout: 30000,
        retry: {
          retries: 10,
          initialRetryTime: 100,
          maxRetryTime: 30000,
        },
      });

      nextConsumer = kafka.consumer({
        groupId: this.kafkaGroupId,
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
      });
      this.consumer = nextConsumer;

      nextConsumer.on(nextConsumer.events.CRASH, (event) => {
        if (this.isShuttingDown || this.consumer !== nextConsumer) return;
        if (event.payload?.restart) {
          this.logger.warn(
            `Kafka consumer crashed and will restart internally: ${event.payload?.error ?? 'unknown'}`,
          );
          return;
        }
        this.logger.error(`Kafka consumer crashed: ${event.payload?.error ?? 'unknown'}`);
        this.scheduleReconnect();
      });

      await nextConsumer.connect();
      await nextConsumer.subscribe({ topic: this.kafkaTopic, fromBeginning: true });

      if (this.reconnectResetTimer) {
        clearTimeout(this.reconnectResetTimer);
      }
      this.reconnectResetTimer = setTimeout(() => {
        if (this.isShuttingDown || this.consumer !== nextConsumer) return;
        this.reconnectAttempts = 0;
      }, 30_000);

      this.logger.log(
        `Kafka chat stream ingestion connected (${this.kafkaBrokers.join(', ')}) topic=${this.kafkaTopic}`,
      );

      void nextConsumer
        .run({
          eachMessage: async ({ message, topic, partition }) => {
            const messageOffset = message.offset;
            if (!message.value) {
              this.logger.warn(
                `Received empty message from ${topic}[${partition}]@${messageOffset}`,
              );
              return;
            }
            try {
              const payload = JSON.parse(message.value.toString()) as KafkaChatChunkPayload;
              await this.processMessage(payload);
            } catch (error) {
              this.logger.error(
                `Failed to process chat stream event from Kafka (topic=${topic}, partition=${partition}, offset=${messageOffset})`,
                error as Error,
              );
            }
          },
        })
        .catch((error) => {
          if (this.isShuttingDown || this.consumer !== nextConsumer) return;
          this.logger.error('Kafka chat stream ingestion run loop failed', error as Error);
          this.scheduleReconnect();
        });
    } catch (error) {
      if (nextConsumer) {
        if (this.consumer === nextConsumer) this.consumer = undefined;
        await this.disconnectConsumer(nextConsumer);
      }
      this.logger.error('Failed to connect to Kafka chat stream ingestion', error as Error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown || this.reconnectTimer || this.connectInFlight) return;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempts, 5));
    this.reconnectAttempts += 1;
    this.logger.warn(`Retrying Kafka connection in ${delayMs}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected().catch(() => {});
    }, delayMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.reconnectResetTimer) {
      clearTimeout(this.reconnectResetTimer);
      this.reconnectResetTimer = null;
    }
    if (this.consumer) {
      const current = this.consumer;
      this.consumer = undefined;
      this.logger.log('Disconnecting Kafka chat stream consumer...');
      await this.disconnectConsumer(current).catch((error) => {
        this.logger.error('Failed to disconnect Kafka chat stream consumer', error as Error);
      });
      this.logger.log('Kafka chat stream consumer disconnected');
    }
  }

  private async processMessage(payload: KafkaChatChunkPayload): Promise<void> {
    const { sessionId, turnId, runId, generationId, eventId, chunk } = payload;

    // 1. Persist to session events table → get monotonic seq
    const seq = await this.sessionEventRepository.append({
      sessionId,
      turnId,
      runId,
      generationId,
      eventId,
      chunk,
    });

    // 2. Upsert turn draft for reconnecting clients
    await this.turnDraftRepository.upsert(turnId, chunk, seq);

    // 3. Apply turn status side-effects
    await applyTurnStatus(
      {
        turnRepository: this.turnRepository,
        sessionRepository: this.sessionRepository,
      },
      sessionId,
      turnId,
      chunk,
      runId,
      generationId,
    );

    // 4. Fan out via Redis pub/sub → SSE connections
    await this.chatStreamService.publish(sessionId, {
      seq,
      turnId,
      runId,
      generationId,
      eventId,
      chunk,
    });
  }
}

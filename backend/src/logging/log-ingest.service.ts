import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer } from 'kafkajs';
import { getTopicResolver } from '../common/kafka-topic-resolver';
import { createKafkaClient } from '../common/kafka-client';

import { LogStreamRepository } from '../trace/log-stream.repository';
import type { KafkaLogEntry } from './log-entry.types';
import { LokiLogClient } from './loki.client';
import { redactSensitiveData } from './redact-sensitive';

@Injectable()
export class LogIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LogIngestService.name);
  private consumer: Consumer | undefined;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectResetTimer: NodeJS.Timeout | null = null;
  private connectInFlight: Promise<void> | null = null;
  private reconnectAttempts = 0;
  private isShuttingDown = false;
  private readonly kafkaBrokers: string[];
  private readonly kafkaTopic: string;
  private readonly kafkaGroupId: string;
  private readonly kafkaClientId: string;
  private readonly lokiClient: LokiLogClient;
  private readonly environment: string;

  constructor(private readonly repository: LogStreamRepository) {
    const brokerEnv = process.env.LOG_KAFKA_BROKERS ?? '';
    this.kafkaBrokers = brokerEnv
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    if (this.kafkaBrokers.length === 0) {
      throw new Error('LOG_KAFKA_BROKERS must be configured for Kafka log ingestion');
    }

    // Use instance-aware topic name
    const topicResolver = getTopicResolver();
    this.kafkaTopic = topicResolver.getLogsTopic();

    this.kafkaGroupId = process.env.LOG_KAFKA_GROUP_ID ?? 'shipsec-log-ingestor';
    this.kafkaClientId = process.env.LOG_KAFKA_CLIENT_ID ?? 'shipsec-backend';
    this.environment = process.env.SHIPSEC_ENV ?? 'local';

    const lokiUrl = process.env.LOKI_URL;
    if (!lokiUrl) {
      throw new Error('LOKI_URL must be configured for Kafka log ingestion');
    }
    this.lokiClient = new LokiLogClient({
      baseUrl: lokiUrl,
      tenantId: process.env.LOKI_TENANT_ID,
      username: process.env.LOKI_USERNAME,
      password: process.env.LOKI_PASSWORD,
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.kafkaBrokers.length === 0) {
      this.logger.warn('No Kafka brokers configured, skipping log ingest service initialization');
      return;
    }

    this.ensureConnected().catch((error) => {
      this.logger.error('Failed to initialize Kafka log ingestion', error as Error);
    });
  }

  private ensureConnected(): Promise<void> {
    if (this.isShuttingDown) {
      return Promise.resolve();
    }
    if (this.connectInFlight) {
      return this.connectInFlight;
    }

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

    // Disconnect old consumer before recreating (detach listeners first)
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
        // KafkaJS can auto-restart after recoverable crashes; avoid forcing
        // reconnect loops while it is already restarting internally.
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
      // Only reset reconnect backoff after the consumer has stayed healthy
      // for a short period. This avoids tight reconnect loops on persistent
      // crash conditions.
      this.reconnectResetTimer = setTimeout(() => {
        if (this.isShuttingDown || this.consumer !== nextConsumer) return;
        this.reconnectAttempts = 0;
      }, 30_000);
      this.logger.log(
        `Kafka log ingestion connected (${this.kafkaBrokers.join(', ')}) topic=${this.kafkaTopic}`,
      );

      void nextConsumer
        .run({
          eachMessage: async ({ message }) => {
            if (!message.value) {
              return;
            }
            try {
              const payload = JSON.parse(message.value.toString()) as KafkaLogEntry;
              await this.processEntry(payload);
            } catch (error) {
              this.logger.error('Failed to process log entry from Kafka', error as Error);
            }
          },
        })
        .catch((error) => {
          if (this.isShuttingDown || this.consumer !== nextConsumer) return;
          this.logger.error('Kafka log ingestion run loop failed', error as Error);
          this.scheduleReconnect();
        });
    } catch (error) {
      if (nextConsumer) {
        if (this.consumer === nextConsumer) {
          this.consumer = undefined;
        }
        await this.disconnectConsumer(nextConsumer);
      }
      this.logger.error('Failed to connect to Kafka log ingestion', error as Error);
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
      this.logger.log('Disconnecting Kafka consumer...');
      await this.disconnectConsumer(current).catch((error) => {
        this.logger.error('Failed to disconnect Kafka consumer', error as Error);
      });
      this.logger.log('Kafka consumer disconnected');
    }
  }

  private async processEntry(entry: KafkaLogEntry): Promise<void> {
    const sanitizedMessage = redactSensitiveData(entry.message ?? '');
    if (!sanitizedMessage || sanitizedMessage.trim().length === 0) {
      return;
    }

    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
    const labels = this.buildLabels(entry);
    const lines = this.buildLines(sanitizedMessage, timestamp);
    if (!lines.length) {
      return;
    }

    try {
      await this.lokiClient.push(labels, lines);
      await this.repository.upsertMetadata({
        runId: entry.runId,
        nodeRef: entry.nodeRef,
        stream: entry.stream,
        labels,
        firstTimestamp: lines[0].timestamp,
        lastTimestamp: lines[lines.length - 1].timestamp,
        lineCount: lines.length,
        organizationId: entry.organizationId ?? null,
      });
    } catch (error) {
      this.logger.error('Failed to forward log entry to Loki', error as Error);
    }
  }

  private buildLabels(entry: KafkaLogEntry): Record<string, string> {
    const labels: Record<string, string> = {
      run_id: entry.runId,
      node: entry.nodeRef,
      stream: entry.stream,
      environment: this.environment,
    };

    if (entry.level) {
      labels.level = entry.level;
    }

    const metadata = entry.metadata;
    if (metadata?.activityId) {
      labels.activity_id = metadata.activityId;
    }
    if (metadata?.attempt !== undefined) {
      labels.attempt = String(metadata.attempt);
    }
    if (metadata?.correlationId) {
      labels.correlation_id = metadata.correlationId;
    }
    if (metadata?.streamId) {
      labels.stream_id = metadata.streamId;
    }
    if (metadata?.joinStrategy) {
      labels.join_strategy = metadata.joinStrategy;
    }
    if (metadata?.triggeredBy) {
      labels.triggered_by = metadata.triggeredBy;
    }

    return labels;
  }

  private buildLines(message: string, timestamp: Date) {
    const normalized = message.replace(/\r/g, '').trim();
    if (!normalized) {
      return [];
    }

    return [
      {
        message: normalized,
        timestamp,
      },
    ];
  }
}

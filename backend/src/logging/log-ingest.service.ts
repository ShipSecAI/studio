import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Kafka, Consumer } from 'kafkajs';

import { LogStreamRepository } from '../trace/log-stream.repository';
import type { KafkaLogEntry } from './log-entry.types';
import { LokiLogClient } from './loki.client';

@Injectable()
export class LogIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LogIngestService.name);
  private consumer: Consumer | undefined;
  private readonly kafkaBrokers: string[];
  private readonly kafkaTopic: string;
  private readonly kafkaGroupId: string;
  private readonly kafkaClientId: string;
  private readonly lokiClient: LokiLogClient;

  constructor(private readonly repository: LogStreamRepository) {
    const brokerEnv = process.env.LOG_KAFKA_BROKERS ?? '';
    this.kafkaBrokers = brokerEnv
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    if (this.kafkaBrokers.length === 0) {
      throw new Error('LOG_KAFKA_BROKERS must be configured for Kafka log ingestion');
    }
    this.kafkaTopic = process.env.LOG_KAFKA_TOPIC ?? 'telemetry.logs';
    this.kafkaGroupId = process.env.LOG_KAFKA_GROUP_ID ?? 'shipsec-log-ingestor';
    this.kafkaClientId = process.env.LOG_KAFKA_CLIENT_ID ?? 'shipsec-backend';

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
    try {
      const kafka = new Kafka({
        clientId: this.kafkaClientId,
        brokers: this.kafkaBrokers,
        requestTimeout: 30000, // 30 seconds
        retry: {
          retries: 1,
          initialRetryTime: 100,
          maxRetryTime: 30000,
        },
      });
      this.consumer = kafka.consumer({ 
        groupId: this.kafkaGroupId,
        sessionTimeout: 30000, // 30 seconds
        heartbeatInterval: 3000, // 3 seconds
      });
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: this.kafkaTopic, fromBeginning: true });
      await this.consumer.run({
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
      });
      this.logger.log(
        `Kafka log ingestion connected (${this.kafkaBrokers.join(', ')}) topic=${this.kafkaTopic}`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize Kafka log ingestion', error as Error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect().catch((error) => {
        this.logger.error('Failed to disconnect Kafka consumer', error as Error);
      });
    }
  }

  private async processEntry(entry: KafkaLogEntry): Promise<void> {
    if (!entry.message || entry.message.trim().length === 0) {
      return;
    }

    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
    const labels = this.buildLabels(entry);
    const lines = this.buildLines(entry.message, timestamp);
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

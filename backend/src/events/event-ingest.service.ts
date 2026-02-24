import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';
import { getTopicResolver } from '../common/kafka-topic-resolver';

import { TraceRepository, type PersistedTraceEvent } from '../trace/trace.repository';
import type { TraceEventType } from '../trace/types';

interface KafkaTraceEventPayload {
  runId: string;
  workflowId?: string;
  organizationId?: string | null;
  type: TraceEventType;
  nodeRef: string;
  timestamp: string;
  level: string;
  message?: string;
  error?: unknown;
  outputSummary?: unknown;
  data?: Record<string, unknown> | null;
  sequence: number;
}

@Injectable()
export class EventIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventIngestService.name);
  private readonly kafkaBrokers: string[];
  private readonly kafkaTopic: string;
  private readonly kafkaGroupId: string;
  private readonly kafkaClientId: string;
  private consumer: Consumer | undefined;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isShuttingDown = false;

  constructor(private readonly traceRepository: TraceRepository) {
    const brokerEnv = process.env.LOG_KAFKA_BROKERS ?? '';
    this.kafkaBrokers = brokerEnv
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    if (this.kafkaBrokers.length === 0) {
      throw new Error('LOG_KAFKA_BROKERS must be configured for event ingestion');
    }

    // Use instance-aware topic name
    const topicResolver = getTopicResolver();
    this.kafkaTopic = topicResolver.getEventsTopic();

    this.kafkaGroupId = process.env.EVENT_KAFKA_GROUP_ID ?? 'shipsec-event-ingestor';
    this.kafkaClientId = process.env.EVENT_KAFKA_CLIENT_ID ?? 'shipsec-backend-events';
  }

  async onModuleInit(): Promise<void> {
    if (this.kafkaBrokers.length === 0) {
      this.logger.warn('No Kafka brokers configured, skipping event ingest service initialization');
      return;
    }

    this.connectToKafka().catch((error) => {
      this.logger.error('Failed to initialize Kafka e vent ingestion', error as Error);
    });
  }

  private async connectToKafka(): Promise<void> {
    if (this.isShuttingDown) return;

    // Disconnect old consumer before recreating (detach listeners first)
    if (this.consumer) {
      const old = this.consumer;
      this.consumer = undefined;
      (old as any).removeAllListeners?.();
      await old.disconnect().catch(() => {});
    }

    try {
      const kafka = new Kafka({
        clientId: this.kafkaClientId,
        brokers: this.kafkaBrokers,
        requestTimeout: 30000,
        retry: {
          retries: 10,
          initialRetryTime: 100,
          maxRetryTime: 30000,
        },
      });

      this.consumer = kafka.consumer({
        groupId: this.kafkaGroupId,
        sessionTimeout: 6000,
        heartbeatInterval: 2000,
      });

      this.consumer.on(this.consumer.events.CRASH, (event) => {
        if (this.isShuttingDown) return;
        this.logger.error(`Kafka consumer crashed: ${event.payload?.error ?? 'unknown'}`);
        this.scheduleReconnect();
      });
      this.consumer.on(this.consumer.events.DISCONNECT, () => {
        if (this.isShuttingDown) return;
        this.logger.warn('Kafka consumer disconnected, scheduling reconnect');
        this.scheduleReconnect();
      });

      await this.consumer.connect();
      await this.consumer.subscribe({ topic: this.kafkaTopic, fromBeginning: true });
      await this.consumer.run({
        eachMessage: async ({ message, topic, partition }) => {
          const messageOffset = message.offset;
          if (!message.value) {
            this.logger.warn(`Received empty message from ${topic}[${partition}]@${messageOffset}`);
            return;
          }
          try {
            const payload = JSON.parse(message.value.toString()) as KafkaTraceEventPayload;
            this.logger.debug(
              `Processing trace event: runId=${payload.runId}, type=${payload.type}, sequence=${payload.sequence}, offset=${messageOffset}`,
            );
            await this.persistEvent(payload);
            this.logger.debug(
              `Successfully persisted trace event for run ${payload.runId}, sequence ${payload.sequence}`,
            );
          } catch (error) {
            this.logger.error(
              `Failed to process trace event from Kafka (topic=${topic}, partition=${partition}, offset=${messageOffset})`,
              error as Error,
            );
          }
        },
      });
      this.reconnectAttempts = 0;
      this.logger.log(
        `Kafka event ingestion connected (${this.kafkaBrokers.join(', ')}) topic=${this.kafkaTopic}`,
      );
    } catch (error) {
      this.logger.error('Failed to connect to Kafka event ingestion', error as Error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown || this.reconnectTimer) return;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempts, 5));
    this.reconnectAttempts += 1;
    this.logger.warn(`Retrying Kafka connection in ${delayMs}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectToKafka().catch(() => {});
    }, delayMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.consumer) {
      this.logger.log('Disconnecting Kafka consumer...');
      await this.consumer.disconnect().catch((error) => {
        this.logger.error('Failed to disconnect Kafka consumer', error as Error);
      });
      this.logger.log('Kafka consumer disconnected');
    }
  }

  private async persistEvent(event: KafkaTraceEventPayload): Promise<void> {
    if (!event.sequence || event.sequence < 1) {
      this.logger.warn(
        `Dropping trace event with invalid sequence for run ${event.runId}, sequence=${event.sequence}`,
      );
      return;
    }

    const mapped: PersistedTraceEvent = {
      runId: event.runId,
      workflowId: event.workflowId,
      organizationId: event.organizationId ?? null,
      type: event.type,
      nodeRef: event.nodeRef,
      timestamp: event.timestamp,
      sequence: event.sequence,
      level: event.level,
      message: event.message,
      error: event.error,
      outputSummary: event.outputSummary,
      data: event.data ?? null,
    };

    await this.traceRepository.append(mapped);
  }
}

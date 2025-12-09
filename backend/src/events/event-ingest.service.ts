import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';

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
  error?: string;
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

  constructor(private readonly traceRepository: TraceRepository) {
    const brokerEnv = process.env.LOG_KAFKA_BROKERS ?? '';
    this.kafkaBrokers = brokerEnv
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    if (this.kafkaBrokers.length === 0) {
      throw new Error('LOG_KAFKA_BROKERS must be configured for event ingestion');
    }

    this.kafkaTopic = process.env.EVENT_KAFKA_TOPIC ?? 'telemetry.events';
    this.kafkaGroupId = process.env.EVENT_KAFKA_GROUP_ID ?? 'shipsec-event-ingestor';
    this.kafkaClientId = process.env.EVENT_KAFKA_CLIENT_ID ?? 'shipsec-backend-events';
  }

  async onModuleInit(): Promise<void> {
    // Skip initialization if no brokers are configured
    if (this.kafkaBrokers.length === 0) {
      this.logger.warn('No Kafka brokers configured, skipping event ingest service initialization');
      return;
    }

    try {
      const kafka = new Kafka({
        clientId: this.kafkaClientId,
        brokers: this.kafkaBrokers,
      });

      this.consumer = kafka.consumer({ groupId: this.kafkaGroupId });
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: this.kafkaTopic, fromBeginning: true });
      await this.consumer.run({
        eachMessage: async ({ message }) => {
          if (!message.value) {
            return;
          }
          try {
            const payload = JSON.parse(message.value.toString()) as KafkaTraceEventPayload;
            await this.persistEvent(payload);
          } catch (error) {
            this.logger.error('Failed to process trace event from Kafka', error as Error);
          }
        },
      });
      this.logger.log(
        `Kafka event ingestion connected (${this.kafkaBrokers.join(', ')}) topic=${this.kafkaTopic}`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize Kafka event ingestion', error as Error);
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

  private async persistEvent(event: KafkaTraceEventPayload): Promise<void> {
    if (!event.sequence || event.sequence < 1) {
      this.logger.warn(`Dropping trace event with invalid sequence for run ${event.runId}`);
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

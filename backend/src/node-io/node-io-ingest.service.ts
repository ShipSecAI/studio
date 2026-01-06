import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';

import { NodeIORepository } from './node-io.repository';

interface SerializedNodeIOEvent {
  type: 'NODE_IO_START' | 'NODE_IO_COMPLETION';
  runId: string;
  nodeRef: string;
  workflowId?: string;
  organizationId?: string | null;
  componentId?: string;
  inputs?: Record<string, unknown>;
  inputsSize?: number;
  inputsSpilled?: boolean;
  inputsStorageRef?: string | null;
  outputs?: Record<string, unknown>;
  outputsSize?: number;
  outputsSpilled?: boolean;
  outputsStorageRef?: string | null;
  status?: 'completed' | 'failed' | 'skipped';
  errorMessage?: string;
  timestamp: string;
}

@Injectable()
export class NodeIOIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NodeIOIngestService.name);
  private readonly kafkaBrokers: string[];
  private readonly kafkaTopic: string;
  private readonly kafkaGroupId: string;
  private readonly kafkaClientId: string;
  private consumer: Consumer | undefined;

  constructor(private readonly nodeIORepository: NodeIORepository) {
    const brokerEnv = process.env.LOG_KAFKA_BROKERS ?? '';
    this.kafkaBrokers = brokerEnv
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    if (this.kafkaBrokers.length === 0) {
      throw new Error('LOG_KAFKA_BROKERS must be configured for node I/O ingestion');
    }

    this.kafkaTopic = process.env.NODE_IO_KAFKA_TOPIC ?? 'telemetry.node-io';
    this.kafkaGroupId = process.env.NODE_IO_KAFKA_GROUP_ID ?? 'shipsec-node-io-ingestor';
    this.kafkaClientId = process.env.NODE_IO_KAFKA_CLIENT_ID ?? 'shipsec-backend-node-io';
  }

  async onModuleInit(): Promise<void> {
    if (this.kafkaBrokers.length === 0) {
      this.logger.warn('No Kafka brokers configured, skipping node I/O ingest service initialization');
      return;
    }

    try {
      const kafka = new Kafka({
        clientId: this.kafkaClientId,
        brokers: this.kafkaBrokers,
        requestTimeout: 30000,
        retry: {
          retries: 5,
          initialRetryTime: 100,
          maxRetryTime: 30000,
        },
      });

      this.consumer = kafka.consumer({ 
        groupId: this.kafkaGroupId,
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
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
            const payload = JSON.parse(message.value.toString()) as SerializedNodeIOEvent;
            this.logger.debug(
              `Processing node I/O event: runId=${payload.runId}, nodeRef=${payload.nodeRef}, type=${payload.type}, offset=${messageOffset}`,
            );
            await this.persistEvent(payload);
          } catch (error) {
            this.logger.error(
              `Failed to process node I/O event from Kafka (topic=${topic}, partition=${partition}, offset=${messageOffset})`,
              error as Error,
            );
          }
        },
      });
      this.logger.log(
        `Kafka node I/O ingestion connected (${this.kafkaBrokers.join(', ')}) topic=${this.kafkaTopic}`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize Kafka node I/O ingestion', error as Error);
      // Don't throw here to avoid crashing the whole backend if Kafka is just temporarily down
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect().catch((error) => {
        this.logger.error('Failed to disconnect Kafka consumer', error as Error);
      });
    }
  }

  private async persistEvent(event: SerializedNodeIOEvent): Promise<void> {
    if (event.type === 'NODE_IO_START') {
      await this.nodeIORepository.recordStart({
        runId: event.runId,
        nodeRef: event.nodeRef,
        workflowId: event.workflowId,
        organizationId: event.organizationId,
        componentId: event.componentId || 'unknown',
        inputs: event.inputs || {},
        inputsSize: event.inputsSize,
        inputsSpilled: event.inputsSpilled,
        inputsStorageRef: event.inputsStorageRef,
      });
    } else if (event.type === 'NODE_IO_COMPLETION') {
      await this.nodeIORepository.recordCompletion({
        runId: event.runId,
        nodeRef: event.nodeRef,
        componentId: event.componentId,
        outputs: event.outputs || {},
        status: event.status || 'completed',
        errorMessage: event.errorMessage,
        outputsSize: event.outputsSize,
        outputsSpilled: event.outputsSpilled,
        outputsStorageRef: event.outputsStorageRef,
      });
    }
  }
}

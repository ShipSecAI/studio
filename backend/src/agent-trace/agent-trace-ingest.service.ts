import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';

import { AgentTraceRepository, type AgentTraceEventInput } from './agent-trace.repository';

@Injectable()
export class AgentTraceIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentTraceIngestService.name);
  private readonly kafkaBrokers: string[];
  private readonly kafkaTopic: string;
  private readonly kafkaGroupId: string;
  private readonly kafkaClientId: string;
  private consumer: Consumer | undefined;

  constructor(private readonly repository: AgentTraceRepository) {
    const brokerEnv = process.env.LOG_KAFKA_BROKERS ?? '';
    this.kafkaBrokers = brokerEnv
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    if (this.kafkaBrokers.length === 0) {
      throw new Error('LOG_KAFKA_BROKERS must be configured for agent trace ingestion');
    }

    this.kafkaTopic = process.env.AGENT_TRACE_KAFKA_TOPIC ?? 'telemetry.agent-trace';
    this.kafkaGroupId = process.env.AGENT_TRACE_KAFKA_GROUP_ID ?? 'shipsec-agent-trace-ingestor';
    this.kafkaClientId = process.env.AGENT_TRACE_KAFKA_CLIENT_ID ?? 'shipsec-backend-agent-trace';
  }

  async onModuleInit(): Promise<void> {
    if (this.kafkaBrokers.length === 0) {
      this.logger.warn('No Kafka brokers configured, skipping agent trace ingestion');
      return;
    }

    this.connectToKafka().catch((error) => {
      this.logger.error('Failed to initialize Kafka agent trace ingestion', error as Error);
    });
  }

  private async connectToKafka(): Promise<void> {
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
      await this.consumer.connect();
      await this.consumer.subscribe({ topic: this.kafkaTopic, fromBeginning: true });
      await this.consumer.run({
        eachMessage: async ({ message }) => {
          if (!message.value) {
            return;
          }
          try {
            const payload = JSON.parse(message.value.toString()) as AgentTraceEventInput;
            await this.repository.append(payload);
          } catch (error) {
            this.logger.error('Failed to process agent trace event from Kafka', error as Error);
          }
        },
      });

      this.logger.log(
        `Kafka agent trace ingestion connected (${this.kafkaBrokers.join(', ')}) topic=${this.kafkaTopic}`,
      );
    } catch (error) {
      this.logger.error('Failed to connect to Kafka agent trace ingestion', error as Error);
      // We don't throw here to ensure the backend stays up even if ingestion fails initially
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.consumer) {
      this.logger.log('Disconnecting Kafka consumer...');
      await this.consumer.disconnect().catch((error) => {
        this.logger.error('Failed to disconnect Kafka consumer', error as Error);
      });
      this.logger.log('Kafka consumer disconnected');
    }
  }
}

import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';
import { ConfigurationError } from '@shipsec/component-sdk';

import type { WorkflowLogEntry, WorkflowLogSink } from '../temporal/types';

export interface KafkaLogAdapterConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  logLevel?: keyof typeof KafkaLogLevel;
}

type SerializedLogEntry = Omit<WorkflowLogEntry, 'timestamp'> & {
  timestamp: string;
};

export class KafkaLogAdapter implements WorkflowLogSink {
  private readonly producer: Producer;
  private readonly connectPromise: Promise<void>;

  constructor(private readonly config: KafkaLogAdapterConfig) {
    if (!config.brokers.length) {
      throw new ConfigurationError('KafkaLogAdapter requires at least one broker', {
        configKey: 'brokers',
        details: { brokers: config.brokers },
      });
    }

    const kafka = new Kafka({
      clientId: config.clientId ?? 'shipsec-worker',
      brokers: config.brokers,
      logLevel: config.logLevel ? KafkaLogLevel[config.logLevel] : KafkaLogLevel.NOTHING,
    });

    this.producer = kafka.producer({
      allowAutoTopicCreation: true,
    });

    this.connectPromise = this.producer.connect().catch((error) => {
      console.error('[KafkaLogAdapter] Failed to connect to brokers', error);
      throw error;
    });
  }

  async append(entry: WorkflowLogEntry): Promise<void> {
    if (!entry.message || entry.message.trim().length === 0) {
      return;
    }

    const payload: SerializedLogEntry = {
      ...entry,
      timestamp: (entry.timestamp ?? new Date()).toISOString(),
    };

    try {
      await this.connectPromise;
      await this.producer.send({
        topic: this.config.topic,
        messages: [
          {
            value: JSON.stringify(payload),
          },
        ],
      });
    } catch (error) {
      console.error('[KafkaLogAdapter] Failed to send log entry', error);
    }
  }
}

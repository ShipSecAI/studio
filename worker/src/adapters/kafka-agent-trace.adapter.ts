import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';
import type { AgentTraceEvent, AgentTracePublisher } from '@shipsec/component-sdk';
import { ConfigurationError } from '@shipsec/component-sdk';

export interface KafkaAgentTracePublisherConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  logLevel?: keyof typeof KafkaLogLevel;
}

export class KafkaAgentTracePublisher implements AgentTracePublisher {
  private readonly producer: Producer;
  private readonly connectPromise: Promise<void>;

  constructor(
    private readonly config: KafkaAgentTracePublisherConfig,
    private readonly logger: Pick<Console, 'log' | 'error'> = console,
  ) {
    if (!config.brokers.length) {
      throw new ConfigurationError('KafkaAgentTracePublisher requires at least one broker', {
        configKey: 'brokers',
        details: { brokers: config.brokers },
      });
    }

    const kafka = new Kafka({
      clientId: config.clientId ?? 'shipsec-agent-trace',
      brokers: config.brokers,
      logLevel: config.logLevel ? KafkaLogLevel[config.logLevel] : KafkaLogLevel.NOTHING,
    });

    this.producer = kafka.producer({
      allowAutoTopicCreation: true,
    });

    this.connectPromise = this.producer.connect().catch((error) => {
      this.logger.error('[KafkaAgentTracePublisher] Failed to connect to brokers', error);
      throw error;
    });
  }

  async publish(event: AgentTraceEvent): Promise<void> {
    await this.connectPromise;
    await this.producer
      .send({
        topic: this.config.topic,
        messages: [
          {
            value: JSON.stringify(event),
          },
        ],
      })
      .catch((error) => {
        this.logger.error('[KafkaAgentTracePublisher] Failed to send agent trace event', error);
      });
  }
}

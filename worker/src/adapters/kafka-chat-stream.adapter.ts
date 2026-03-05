import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';

interface KafkaChatStreamAdapterConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  logLevel?: keyof typeof KafkaLogLevel;
}

export interface KafkaChatChunkPayload {
  sessionId: string;
  turnId: string;
  runId: string;
  generationId: string;
  eventId: string;
  chunk: Record<string, unknown>;
}

export class KafkaChatStreamAdapter {
  private readonly producer: Producer;
  private readonly connectPromise: Promise<void>;

  constructor(
    private readonly config: KafkaChatStreamAdapterConfig,
    private readonly logger: Pick<Console, 'log' | 'error'> = console,
  ) {
    if (!config.brokers.length) {
      throw new Error('KafkaChatStreamAdapter requires at least one broker');
    }

    const kafka = new Kafka({
      clientId: config.clientId ?? 'shipsec-worker-chat-stream',
      brokers: config.brokers,
      logLevel: config.logLevel ? KafkaLogLevel[config.logLevel] : KafkaLogLevel.NOTHING,
    });

    this.producer = kafka.producer({
      allowAutoTopicCreation: true,
    });

    this.connectPromise = this.producer.connect().catch((error) => {
      this.logger.error('[KafkaChatStreamAdapter] Failed to connect to brokers', error);
      throw error;
    });
  }

  /** Fire-and-forget produce with sessionId as partition key for affinity */
  emit(sessionId: string, envelope: Omit<KafkaChatChunkPayload, 'sessionId'>): void {
    const payload: KafkaChatChunkPayload = { sessionId, ...envelope };

    void this.connectPromise
      .then(() =>
        this.producer.send({
          topic: this.config.topic,
          messages: [
            {
              key: sessionId,
              value: JSON.stringify(payload),
            },
          ],
        }),
      )
      .catch((error) => {
        this.logger.error('[KafkaChatStreamAdapter] Failed to send chat stream event', error);
      });
  }
}

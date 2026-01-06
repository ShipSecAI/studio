import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';
import type { INodeIOService, NodeIOStartEvent, NodeIOCompletionEvent } from '@shipsec/component-sdk';
import { ConfigurationError } from '@shipsec/component-sdk';

interface KafkaNodeIOAdapterConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  logLevel?: keyof typeof KafkaLogLevel;
}

type SerializedNodeIOEvent = {
  type: 'NODE_IO_START' | 'NODE_IO_COMPLETION';
  runId: string;
  nodeRef: string;
  workflowId?: string;
  organizationId?: string | null;
  componentId?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  status?: 'completed' | 'failed' | 'skipped';
  errorMessage?: string;
  timestamp: string;
};

/**
 * Kafka adapter for publishing node I/O events.
 * Events are consumed by the backend and persisted to the node_io table.
 */
export class KafkaNodeIOAdapter implements INodeIOService {
  private readonly producer: Producer;
  private readonly connectPromise: Promise<void>;

  constructor(
    private readonly config: KafkaNodeIOAdapterConfig,
    private readonly logger: Pick<Console, 'log' | 'error'> = console,
  ) {
    if (!config.brokers.length) {
      throw new ConfigurationError('KafkaNodeIOAdapter requires at least one broker', {
        configKey: 'brokers',
        details: { brokers: config.brokers },
      });
    }

    const kafka = new Kafka({
      clientId: config.clientId ?? 'shipsec-worker-nodeio',
      brokers: config.brokers,
      logLevel: config.logLevel ? KafkaLogLevel[config.logLevel] : KafkaLogLevel.NOTHING,
    });

    this.producer = kafka.producer({
      allowAutoTopicCreation: true,
    });

    this.connectPromise = this.producer.connect().catch((error) => {
      this.logger.error('[KafkaNodeIOAdapter] Failed to connect to brokers', error);
      throw error;
    });
  }

  recordStart(data: NodeIOStartEvent): void {
    const payload: SerializedNodeIOEvent = {
      type: 'NODE_IO_START',
      runId: data.runId,
      nodeRef: data.nodeRef,
      workflowId: data.workflowId,
      organizationId: data.organizationId ?? null,
      componentId: data.componentId,
      inputs: data.inputs,
      timestamp: new Date().toISOString(),
    };

    void this.send(payload);
  }

  recordCompletion(data: NodeIOCompletionEvent): void {
    const payload: SerializedNodeIOEvent = {
      type: 'NODE_IO_COMPLETION',
      runId: data.runId,
      nodeRef: data.nodeRef,
      outputs: data.outputs,
      status: data.status,
      errorMessage: data.errorMessage,
      timestamp: new Date().toISOString(),
    };

    void this.send(payload);
  }

  private async send(payload: SerializedNodeIOEvent): Promise<void> {
    try {
      await this.connectPromise;

      const message = JSON.stringify(payload);
      const messageSize = Buffer.byteLength(message, 'utf8');

      // If message is too large (> 900KB), truncate the data
      if (messageSize > 900 * 1024) {
        this.logger.error(
          `[KafkaNodeIOAdapter] Payload too large (${messageSize} bytes) for ${payload.nodeRef}, truncating`,
        );

        const truncated: SerializedNodeIOEvent = {
          ...payload,
          inputs: payload.inputs ? { _truncated: true, _originalSize: messageSize } : undefined,
          outputs: payload.outputs ? { _truncated: true, _originalSize: messageSize } : undefined,
        };

        await this.producer.send({
          topic: this.config.topic,
          messages: [{ value: JSON.stringify(truncated) }],
        });
        return;
      }

      await this.producer.send({
        topic: this.config.topic,
        messages: [{ value: message }],
      });
    } catch (error) {
      this.logger.error('[KafkaNodeIOAdapter] Failed to send node I/O event', error);
    }
  }
}

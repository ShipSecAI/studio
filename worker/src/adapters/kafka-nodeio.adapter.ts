import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';
import type {
  INodeIOService,
  NodeIOStartEvent,
  NodeIOCompletionEvent,
  IFileStorageService,
} from '@shipsec/component-sdk';
import {
  ConfigurationError,
  KAFKA_SPILL_THRESHOLD_BYTES,
  MAX_KAFKA_MESSAGE_BYTES,
  createSpilledMarker,
  isSpilledDataMarker,
} from '@shipsec/component-sdk';
import { randomUUID } from 'node:crypto';

interface KafkaNodeIOAdapterConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  logLevel?: keyof typeof KafkaLogLevel;
}

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

/**
 * Kafka adapter for publishing node I/O events.
 * Events are consumed by the backend and persisted to the node_io table.
 */
export class KafkaNodeIOAdapter implements INodeIOService {
  private readonly producer: Producer;
  private readonly connectPromise: Promise<void>;

  constructor(
    private readonly config: KafkaNodeIOAdapterConfig,
    private readonly storage?: IFileStorageService,
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

  async recordStart(data: NodeIOStartEvent): Promise<void> {
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

    return this.processAndSend(payload);
  }

  async recordCompletion(data: NodeIOCompletionEvent): Promise<void> {
    const payload: SerializedNodeIOEvent = {
      type: 'NODE_IO_COMPLETION',
      runId: data.runId,
      nodeRef: data.nodeRef,
      componentId: data.componentId,
      outputs: data.outputs,
      status: data.status,
      errorMessage: data.errorMessage,
      timestamp: new Date().toISOString(),
    };

    return this.processAndSend(payload);
  }

  private async processAndSend(payload: SerializedNodeIOEvent): Promise<void> {
    try {
      // 1. Handle Spilling if necessary
      if (payload.inputs) {
        const inputsStr = JSON.stringify(payload.inputs);
        const size = Buffer.byteLength(inputsStr, 'utf8');
        payload.inputsSize = size;

        if (size > KAFKA_SPILL_THRESHOLD_BYTES && this.storage) {
          const fileId = randomUUID();

          await this.storage.uploadFile(
            fileId,
            'inputs.json',
            Buffer.from(inputsStr),
            'application/json',
          );

          payload.inputsSpilled = true;
          payload.inputsStorageRef = fileId;
          // Replace large inputs with standardized spill marker
          payload.inputs = createSpilledMarker(fileId, size);
        }
      }

      if (payload.outputs) {
        // Detect if already spilled by activity (uses legacy marker format for backward compat)
        const isPreSpilled =
          isSpilledDataMarker(payload.outputs) ||
          (payload.outputs.__shipsec_spilled__ === true &&
            typeof payload.outputs.storageRef === 'string');

        if (isPreSpilled) {
          const spilledOutput = payload.outputs as Record<string, unknown>;
          payload.outputsSpilled = true;
          payload.outputsStorageRef = (spilledOutput.storageRef ??
            spilledOutput.__storageRef__) as string;
          payload.outputsSize = (spilledOutput.originalSize as number) || 0;

          // Replace with standardized spill marker
          payload.outputs = createSpilledMarker(
            payload.outputsStorageRef ?? '',
            payload.outputsSize,
          );
        } else {
          const outputsStr = JSON.stringify(payload.outputs);
          const size = Buffer.byteLength(outputsStr, 'utf8');
          payload.outputsSize = size;

          if (size > KAFKA_SPILL_THRESHOLD_BYTES && this.storage) {
            const fileId = randomUUID();

            await this.storage.uploadFile(
              fileId,
              'outputs.json',
              Buffer.from(outputsStr),
              'application/json',
            );

            payload.outputsSpilled = true;
            payload.outputsStorageRef = fileId;
            // Replace large outputs with standardized spill marker
            payload.outputs = createSpilledMarker(fileId, size);
          }
        }
      }

      // 2. Final safety check for Kafka message size
      const message = JSON.stringify(payload);
      const messageSize = Buffer.byteLength(message, 'utf8');

      if (messageSize > MAX_KAFKA_MESSAGE_BYTES) {
        this.logger.error(
          `[KafkaNodeIOAdapter] Even after spilling, payload too large (${messageSize} bytes) for ${payload.nodeRef}, truncating payloads`,
        );

        const truncated: SerializedNodeIOEvent = {
          ...payload,
          inputs: payload.inputsSpilled
            ? payload.inputs
            : { _truncated: true, _originalSize: messageSize },
          outputs: payload.outputsSpilled
            ? payload.outputs
            : { _truncated: true, _originalSize: messageSize },
        };

        await this.sendRaw(payload.runId, JSON.stringify(truncated));
        return;
      }

      await this.sendRaw(payload.runId, message);
    } catch (error) {
      this.logger.error('[KafkaNodeIOAdapter] Failed to process or send node I/O event', error);
    }
  }

  private async sendRaw(key: string, message: string): Promise<void> {
    await this.connectPromise;
    await this.producer.send({
      topic: this.config.topic,
      messages: [{ key, value: message }],
    });
  }
}

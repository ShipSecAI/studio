import { Kafka, logLevel as KafkaLogLevel, type Producer } from 'kafkajs';
import type { ITraceService, TraceEvent } from '@shipsec/component-sdk';
import { ConfigurationError } from '@shipsec/component-sdk';

interface KafkaTraceAdapterConfig {
  brokers: string[];
  topic: string;
  clientId?: string;
  logLevel?: keyof typeof KafkaLogLevel;
}

interface RunMetadata {
  workflowId?: string;
  organizationId?: string | null;
}

interface SerializedTraceEvent {
  runId: string;
  workflowId?: string;
  organizationId?: string | null;
  type: TraceEvent['type'];
  nodeRef: string;
  timestamp: string;
  level: TraceEvent['level'];
  message?: string;
  error?: TraceEvent['error'];
  outputSummary?: unknown;
  data?: Record<string, unknown> | null;
  sequence: number;
}

export class KafkaTraceAdapter implements ITraceService {
  private readonly producer: Producer;
  private readonly connectPromise: Promise<void>;
  private readonly sequenceByRun = new Map<string, number>();
  private readonly metadataByRun = new Map<string, RunMetadata>();

  constructor(
    private readonly config: KafkaTraceAdapterConfig,
    private readonly logger: Pick<Console, 'log' | 'error'> = console,
  ) {
    if (!config.brokers.length) {
      throw new ConfigurationError('KafkaTraceAdapter requires at least one broker', {
        configKey: 'brokers',
        details: { brokers: config.brokers },
      });
    }

    const kafka = new Kafka({
      clientId: config.clientId ?? 'shipsec-worker-events',
      brokers: config.brokers,
      logLevel: config.logLevel ? KafkaLogLevel[config.logLevel] : KafkaLogLevel.NOTHING,
    });

    this.producer = kafka.producer({
      allowAutoTopicCreation: true,
    });

    this.connectPromise = this.producer.connect().catch((error) => {
      this.logger.error('[KafkaTraceAdapter] Failed to connect to brokers', error);
      throw error;
    });
  }

  setRunMetadata(runId: string, metadata: RunMetadata): void {
    this.metadataByRun.set(runId, metadata);
  }

  finalizeRun(runId: string): void {
    this.metadataByRun.delete(runId);
    this.sequenceByRun.delete(runId);
  }

  record(event: TraceEvent): void {
    const sequence = this.nextSequence(event.runId);
    const metadata = this.metadataByRun.get(event.runId);

    const payload: SerializedTraceEvent = {
      runId: event.runId,
      workflowId: metadata?.workflowId,
      organizationId: metadata?.organizationId ?? null,
      type: event.type,
      nodeRef: event.nodeRef,
      timestamp: event.timestamp,
      level: event.level,
      message: event.message,
      error: event.error,
      outputSummary: event.outputSummary,
      data: this.packData(event),
      sequence,
    };

    void this.connectPromise
      .then(() =>
        this.producer.send({
          topic: this.config.topic,
          messages: [
            {
              value: JSON.stringify(payload),
            },
          ],
        }),
      )
      .catch((error) => {
        this.logger.error('[KafkaTraceAdapter] Failed to send trace event', error);
      });
  }

  private nextSequence(runId: string): number {
    const current = this.sequenceByRun.get(runId) ?? 0;
    const next = current + 1;
    this.sequenceByRun.set(runId, next);
    return next;
  }

  private packData(event: TraceEvent): Record<string, unknown> | null {
    const hasData = event.data && typeof event.data === 'object' && !Array.isArray(event.data);
    const hasMetadata =
      event.context && typeof event.context === 'object' && !Array.isArray(event.context);

    if (!hasData && !hasMetadata) {
      return null;
    }

    const packed: Record<string, unknown> = {};

    if (hasData) {
      packed._payload = { ...(event.data as Record<string, unknown>) };
    }

    if (hasMetadata) {
      packed._metadata = {
        ...(event.context as unknown as Record<string, unknown>),
      };
    }

    return packed;
  }
}

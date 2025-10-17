import { Injectable } from '@nestjs/common';

import { TraceRepository } from './trace.repository';
import type { TraceEventType as PersistedTraceEventType } from './types';
import {
  TraceEventLevel,
  TraceEventPayload,
  TraceEventType,
} from '@shipsec/shared';

@Injectable()
export class TraceService {
  constructor(private readonly repository: TraceRepository) {}

  async list(runId: string): Promise<{ events: TraceEventPayload[]; cursor?: string }> {
    const records = await this.repository.listByRunId(runId);
    const events = records.map((record) => this.mapRecordToEvent(record));
    const cursor = events.length > 0 ? events[events.length - 1].id : undefined;
    return { events, cursor };
  }

  async listSince(
    runId: string,
    afterSequence?: number,
  ): Promise<{ events: TraceEventPayload[]; cursor?: string }> {
    if (!afterSequence || afterSequence <= 0) {
      return this.list(runId);
    }

    const records = await this.repository.listAfterSequence(runId, afterSequence);
    const events = records.map((record) => this.mapRecordToEvent(record));
    const cursor = events.length > 0 ? events[events.length - 1].id : undefined;
    return { events, cursor };
  }

  private mapRecordToEvent(record: {
    runId: string;
    nodeRef: string;
    timestamp: Date;
    type: PersistedTraceEventType;
    message: string | null;
    error: string | null;
    outputSummary: unknown | null;
    level: string;
    data: unknown | null;
    sequence: number;
  }): TraceEventPayload {
    const type = this.mapEventType(record.type);
    const level = this.mapEventLevel(type, record.level);

    const mappedData = this.toRecord(record.data);

    const outputSummary = this.toRecord(record.outputSummary);

    const event: TraceEventPayload = {
      id: record.sequence.toString(),
      runId: record.runId,
      nodeId: record.nodeRef,
      type,
      level,
      timestamp: record.timestamp.toISOString(),
      message: record.message ?? undefined,
      error: record.error ? { message: record.error } : undefined,
      outputSummary,
    };

    if (mappedData) {
      event.data = mappedData;
    }

    return event;
  }

  private mapEventType(type: PersistedTraceEventType): TraceEventType {
    switch (type) {
      case 'NODE_STARTED':
        return 'STARTED';
      case 'NODE_COMPLETED':
        return 'COMPLETED';
      case 'NODE_FAILED':
        return 'FAILED';
      case 'NODE_PROGRESS':
      default:
        return 'PROGRESS';
    }
  }

  private mapEventLevel(type: TraceEventType, storedLevel: string): TraceEventLevel {
    if (storedLevel === 'error' || storedLevel === 'warn' || storedLevel === 'debug') {
      return storedLevel;
    }
    if (type === 'FAILED') {
      return 'error';
    }
    return 'info';
  }

  private toRecord(input: unknown): Record<string, unknown> | undefined {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return undefined;
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      result[key] = value;
    }
    return result;
  }
}

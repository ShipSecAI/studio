import { ForbiddenException, Injectable } from '@nestjs/common';

import { TraceRepository } from './trace.repository';
import type { TraceEventType as PersistedTraceEventType } from './types';
import {
  TraceEventLevel,
  TraceEventMetadata,
  TraceEventMetadataSchema,
  TraceEventPayload,
  TraceEventType,
} from '@shipsec/shared';
import type { AuthContext } from '../auth/types';

@Injectable()
export class TraceService {
  constructor(private readonly repository: TraceRepository) {}

  async list(
    runId: string,
    auth?: AuthContext | null,
  ): Promise<{ events: TraceEventPayload[]; cursor?: string }> {
    const organizationId = this.requireOrganizationId(auth);
    const records = await this.repository.listByRunId(runId, organizationId);
    const events = records.map((record) => this.mapRecordToEvent(record));
    const cursor = events.length > 0 ? events[events.length - 1].id : undefined;
    return { events, cursor };
  }

  async listSince(
    runId: string,
    afterSequence?: number,
    auth?: AuthContext | null,
  ): Promise<{ events: TraceEventPayload[]; cursor?: string }> {
    if (!afterSequence || afterSequence <= 0) {
      return this.list(runId, auth);
    }

    const organizationId = this.requireOrganizationId(auth);
    const records = await this.repository.listAfterSequence(runId, afterSequence, organizationId);
    const events = records.map((record) => this.mapRecordToEvent(record));
    const cursor = events.length > 0 ? events[events.length - 1].id : undefined;
    return { events, cursor };
  }

  private requireOrganizationId(auth?: AuthContext | null): string {
    const organizationId = auth?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return organizationId;
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

    const { payload, metadata } = this.extractPayloadAndMetadata(record.data);

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

    if (payload) {
      event.data = payload;
    }

    if (metadata) {
      event.metadata = metadata;
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
      case 'AWAITING_INPUT':
        return 'AWAITING_INPUT';
      case 'NODE_SKIPPED':
        return 'SKIPPED';
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

  private extractPayloadAndMetadata(
    rawData: unknown,
  ): { payload?: Record<string, unknown>; metadata?: TraceEventMetadata } {
    if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
      return { payload: this.toRecord(rawData) };
    }

    const dataObject = rawData as Record<string, unknown>;
    const hasPackedFields = '_payload' in dataObject || '_metadata' in dataObject;

    if (!hasPackedFields) {
      return { payload: this.toRecord(rawData) };
    }

    const payloadRaw = dataObject._payload as unknown;
    const metadataRaw = dataObject._metadata as unknown;

    const payload = this.toRecord(payloadRaw);
    const metadata = this.parseMetadata(metadataRaw);

    return { payload, metadata };
  }

  private parseMetadata(metadataRaw: unknown): TraceEventMetadata | undefined {
    if (!metadataRaw || typeof metadataRaw !== 'object' || Array.isArray(metadataRaw)) {
      return undefined;
    }

    const parsed = TraceEventMetadataSchema.safeParse(metadataRaw);
    if (!parsed.success) {
      return undefined;
    }

    return parsed.data;
  }
}

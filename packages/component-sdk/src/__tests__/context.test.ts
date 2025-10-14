import { describe, it, expect } from 'bun:test';
import { createExecutionContext } from '../context';
import type { IFileStorageService, ISecretsService, TraceEvent } from '../interfaces';

describe('ExecutionContext', () => {
  it('should create context with basic properties', () => {
    const context = createExecutionContext({
      runId: 'test-run-123',
      componentRef: 'test.component',
    });

    expect(context.runId).toBe('test-run-123');
    expect(context.componentRef).toBe('test.component');
    expect(context.logger).toBeDefined();
    expect(context.emitProgress).toBeDefined();
    expect(typeof context.logger.info).toBe('function');
    expect(typeof context.logger.error).toBe('function');
    expect(typeof context.emitProgress).toBe('function');
  });

  it('should inject storage service', () => {
    const mockStorage: IFileStorageService = {
      downloadFile: async (id: string) => ({
        buffer: Buffer.from('test'),
        metadata: { id, fileName: 'test.txt', mimeType: 'text/plain', size: 4 },
      }),
      getFileMetadata: async (id: string) => ({
        id,
        fileName: 'test.txt',
        mimeType: 'text/plain',
        size: 4,
        uploadedAt: new Date(),
      }),
    };

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'test.component',
      storage: mockStorage,
    });

    expect(context.storage).toBe(mockStorage);
  });

  it('should inject secrets service', () => {
    const mockSecrets: ISecretsService = {
      get: async (key: string) => `secret-${key}`,
      list: async () => ['key1', 'key2'],
    };

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'test.component',
      secrets: mockSecrets,
    });

    expect(context.secrets).toBe(mockSecrets);
  });

  it('should inject trace service and record progress', () => {
    const recordedEvents: TraceEvent[] = [];

    const mockTrace = {
      record: (event: TraceEvent) => {
        recordedEvents.push(event);
      },
    };

    const context = createExecutionContext({
      runId: 'test-run-789',
      componentRef: 'progress.test',
      trace: mockTrace,
    });

    context.emitProgress('Processing step 1');
    context.emitProgress('Processing step 2');

    expect(recordedEvents).toHaveLength(2);
    expect(recordedEvents[0].type).toBe('NODE_PROGRESS');
    expect(recordedEvents[0].runId).toBe('test-run-789');
    expect(recordedEvents[0].nodeRef).toBe('progress.test');
    expect(recordedEvents[0].message).toBe('Processing step 1');
    expect(recordedEvents[0].level).toBe('info');
    expect(recordedEvents[1].message).toBe('Processing step 2');
    expect(recordedEvents[1].level).toBe('info');
  });

  it('should support structured progress payloads', () => {
    const recordedEvents: TraceEvent[] = [];
    const mockTrace = {
      record: (event: TraceEvent) => {
        recordedEvents.push(event);
      },
    };

    const context = createExecutionContext({
      runId: 'run-structured',
      componentRef: 'structured.component',
      trace: mockTrace,
    });

    context.emitProgress({
      message: 'Retrying webhook',
      level: 'warn',
      data: { attempt: 2 },
    });

    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0]).toMatchObject({
      type: 'NODE_PROGRESS',
      runId: 'run-structured',
      nodeRef: 'structured.component',
      level: 'warn',
      message: 'Retrying webhook',
      data: { attempt: 2 },
    });
  });

  it('should work without optional services', () => {
    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'test.component',
    });

    expect(context.storage).toBeUndefined();
    expect(context.secrets).toBeUndefined();
    expect(context.artifacts).toBeUndefined();
    expect(context.trace).toBeUndefined();

    // Should not throw when emitting progress without trace
    expect(() => context.emitProgress('test')).not.toThrow();
  });
});

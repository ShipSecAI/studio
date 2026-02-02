import { beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import {
  componentRegistry,
  createExecutionContext,
  type IArtifactService,
} from '@shipsec/component-sdk';
import type { FileWriterInput, FileWriterOutput } from '../file-writer';

const s3SendMock = vi.fn();

mock.module('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn(() => ({
      send: s3SendMock,
    })),
    PutObjectCommand: vi.fn((input) => ({ input })),
  };
});

describe('core.file.writer component', () => {
  let component: ReturnType<typeof componentRegistry.get<FileWriterInput, FileWriterOutput>>;

  beforeAll(async () => {
    await import('../../index');
    component = componentRegistry.get<FileWriterInput, FileWriterOutput>('core.file.writer');
  });

  beforeEach(() => {
    s3SendMock.mockReset();
  });

  it('registers with the expected metadata', () => {
    expect(component).toBeDefined();
    expect(component?.label).toBe('File Writer');
    expect(component?.ui?.slug).toBe('file-writer');
  });

  it('uploads to the artifact service when local destinations are selected', async () => {
    if (!component) throw new Error('Component not registered');

    const uploadMock = vi.fn().mockResolvedValue({
      artifactId: 'artifact-1',
      fileId: 'file-1',
      name: 'output.txt',
      destinations: ['run'],
    });

    const artifacts: IArtifactService = {
      upload: uploadMock,
      download: vi.fn(),
    };

    const context = createExecutionContext({
      runId: 'run-123',
      componentRef: 'node-1',
      artifacts,
    });

    const executePayload = {
      inputs: {
        content: 'Hello world',
        destination: {
          adapterId: 'artifact',
          config: { destinations: ['run'] },
        },
      },
      params: {
        fileName: 'output.txt',
      },
    };

    const result = await component.execute(executePayload, context);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const payload = uploadMock.mock.calls[0][0];
    expect(payload.name).toBe('output.txt');
    expect(payload.destinations).toEqual(['run']);
    expect(payload.content.toString('utf-8')).toBe('Hello world');
    expect(result.artifactId).toBe('artifact-1');
    expect(result.destinations).toEqual(['run']);
    expect(result.size).toBe(11);
  });

  it('requires a destination configuration', () => {
    if (!component) throw new Error('Component not registered');

    expect(() =>
      component?.inputs.parse({
        fileName: 'noop.txt',
        content: 'Missing destinations',
      }),
    ).toThrow();
  });

  it('uses an explicit destination adapter when provided', async () => {
    if (!component) throw new Error('Component not registered');

    const uploadMock = vi.fn().mockResolvedValue({
      artifactId: 'dest-1',
      fileId: 'file-d1',
      name: 'adapter.txt',
      destinations: ['library'],
    });

    const artifacts: IArtifactService = {
      upload: uploadMock,
      download: vi.fn(),
    };

    const context = createExecutionContext({
      runId: 'run-destination',
      componentRef: 'node-destination',
      artifacts,
    });

    const executePayload = {
      inputs: {
        content: 'Destination registry FTW',
        destination: {
          adapterId: 'artifact',
          config: { destinations: ['library'] },
        },
      },
      params: {
        fileName: 'adapter.txt',
      },
    };

    const result = await component.execute(executePayload, context);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(result.destinations).toEqual(['library']);
    expect(result.artifactId).toBe('dest-1');
  });

  it('uploads to S3 when configured and annotates remote metadata', async () => {
    if (!component) throw new Error('Component not registered');

    s3SendMock.mockResolvedValue({ ETag: '"abc123"' });

    const context = createExecutionContext({
      runId: 'run-789',
      componentRef: 'node-3',
    });

    const executePayload = {
      inputs: {
        content: { status: 'ok' },
        destination: {
          adapterId: 's3',
          config: {
            bucket: 'shipsec-artifacts',
            credentials: {
              accessKeyId: 'AKIA123',
              secretAccessKey: 'secret',
            },
            pathPrefix: 'runs/demo',
            publicUrl: 'https://cdn.example.com/artifacts',
          },
        },
      },
      params: {
        fileName: 'report.json',
        mimeType: 'application/json',
        contentFormat: 'json' as const,
      },
    };

    const result = await component.execute(executePayload, context);

    expect(s3SendMock).toHaveBeenCalledTimes(1);
    const commandInput = (s3SendMock.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(commandInput.Bucket).toBe('shipsec-artifacts');
    expect(commandInput.Key).toBe('runs/demo/report.json');

    expect(result.remoteUploads).toHaveLength(1);
    expect(result.remoteUploads![0]).toMatchObject({
      bucket: 'shipsec-artifacts',
      key: 'runs/demo/report.json',
      url: 'https://cdn.example.com/artifacts/runs/demo/report.json',
      etag: 'abc123',
    });

    expect(result.remoteUploads?.[0].uri).toBe('s3://shipsec-artifacts/runs/demo/report.json');
    expect(result.artifactId).toBeUndefined();
  });
});

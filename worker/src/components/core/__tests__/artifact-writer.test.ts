import { beforeAll, describe, expect, it, vi } from 'bun:test';
import { createExecutionContext, type IArtifactService } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { ArtifactWriterInput, ArtifactWriterOutput } from '../artifact-writer';

describe('core.artifact.writer component', () => {
  let component: ReturnType<
    typeof componentRegistry.get<ArtifactWriterInput, ArtifactWriterOutput>
  >;

  beforeAll(async () => {
    await import('../../index');
    component = componentRegistry.get<ArtifactWriterInput, ArtifactWriterOutput>(
      'core.artifact.writer',
    );
  });

  it('should be registered with expected metadata', () => {
    expect(component).toBeDefined();
    expect(component?.label).toBe('Artifact Writer');
    expect(component?.ui?.slug).toBe('artifact-writer');
  });

  it('uploads content to the artifact service when destinations are selected', async () => {
    if (!component) throw new Error('Component not registered');

    const uploadMock = vi.fn().mockResolvedValue({
      artifactId: 'artifact-123',
      fileId: 'file-123',
      name: 'playground-artifact.txt',
      destinations: ['run', 'library'],
    });

    const mockArtifacts: IArtifactService = {
      upload: uploadMock,
      download: vi.fn(),
    };

    const context = createExecutionContext({
      runId: 'run-1',
      componentRef: 'artifact-writer-1',
      artifacts: mockArtifacts,
    });

    const executePayload = {
      inputs: {
        content: 'Hello artifacts!',
      },
      params: {
        fileName: 'run-log.txt',
        mimeType: 'text/plain',
        saveToRunArtifacts: true,
        publishToArtifactLibrary: true,
      },
    };

    const result = await component.execute(executePayload, context);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const payload = uploadMock.mock.calls[0][0];
    expect(payload.destinations).toEqual(['run', 'library']);
    expect(payload.name).toBe('run-log.txt');
    expect(payload.mimeType).toBe('text/plain');
    expect(payload.content.toString('utf-8')).toBe('Hello artifacts!');

    expect(result.saved).toBe(true);
    expect(result.artifactId).toBe('artifact-123');
    expect(result.destinations).toEqual(['run', 'library']);
  });

  it('skips upload when no destinations are selected', async () => {
    if (!component) throw new Error('Component not registered');

    const uploadMock = vi.fn();
    const context = createExecutionContext({
      runId: 'run-2',
      componentRef: 'artifact-writer-2',
      artifacts: {
        upload: uploadMock,
        download: vi.fn(),
      },
    });

    const executePayload = {
      inputs: {
        content: 'No destinations',
      },
      params: {
        fileName: 'noop.txt',
        saveToRunArtifacts: false,
        publishToArtifactLibrary: false,
      },
    };

    const result = await component.execute(executePayload, context);

    expect(uploadMock).not.toHaveBeenCalled();
    expect(result.saved).toBe(false);
    expect(result.artifactId).toBeUndefined();
    expect(result.destinations).toEqual([]);
  });

  it('throws when artifact service is missing but destinations are requested', async () => {
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'run-3',
      componentRef: 'artifact-writer-3',
    });

    const executePayload = {
      inputs: {
        content: 'Need artifacts',
      },
      params: {
        saveToRunArtifacts: true,
        publishToArtifactLibrary: false,
      },
    };

    await expect(component.execute(executePayload, context)).rejects.toThrow(
      'Artifact service is not available',
    );
  });
});

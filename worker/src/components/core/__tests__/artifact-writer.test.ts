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
      name: 'run-log.txt',
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
        artifactName: 'run-log',
        content: 'Hello artifacts!',
      },
      params: {
        fileExtension: '.txt',
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
    expect(result.artifactName).toBe('run-log');
    expect(result.fileName).toBe('run-log.txt');
    expect(result.destinations).toEqual(['run', 'library']);
  });

  it('substitutes dynamic placeholders in artifact name', async () => {
    if (!component) throw new Error('Component not registered');

    const uploadMock = vi.fn().mockResolvedValue({
      artifactId: 'artifact-456',
      fileId: 'file-456',
      name: 'test-artifact.json',
      destinations: ['run'],
    });

    const mockArtifacts: IArtifactService = {
      upload: uploadMock,
      download: vi.fn(),
    };

    const context = createExecutionContext({
      runId: 'test-run-abc123',
      componentRef: 'artifact-writer-2',
      artifacts: mockArtifacts,
    });

    const executePayload = {
      inputs: {
        artifactName: '{{run_id}}-{{task}}',
        content: { data: 'test' },
      },
      params: {
        fileExtension: '.json',
        mimeType: 'application/json',
        saveToRunArtifacts: true,
        publishToArtifactLibrary: false,
      },
    };

    const result = await component.execute(executePayload, context);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const payload = uploadMock.mock.calls[0][0];
    expect(payload.name).toBe('test-run-abc123-artifact-writer-2.json');
    expect(result.artifactName).toBe('test-run-abc123-artifact-writer-2');
    expect(result.fileName).toBe('test-run-abc123-artifact-writer-2.json');
  });

  it('skips upload when no destinations are selected', async () => {
    if (!component) throw new Error('Component not registered');

    const uploadMock = vi.fn();
    const context = createExecutionContext({
      runId: 'run-2',
      componentRef: 'artifact-writer-skip',
      artifacts: {
        upload: uploadMock,
        download: vi.fn(),
      },
    });

    const executePayload = {
      inputs: {
        artifactName: 'noop',
        content: 'No destinations',
      },
      params: {
        fileExtension: '.txt',
        saveToRunArtifacts: false,
        publishToArtifactLibrary: false,
      },
    };

    const result = await component.execute(executePayload, context);

    expect(uploadMock).not.toHaveBeenCalled();
    expect(result.saved).toBe(false);
    expect(result.artifactId).toBeUndefined();
    expect(result.artifactName).toBe('noop');
    expect(result.fileName).toBe('noop.txt');
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
        artifactName: 'test-artifact',
        content: 'Need artifacts',
      },
      params: {
        fileExtension: '.txt',
        saveToRunArtifacts: true,
        publishToArtifactLibrary: false,
      },
    };

    await expect(component.execute(executePayload, context)).rejects.toThrow(
      'Artifact service is not available',
    );
  });

  it('uses default artifact name template when not provided', async () => {
    if (!component) throw new Error('Component not registered');

    const uploadMock = vi.fn().mockResolvedValue({
      artifactId: 'artifact-default',
      fileId: 'file-default',
      name: 'default.txt',
      destinations: ['run'],
    });

    const mockArtifacts: IArtifactService = {
      upload: uploadMock,
      download: vi.fn(),
    };

    const context = createExecutionContext({
      runId: 'run-default-test',
      componentRef: 'artifact-writer-default',
      artifacts: mockArtifacts,
    });

    const executePayload = {
      inputs: {
        // artifactName not provided, should use default template
        content: 'Default name test',
      },
      params: {
        fileExtension: '.txt',
        saveToRunArtifacts: true,
        publishToArtifactLibrary: false,
      },
    };

    const result = await component.execute(executePayload, context);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const payload = uploadMock.mock.calls[0][0];
    // Should contain run_id and timestamp pattern
    expect(payload.name).toMatch(/^run-default-test-\d+\.txt$/);
    expect(result.artifactName).toMatch(/^run-default-test-\d+$/);
    expect(result.saved).toBe(true);
  });
});

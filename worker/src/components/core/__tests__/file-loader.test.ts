import { describe, it, expect, beforeAll } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import type { IFileStorageService } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { FileLoaderInput, FileLoaderOutput } from '../file-loader';

describe('file-loader component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  it('should be registered', () => {
    const component = componentRegistry.get<FileLoaderInput, FileLoaderOutput>('core.file.loader');
    expect(component).toBeDefined();
    expect(component!.label).toBe('File Loader');
    expect(component!.category).toBe('input');
  });

  it('should load file from storage', async () => {
    const component = componentRegistry.get<FileLoaderInput, FileLoaderOutput>('core.file.loader');
    if (!component) throw new Error('Component not registered');

    const testFileId = '123e4567-e89b-12d3-a456-426614174000';

    // Mock storage service
    const mockStorage: IFileStorageService = {
      downloadFile: async (fileId: string) => {
        expect(fileId).toBe(testFileId);
        return {
          buffer: Buffer.from('Hello, World!'),
          metadata: {
            id: fileId,
            fileName: 'test.txt',
            mimeType: 'text/plain',
            size: 13,
          },
        };
      },
      getFileMetadata: async () => {
        throw new Error('Not implemented');
      },
    };

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'file-loader-test',
      storage: mockStorage,
    });

    const params = component.inputSchema.parse({
      fileId: testFileId,
    });

    const result = await component.execute(params, context);

    expect(result.file.id).toBe(testFileId);
    expect(result.file.name).toBe('test.txt');
    expect(result.file.mimeType).toBe('text/plain');
    expect(result.file.size).toBe(13);
    expect(result.file.content).toBe(Buffer.from('Hello, World!').toString('base64'));
    expect(result.textContent).toBe('Hello, World!');
  });

  it('should throw error when storage service is not available', async () => {
    const component = componentRegistry.get<FileLoaderInput, FileLoaderOutput>('core.file.loader');
    if (!component) throw new Error('Component not registered');

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'file-loader-test',
      // No storage service
    });

    const params = component.inputSchema.parse({
      fileId: '223e4567-e89b-12d3-a456-426614174001',
    });

    await expect(component.execute(params, context)).rejects.toThrow(
      'Storage service not available',
    );
  });

  it('should handle binary files', async () => {
    const component = componentRegistry.get<FileLoaderInput, FileLoaderOutput>('core.file.loader');
    if (!component) throw new Error('Component not registered');

    const imageFileId = '323e4567-e89b-12d3-a456-426614174002';
    const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header

    const mockStorage: IFileStorageService = {
      downloadFile: async (fileId: string) => ({
        buffer: binaryData,
        metadata: {
          id: fileId,
          fileName: 'image.png',
          mimeType: 'image/png',
          size: binaryData.length,
        },
      }),
      getFileMetadata: async () => {
        throw new Error('Not implemented');
      },
    };

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'file-loader-test',
      storage: mockStorage,
    });

    const params = component.inputSchema.parse({
      fileId: imageFileId,
    });

    const result = await component.execute(params, context);

    expect(result.file.mimeType).toBe('image/png');
    expect(result.file.content).toBe(binaryData.toString('base64'));
  });
});

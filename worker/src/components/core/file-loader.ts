import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  ConfigurationError,
  ComponentRetryPolicy,
  inputs,
  outputs,
  port,
} from '@shipsec/component-sdk';
import { fileContractSchema } from '@shipsec/contracts';

const inputSchema = inputs({
  fileId: port(z.string().uuid().describe('File ID from uploaded files'), {
    label: 'File ID',
    description: 'File ID from uploaded file (typically from Entry Point runtime input).',
    connectionType: { kind: 'primitive', name: 'file' },
  }),
});

const outputSchema = outputs({
  file: port(fileContractSchema(), {
    label: 'File Data',
    description: 'Complete file metadata and base64 encoded content.',
  }),
  textContent: port(z.string(), {
    label: 'Text Content',
    description: 'Decoded text content of the file (UTF-8).',
  }),
});

// Retry policy for file operations - quick retries for transient I/O issues
const fileLoaderRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 3,
  initialIntervalSeconds: 1,
  maximumIntervalSeconds: 10,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['NotFoundError', 'ConfigurationError', 'ValidationError'],
};

const definition = defineComponent({
  id: 'core.file.loader',
  label: 'File Loader',
  category: 'input',
  runner: { kind: 'inline' },
  retryPolicy: fileLoaderRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Loads file content from storage. Requires a fileId from previously uploaded file.',
  ui: {
    slug: 'file-loader',
    version: '1.0.0',
    type: 'input',
    category: 'input',
    description: 'Load file contents from ShipSec storage for use in workflows.',
    icon: 'FileUp',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Load a scope text file before passing content into Text Splitter or scanners.',
      'Fetch uploaded configuration archives to hand off to downstream components.',
    ],
  },
  async execute({ inputs }, context) {
    context.logger.info(`[FileLoader] Loading file with ID: ${inputs.fileId}`);

    // Use storage interface (not concrete implementation!)
    const storage = context.storage;

    if (!storage) {
      throw new ConfigurationError(
        'Storage service not available in execution context. Worker must provide IFileStorageService adapter.',
        { configKey: 'storage' },
      );
    }

    context.emitProgress('Fetching file from storage...');

    // Download file using interface
    const { buffer, metadata } = await storage.downloadFile(inputs.fileId);

    context.logger.info(
      `[FileLoader] Loaded file: ${metadata.fileName} (${metadata.size} bytes, ${metadata.mimeType})`,
    );

    context.emitProgress(`File loaded: ${metadata.fileName}`);

    // Convert to base64 for downstream components
    const content = buffer.toString('base64');

    // Also provide decoded text content
    const textContent = buffer.toString('utf-8');

    return {
      file: {
        id: metadata.id,
        name: metadata.fileName,
        mimeType: metadata.mimeType,
        size: metadata.size,
        content,
      },
      textContent,
    };
  },
});

componentRegistry.register(definition);

// Create local type aliases for backward compatibility
type Input = typeof inputSchema;
type Output = typeof outputSchema;

export type { Input as FileLoaderInput, Output as FileLoaderOutput };

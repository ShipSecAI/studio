import { z } from 'zod';
import { componentRegistry, ComponentDefinition } from '@shipsec/component-sdk';

const inputSchema = z.object({
  fileId: z.string().uuid().describe('File ID from uploaded files'),
});

type Input = z.infer<typeof inputSchema>;

type Output = {
  file: {
    id: string;
    name: string;
    mimeType: string;
    size: number;
    content: string; // base64 encoded
  };
  textContent: string; // decoded text content
};

const outputSchema = z.object({
  file: z.object({
    id: z.string(),
    name: z.string(),
    mimeType: z.string(),
    size: z.number(),
    content: z.string(),
  }),
  textContent: z.string(),
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.file.loader',
  label: 'File Loader',
  category: 'input',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Loads file content from storage. Requires a fileId from previously uploaded file.',
  metadata: {
    slug: 'file-loader',
    version: '1.0.0',
    type: 'input',
    category: 'input-output',
    description: 'Load file contents from ShipSec storage for use in workflows.',
    icon: 'FileUp',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'fileId',
        label: 'File ID',
        type: 'string',
        required: true,
        description: 'File ID from uploaded file (typically from Manual Trigger runtime input).',
      },
    ],
    outputs: [
      {
        id: 'file',
        label: 'File Data',
        type: 'object',
        description: 'Complete file metadata and base64 encoded content.',
      },
      {
        id: 'textContent',
        label: 'Text Content',
        type: 'string',
        description: 'Decoded text content of the file (UTF-8).',
      },
    ],
    examples: [
      'Load a scope text file before passing content into Text Splitter or scanners.',
      'Fetch uploaded configuration archives to hand off to downstream components.',
    ],
    parameters: [],
  },
  async execute(params, context) {
    context.logger.info(`[FileLoader] Loading file with ID: ${params.fileId}`);

    // Use storage interface (not concrete implementation!)
    const storage = context.storage;
    
    if (!storage) {
      throw new Error(
        'Storage service not available in execution context. Worker must provide IFileStorageService adapter.',
      );
    }

    context.emitProgress('Fetching file from storage...');

    // Download file using interface
    const { buffer, metadata } = await storage.downloadFile(params.fileId);

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
};

componentRegistry.register(definition);

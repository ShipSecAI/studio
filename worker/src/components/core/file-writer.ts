import { z } from 'zod';
import { componentRegistry, ComponentDefinition, port, ValidationError } from '@shipsec/component-sdk';
import {
  DestinationConfigSchema,
  type DestinationConfig,
  ArtifactRemoteUploadSchema,
} from '@shipsec/shared';
import { createDestinationAdapter, type DestinationSaveInput } from '../../destinations';

const contentFormatSchema = z.enum(['text', 'json', 'base64']);

const inputSchema = z.object({
  fileName: z
    .string()
    .min(1, 'File name is required')
    .default('output.txt')
    .describe('Name to use when persisting the generated file.'),
  content: z
    .any()
    .optional()
    .describe('Payload to store. Accepts strings, JSON objects, arrays, or base64 text.'),
  contentFormat: contentFormatSchema
    .default('text')
    .describe('Controls how the input payload is interpreted before writing.'),
  mimeType: z
    .string()
    .default('text/plain')
    .describe('MIME type for the stored file.'),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Optional metadata to attach to the artifact record.'),
  destination: DestinationConfigSchema.describe(
    'Destination adapter configuration produced by a destination component.',
  ),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  artifactId: z.string().optional(),
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().nonnegative(),
  destinations: z.array(z.enum(['run', 'library'])).default([]),
  remoteUploads: z.array(ArtifactRemoteUploadSchema).optional(),
  savedToArtifactLibrary: z.boolean(),
});

type Output = z.infer<typeof outputSchema>;

function buildBufferFromContent(content: unknown, format: Input['contentFormat']): Buffer {
  if (format === 'base64') {
    if (typeof content !== 'string') {
      throw new ValidationError('Base64 content must be provided as a string.', {
        fieldErrors: { content: ['Expected a base64-encoded string'] },
      });
    }
    return Buffer.from(content, 'base64');
  }

  if (format === 'json') {
    if (typeof content === 'string') {
      return Buffer.from(content, 'utf-8');
    }
    return Buffer.from(JSON.stringify(content ?? null, null, 2), 'utf-8');
  }

  if (typeof content === 'string') {
    return Buffer.from(content, 'utf-8');
  }

  if (content === undefined || content === null) {
    return Buffer.alloc(0);
  }

  if (Buffer.isBuffer(content)) {
    return content;
  }

  return Buffer.from(
    typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content),
    'utf-8',
  );
}

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.file.writer',
  label: 'File Writer',
  category: 'output',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs:
    'Persists structured or binary output to the Artifact Library and/or S3. Use it to promote scanner reports, JSON payloads, or logs into durable storage.',
  metadata: {
    slug: 'file-writer',
    version: '1.0.0',
    type: 'process',
    category: 'output',
    description: 'Write component output to run artifacts, the Artifact Library, or S3 buckets.',
    icon: 'FolderArchive',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    inputs: [
      {
        id: 'content',
        label: 'Payload',
        dataType: port.any(),
        description:
          'Payload to persist. Accepts strings, JSON data, buffers, or base64 text from upstream components.',
      },
      {
        id: 'destination',
        label: 'Destination',
        dataType: port.contract('destination.writer'),
        required: true,
        description: 'Connect a destination provider to decide where the file should be stored.',
      },
    ],
    outputs: [
      {
        id: 'artifactId',
        label: 'Artifact ID',
        dataType: port.text(),
        description: 'Artifact identifier returned when saving locally.',
      },
    ],
    parameters: [
      {
        id: 'fileName',
        label: 'File Name',
        type: 'text',
        default: 'output.txt',
        description: 'Name for the generated artifact.',
      },
      {
        id: 'mimeType',
        label: 'MIME Type',
        type: 'text',
        default: 'text/plain',
        description: 'Content MIME type (text/plain, application/json, etc).',
      },
      {
        id: 'content',
        label: 'Content',
        type: 'textarea',
        description: 'Manual payload fallback. Connections override this value.',
      },
      {
        id: 'contentFormat',
        label: 'Content Format',
        type: 'select',
        default: 'text',
        options: [
          { label: 'Text', value: 'text' },
          { label: 'JSON', value: 'json' },
          { label: 'Base64', value: 'base64' },
        ],
        description: 'How to interpret the payload before writing.',
      },
      {
        id: 'metadata',
        label: 'Artifact Metadata',
        type: 'json',
        description: 'Custom metadata stored with the artifact record.',
      },
    ],
  },
  async execute(params, context) {
    if (params.content === undefined || params.content === null) {
      throw new ValidationError('No content provided. Connect an upstream node or set the Content parameter.', {
        fieldErrors: { content: ['Content is required'] },
      });
    }

    const buffer = buildBufferFromContent(params.content, params.contentFormat);

    if (buffer.byteLength === 0) {
      context.logger.info('[FileWriter] Payload is empty; writing zero-byte file.');
    } else {
      context.logger.info(
        `[FileWriter] Preparing to write ${buffer.byteLength} bytes as ${params.mimeType}`,
      );
    }

    const saveInput: DestinationSaveInput = {
      fileName: params.fileName,
      mimeType: params.mimeType,
      buffer,
      metadata: params.metadata,
    };

    const adapter = createDestinationAdapter(params.destination as DestinationConfig);
    const saveResult = await adapter.save(saveInput, context);

    const destinations = saveResult.destinations ?? [];

    return {
      artifactId: saveResult.artifactId,
      fileName: params.fileName,
      mimeType: params.mimeType,
      size: buffer.byteLength,
      destinations,
      remoteUploads: saveResult.remoteUploads,
      savedToArtifactLibrary: destinations.includes('library'),
    };
  },
};

componentRegistry.register(definition);

export type { Input as FileWriterInput, Output as FileWriterOutput };

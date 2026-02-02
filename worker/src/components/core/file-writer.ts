import { z } from 'zod';
import {
  componentRegistry,
  ValidationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { destinationWriterSchema } from '@shipsec/contracts';
import { type DestinationConfig, ArtifactRemoteUploadSchema } from '@shipsec/shared';
import { createDestinationAdapter, type DestinationSaveInput } from '../../destinations';

const contentFormatSchema = z.enum(['text', 'json', 'base64']);

const inputSchema = inputs({
  content: port(
    z
      .any()
      .optional()
      .describe('Payload to store. Accepts strings, JSON objects, arrays, or base64 text.'),
    {
      label: 'Payload',
      description:
        'Payload to persist. Accepts strings, JSON data, buffers, or base64 text from upstream components.',
      allowAny: true,
      reason: 'File Writer accepts arbitrary payloads and serializes based on contentFormat.',
      editor: 'textarea',
    },
  ),
  destination: port(destinationWriterSchema(), {
    label: 'Destination',
    description: 'Connect a destination provider to decide where the file should be stored.',
  }),
});

const parameterSchema = parameters({
  fileName: param(
    z
      .string()
      .min(1, 'File name is required')
      .default('output.txt')
      .describe('Name to use when persisting the generated file.'),
    {
      label: 'File Name',
      editor: 'text',
      description: 'Name for the generated artifact.',
    },
  ),
  mimeType: param(z.string().default('text/plain').describe('MIME type for the stored file.'), {
    label: 'MIME Type',
    editor: 'text',
    description: 'Content MIME type (text/plain, application/json, etc).',
  }),
  contentFormat: param(
    contentFormatSchema
      .default('text')
      .describe('Controls how the input payload is interpreted before writing.'),
    {
      label: 'Content Format',
      editor: 'select',
      options: [
        { label: 'Text', value: 'text' },
        { label: 'JSON', value: 'json' },
        { label: 'Base64', value: 'base64' },
      ],
      description: 'How to interpret the payload before writing.',
    },
  ),
  metadata: param(
    z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Optional metadata to attach to the artifact record.'),
    {
      label: 'Artifact Metadata',
      editor: 'json',
      description: 'Custom metadata stored with the artifact record.',
    },
  ),
});

const outputSchema = outputs({
  artifactId: port(z.string().optional(), {
    label: 'Artifact ID',
    description: 'Artifact identifier returned when saving locally.',
  }),
  fileName: port(z.string(), {
    label: 'File Name',
    description: 'Name of the file written to storage.',
  }),
  mimeType: port(z.string(), {
    label: 'MIME Type',
    description: 'Detected or provided MIME type for the stored file.',
  }),
  size: port(z.number().nonnegative(), {
    label: 'Size',
    description: 'Size of the stored payload in bytes.',
  }),
  destinations: port(z.array(z.enum(['run', 'library'])).default([]), {
    label: 'Destinations',
    description: 'Destinations the file was written to.',
  }),
  remoteUploads: port(z.array(ArtifactRemoteUploadSchema).optional(), {
    label: 'Remote Uploads',
    description: 'Remote upload responses returned by destination adapters.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  savedToArtifactLibrary: port(z.boolean(), {
    label: 'Saved To Library',
    description: 'Indicates whether the file was stored in the artifact library.',
  }),
});

function buildBufferFromContent(content: unknown, format: 'text' | 'base64' | 'json'): Buffer {
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

const definition = defineComponent({
  id: 'core.file.writer',
  label: 'File Writer',
  category: 'output',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Persists structured or binary output to the Artifact Library and/or S3. Use it to promote scanner reports, JSON payloads, or logs into durable storage.',
  ui: {
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
  },
  async execute({ inputs, params }, context) {
    if (inputs.content === undefined || inputs.content === null) {
      throw new ValidationError(
        'No content provided. Connect an upstream node or set the Content input.',
        {
          fieldErrors: { content: ['Content is required'] },
        },
      );
    }

    const buffer = buildBufferFromContent(inputs.content, params.contentFormat);

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

    const adapter = createDestinationAdapter(inputs.destination as DestinationConfig);
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
});

componentRegistry.register(definition);

// Create local type aliases for backward compatibility
type Input = typeof inputSchema;
type Output = typeof outputSchema;

export type { Input as FileWriterInput, Output as FileWriterOutput };

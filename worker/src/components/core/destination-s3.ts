import { z } from 'zod';
import {
  componentRegistry,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { awsCredentialSchema, destinationWriterSchema } from '@shipsec/contracts';
import { type DestinationConfig } from '@shipsec/shared';

const inputSchema = inputs({
  credentials: port(awsCredentialSchema(), {
    label: 'AWS Credentials',
    description: 'Connect the AWS Credentials bundle component.',
  }),
});

const parameterSchema = parameters({
  bucket: param(z.string().min(1, 'Bucket is required'), {
    label: 'Bucket',
    editor: 'text',
  }),
  region: param(z.string().optional(), {
    label: 'Region',
    editor: 'text',
  }),
  pathPrefix: param(z.string().optional(), {
    label: 'Path prefix',
    editor: 'text',
  }),
  objectKey: param(z.string().optional(), {
    label: 'Explicit object key',
    editor: 'text',
  }),
  endpoint: param(z.string().optional(), {
    label: 'Custom endpoint',
    editor: 'text',
  }),
  forcePathStyle: param(z.boolean().default(false), {
    label: 'Force path style',
    editor: 'boolean',
  }),
  publicUrl: param(z.string().optional(), {
    label: 'Public URL prefix',
    editor: 'text',
  }),
  label: param(z.string().optional(), {
    label: 'Label override',
    editor: 'text',
  }),
  description: param(z.string().optional(), {
    label: 'Description',
    editor: 'textarea',
  }),
});

const outputSchema = outputs({
  destination: port(destinationWriterSchema(), {
    label: 'Destination',
    description: 'Connect to writer components to upload artifacts to S3.',
  }),
});

const definition = defineComponent({
  id: 'core.destination.s3',
  label: 'S3 Destination',
  category: 'output',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Produces a destination configuration that uploads files to an S3 bucket (or compatible storage).',
  ui: {
    slug: 'destination-s3',
    version: '1.0.0',
    type: 'process',
    category: 'output',
    description: 'Configure uploads to S3 buckets for downstream writer components.',
    icon: 'CloudUpload',
  },
  async execute({ inputs, params }, context) {
    context.logger.info(`[S3Destination] Configured for bucket: ${params.bucket}`);

    const destination: DestinationConfig = {
      adapterId: 's3',
      config: {
        bucket: params.bucket,
        region: params.region,
        pathPrefix: params.pathPrefix,
        objectKey: params.objectKey,
        endpoint: params.endpoint,
        forcePathStyle: params.forcePathStyle,
        publicUrl: params.publicUrl,
        credentials: inputs.credentials,
      },
      metadata: {
        label: params.label,
        description: params.description,
      },
    };

    return { destination };
  },
});

componentRegistry.register(definition);

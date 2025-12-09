import { z } from 'zod';
import { componentRegistry, ComponentDefinition, port } from '@shipsec/component-sdk';
import { awsCredentialSchema, awsCredentialContractName } from './credentials/aws-contract';

const inputSchema = z.object({
  accessKeyId: z.string().min(1, 'Access key ID is required'),
  secretAccessKey: z.string().min(1, 'Secret access key is required'),
  sessionToken: z.string().optional(),
  region: z.string().optional(),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  credentials: awsCredentialSchema,
});

type Output = z.infer<typeof outputSchema>;

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.credentials.aws',
  label: 'AWS Credentials Bundle',
  category: 'output',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Combine discrete AWS secrets into a structured credential payload for downstream components.',
  metadata: {
    slug: 'aws-credentials',
    version: '1.0.0',
    type: 'process',
    category: 'output',
    description: 'Bundle AWS access key, secret key, and optional session token into a single credential object.',
    icon: 'KeySquare',
    inputs: [
      {
        id: 'accessKeyId',
        label: 'Access Key ID',
        dataType: port.secret(),
        required: true,
        description: 'Resolved AWS access key ID (connect from a Secret Loader).',
      },
      {
        id: 'secretAccessKey',
        label: 'Secret Access Key',
        dataType: port.secret(),
        required: true,
        description: 'Resolved AWS secret access key (connect from a Secret Loader).',
      },
      {
        id: 'sessionToken',
        label: 'Session Token',
        dataType: port.secret(),
        required: false,
        description: 'Optional AWS session token (for STS/assumed roles).',
      },
      {
        id: 'region',
        label: 'Default Region',
        dataType: port.text(),
        required: false,
        description: 'Optional default AWS region to associate with this credential.',
      },
    ],
    outputs: [
      {
        id: 'credentials',
        label: 'AWS Credentials',
        dataType: port.credential(awsCredentialContractName),
        description: 'Sensitive credential bundle that can be consumed by AWS-aware components.',
      },
    ],
  },
  async execute(params, context) {
    context.logger.info('[AWSCredentials] Bundled AWS credentials');

    return {
      credentials: {
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
        sessionToken: params.sessionToken,
        region: params.region,
      },
    };
  },
};

componentRegistry.register(definition);

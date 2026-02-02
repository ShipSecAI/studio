import { z } from 'zod';
import { componentRegistry, defineComponent, inputs, outputs, port } from '@shipsec/component-sdk';
import { awsCredentialSchema } from '@shipsec/contracts';

const inputSchema = inputs({
  accessKeyId: port(z.string().min(1, 'Access key ID is required'), {
    label: 'Access Key ID',
    description: 'Resolved AWS access key ID (connect from a Secret Loader).',
    editor: 'secret',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
  secretAccessKey: port(z.string().min(1, 'Secret access key is required'), {
    label: 'Secret Access Key',
    description: 'Resolved AWS secret access key (connect from a Secret Loader).',
    editor: 'secret',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
  sessionToken: port(z.string().optional(), {
    label: 'Session Token',
    description: 'Optional AWS session token (for STS/assumed roles).',
    editor: 'secret',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
  region: port(z.string().optional(), {
    label: 'Default Region',
    description: 'Optional default AWS region to associate with this credential.',
  }),
});

const outputSchema = outputs({
  credentials: port(awsCredentialSchema(), {
    label: 'AWS Credentials',
    description: 'Sensitive credential bundle that can be consumed by AWS-aware components.',
  }),
});

const definition = defineComponent({
  id: 'core.credentials.aws',
  label: 'AWS Credentials Bundle',
  category: 'output',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  docs: 'Combine discrete AWS secrets into a structured credential payload for downstream components.',
  ui: {
    slug: 'aws-credentials',
    version: '1.0.0',
    type: 'process',
    category: 'output',
    description:
      'Bundle AWS access key, secret key, and optional session token into a single credential object.',
    icon: 'KeySquare',
  },
  async execute({ inputs }, context) {
    context.logger.info('[AWSCredentials] Bundled AWS credentials');

    return {
      credentials: {
        accessKeyId: inputs.accessKeyId,
        secretAccessKey: inputs.secretAccessKey,
        sessionToken: inputs.sessionToken,
        region: inputs.region,
      },
    };
  },
});

componentRegistry.register(definition);

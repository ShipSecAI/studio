import { z } from 'zod';
import {
  componentRegistry,
  type ComponentDefinition,
  ConfigurationError,
  NotFoundError,
  port,
  registerContract,
  ValidationError,
} from '@shipsec/component-sdk';

const inputSchema = z.object({
  secretId: z
    .string()
    .min(1, 'Secret identifier is required')
    .describe('Name or UUID of the secret in the ShipSec store'),
  version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional version override'),
  outputFormat: z.enum(['raw', 'json']).default('raw').describe('Format for the secret value').optional(),
});

type Input = z.infer<typeof inputSchema>;

type Output = {
  secret: unknown;
  metadata: {
    secretId: string;
    version: number;
    format: 'raw' | 'json';
  };
};

const outputSchema = z.object({
  secret: z.unknown(),
  metadata: z.object({
    secretId: z.string(),
    version: z.number(),
    format: z.enum(['raw', 'json']),
  }),
});

const SECRET_METADATA_CONTRACT = 'core.secret-fetch.metadata.v1';

registerContract({
  name: SECRET_METADATA_CONTRACT,
  schema: outputSchema.shape.metadata,
  summary: 'Secret Fetch metadata payload',
  description: 'Describes which secret/version was resolved and the output formatting used.',
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.secret.fetch',
  label: 'Secret Loader',
  category: 'input',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Fetch a secret from the ShipSec-managed secret store and expose it to downstream nodes.',
  requiresSecrets: true,
  metadata: {
    slug: 'secret-fetch',
    version: '1.1.0',
    type: 'input',
    category: 'input',
    description: 'Resolve a stored secret and provide it as masked output for other components.',
    icon: 'KeyRound',
    inputs: [
      {
        id: 'outputFormat',
        label: 'Output Format',
        dataType: port.text({ coerceFrom: [] }),
        required: false,
        description: 'Return as raw string or JSON-decoded object.',
      },
    ],
    outputs: [
      {
        id: 'secret',
        label: 'Secret Value',
        dataType: port.secret(),
        description: 'Resolved secret value. Masked in logs and traces.',
      },
      {
        id: 'metadata',
        label: 'Secret Metadata',
        dataType: port.contract(SECRET_METADATA_CONTRACT),
        description: 'Information about the resolved secret version.',
      },
    ],
    parameters: [
      {
        id: 'secretId',
        label: 'Secret Name',
        type: 'secret',
        required: true,
        description: 'Name or UUID of the secret from the platform store.',
      },
      {
        id: 'version',
        label: 'Version',
        type: 'number',
        required: false,
        description: 'Optional version pin. Defaults to the active version.',
      },
      {
        id: 'defaultOutputFormat',
        label: 'Default Output Format',
        type: 'select',
        required: false,
        default: 'raw',
        options: [
          { label: 'Raw', value: 'raw' },
          { label: 'JSON', value: 'json' },
        ],
        description: 'Default output format when no format is provided via input.',
        helpText: 'Used when outputFormat input is not connected or empty.',
      },
    ],
  },
  async execute(params, context) {
    if (!context.secrets) {
      throw new ConfigurationError(
        'Secret Fetch component requires the secrets service. Ensure the worker injects ISecretsService.',
        { configKey: 'secrets' },
      );
    }

    context.emitProgress('Resolving secret from store...');

    const resolved = await context.secrets.get(params.secretId, {
      version: params.version,
    });

    if (!resolved) {
      throw new NotFoundError('Secret value unavailable. Verify the secret mapping and active version.', {
        resourceType: 'Secret',
        resourceId: params.secretId,
      });
    }

    const format = params.outputFormat ?? 'raw';
    let secretOutput: unknown = resolved.value;

    if (format === 'json') {
      try {
        secretOutput = JSON.parse(resolved.value);
      } catch (error) {
        throw new ValidationError(`Failed to parse secret value as JSON: ${(error as Error).message}`, {
          cause: error as Error,
          fieldErrors: { outputFormat: ['Invalid JSON in secret value'] },
        });
      }
    }

    context.logger.info(`[SecretFetch] Retrieved secret ${params.secretId} (version ${resolved.version}).`);

    return {
      secret: secretOutput,
      metadata: {
        secretId: params.secretId,
        version: resolved.version,
        format,
      },
    };
  },

};

componentRegistry.register(definition);

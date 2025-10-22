import { z } from 'zod';
import { componentRegistry, type ComponentDefinition } from '@shipsec/component-sdk';

const inputSchema = z.object({
  secretId: z.string().uuid().describe('Secret ID from the ShipSec secret store'),
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

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.secret.fetch',
  label: 'Secret Fetch',
  category: 'input',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: 'Fetch a secret from the ShipSec-managed secret store and expose it to downstream nodes.',
  metadata: {
    slug: 'secret-fetch',
    version: '1.0.0',
    type: 'input',
    category: 'building-block',
    description: 'Resolve a stored secret and provide it as masked output for other components.',
    icon: 'KeyRound',
    inputs: [
      {
        id: 'secretId',
        label: 'Secret',
        type: 'string',
        required: true,
        description: 'Select a secret from the platform store. Stored as the secret ID.',
        valuePriority: 'manual-first',
      },
      {
        id: 'version',
        label: 'Version',
        type: 'number',
        required: false,
        description: 'Optional version pin. Defaults to the active version.',
        valuePriority: 'manual-first',
      },
      {
        id: 'outputFormat',
        label: 'Output Format',
        type: 'string',
        required: false,
        description: 'Return as raw string or JSON-decoded object.',
        valuePriority: 'manual-first',
      },
    ],
    outputs: [
      {
        id: 'secret',
        label: 'Secret Value',
        type: 'secret',
        description: 'Resolved secret value. Masked in logs and traces.',
      },
      {
        id: 'metadata',
        label: 'Secret Metadata',
        type: 'object',
        description: 'Information about the resolved secret version.',
      },
    ],
    parameters: [
      {
        id: 'secretId',
        label: 'Secret ID',
        type: 'secret',
        required: false,
        placeholder: '00000000-0000-0000-0000-000000000000',
        description:
          'Provide a secret identifier manually. Overrides connected inputs when set.',
        helpText: 'Leave blank to use a connected node or runtime input.',
      },
      {
        id: 'version',
        label: 'Version',
        type: 'number',
        required: false,
        description: 'Optional version override. Leave empty to use the active version.',
        helpText: 'Manual value takes priority over connected inputs when provided.',
      },
      {
        id: 'outputFormat',
        label: 'Output Format',
        type: 'select',
        required: false,
        default: 'raw',
        options: [
          { label: 'Raw', value: 'raw' },
          { label: 'JSON', value: 'json' },
        ],
        description: 'Choose how the secret value should be returned.',
        helpText: 'Manual selection takes priority over connected inputs when provided.',
      },
    ],
  },
  async execute(params, context) {
    if (!context.secrets) {
      throw new Error(
        'Secret Fetch component requires the secrets service. Ensure the worker injects ISecretsService.',
      );
    }

    context.emitProgress('Resolving secret from store...');

    const resolved = await context.secrets.get(params.secretId, {
      version: params.version,
    });

    if (!resolved) {
      throw new Error('Secret value unavailable. Verify the secret mapping and active version.');
    }

    const format = params.outputFormat ?? 'raw';
    let secretOutput: unknown = resolved.value;

    if (format === 'json') {
      try {
        secretOutput = JSON.parse(resolved.value);
      } catch (error) {
        throw new Error(`Failed to parse secret value as JSON: ${(error as Error).message}`);
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

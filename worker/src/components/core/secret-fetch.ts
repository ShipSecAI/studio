import { z } from 'zod';
import {
  componentRegistry,
  ConfigurationError,
  NotFoundError,
  ValidationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { secretMetadataSchema } from '@shipsec/contracts';

const inputSchema = inputs({});

const parameterSchema = parameters({
  secretId: param(
    z
      .string()
      .min(1, 'Secret identifier is required')
      .describe('Name or UUID of the secret in the ShipSec store'),
    {
      label: 'Secret Name',
      editor: 'secret',
      description: 'Name or UUID of the secret from the platform store.',
    },
  ),
  version: param(z.number().int().positive().optional().describe('Optional version override'), {
    label: 'Version',
    editor: 'number',
    description: 'Optional version pin. Defaults to the active version.',
  }),
  outputFormat: param(
    z.enum(['raw', 'json']).default('raw').describe('Format for the secret value'),
    {
      label: 'Default Output Format',
      editor: 'select',
      options: [
        { label: 'Raw', value: 'raw' },
        { label: 'JSON', value: 'json' },
      ],
      description: 'Format to use when returning the secret value.',
    },
  ),
});

const outputSchema = outputs({
  secret: port(z.unknown(), {
    label: 'Secret Value',
    description: 'Resolved secret value. Masked in logs and traces.',
    allowAny: true,
    reason: 'Secret Loader can return raw strings or JSON objects.',
    editor: 'secret',
    connectionType: { kind: 'primitive', name: 'secret' },
  }),
  metadata: port(secretMetadataSchema(), {
    label: 'Secret Metadata',
    description: 'Information about the resolved secret version.',
  }),
});

const definition = defineComponent({
  id: 'core.secret.fetch',
  label: 'Secret Loader',
  category: 'input',
  runner: { kind: 'inline' },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Fetch a secret from the ShipSec-managed secret store and expose it to downstream nodes.',
  requiresSecrets: true,
  ui: {
    slug: 'secret-fetch',
    version: '1.1.0',
    type: 'input',
    category: 'input',
    description: 'Resolve a stored secret and provide it as masked output for other components.',
    icon: 'KeyRound',
  },
  async execute({ params }, context) {
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
      throw new NotFoundError(
        'Secret value unavailable. Verify the secret mapping and active version.',
        {
          resourceType: 'Secret',
          resourceId: params.secretId,
        },
      );
    }

    const format = params.outputFormat ?? 'raw';
    let secretOutput: unknown = resolved.value;

    if (format === 'json') {
      try {
        secretOutput = JSON.parse(resolved.value);
      } catch (error) {
        throw new ValidationError(
          `Failed to parse secret value as JSON: ${(error as Error).message}`,
          {
            cause: error as Error,
            fieldErrors: { outputFormat: ['Invalid JSON in secret value'] },
          },
        );
      }
    }

    context.logger.info(
      `[SecretFetch] Retrieved secret ${params.secretId} (version ${resolved.version}).`,
    );

    return {
      secret: secretOutput,
      metadata: {
        secretId: params.secretId,
        version: resolved.version,
        format,
      },
    };
  },
});

componentRegistry.register(definition);

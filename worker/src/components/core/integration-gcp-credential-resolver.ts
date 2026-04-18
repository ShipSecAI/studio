import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  ConfigurationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { gcpCredentialSchema } from '@shipsec/contracts';

import { fetchConnectionCredentials } from './integration-credential-resolver.shared';

const inputSchema = inputs({
  connectionId: port(z.string().trim().optional(), {
    label: 'Connection ID',
    description: 'GCP integration connection ID from Entry Point or static configuration.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

const parameterSchema = parameters({
  connectionId: param(z.string().trim().optional(), {
    label: 'Connection ID',
    editor: 'text',
    description: 'Static GCP integration connection ID when no upstream edge is connected.',
  }),
});

const outputSchema = outputs({
  provider: port(z.literal('gcp'), {
    label: 'Provider',
    description: 'Resolved provider identifier.',
  }),
  accountId: port(z.string().default(''), {
    label: 'Account ID',
    description: 'Resolved GCP project or organization identifier.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  regions: port(z.string().default(''), {
    label: 'Regions',
    description: 'Empty for GCP scans; included for wiring symmetry with other resolvers.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  gcpCredential: port(gcpCredentialSchema(), {
    label: 'GCP Credential',
    description: 'Resolved GCP impersonation credential payload for downstream components.',
    connectionType: { kind: 'contract', name: 'core.credential.gcp', credential: true },
  }),
});

const definition = defineComponent({
  id: 'core.integration.resolve-gcp-credentials',
  label: 'Resolve GCP Credentials',
  category: 'input',
  runner: { kind: 'inline' },
  retryPolicy: {
    maxAttempts: 3,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 10,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: [
      'ConfigurationError',
      'ValidationError',
      'AuthenticationError',
      'NotFoundError',
      'PermissionError',
      'HttpError',
    ],
  } satisfies ComponentRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Resolve GCP credentials from an integration connection and expose a typed GCP credential output.',
  ui: {
    slug: 'integration-gcp-credential-resolver',
    version: '1.0.0',
    type: 'input',
    category: 'core',
    description: 'Resolve a GCP integration connection into typed GCP credentials.',
    icon: 'KeySquare',
  },
  async execute({ inputs, params }, context) {
    const connectionId = (inputs.connectionId || params.connectionId || '').trim();
    if (!connectionId) {
      throw new ConfigurationError('Connection ID is required.', { configKey: 'connectionId' });
    }

    const payload = await fetchConnectionCredentials(
      connectionId,
      context.metadata.organizationId ?? null,
      context,
    );
    if (payload.provider !== 'gcp') {
      throw new ConfigurationError(
        `Expected a GCP connection but received provider '${payload.provider}'.`,
        { configKey: 'connectionId' },
      );
    }

    return outputSchema.parse({
      provider: 'gcp',
      accountId: payload.accountId ?? '',
      regions: '',
      gcpCredential: payload.data,
    });
  },
});

componentRegistry.register(definition);

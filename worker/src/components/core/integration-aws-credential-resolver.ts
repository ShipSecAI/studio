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
import { awsCredentialSchema } from '@shipsec/contracts';

import { fetchConnectionCredentials } from './integration-credential-resolver.shared';

const inputSchema = inputs({
  connectionId: port(z.string().trim().optional(), {
    label: 'Connection ID',
    description: 'AWS integration connection ID from Entry Point or static configuration.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  regions: port(z.string().trim().optional(), {
    label: 'Regions',
    description: 'Optional region override. Falls back to the AWS connection default region.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

const parameterSchema = parameters({
  connectionId: param(z.string().trim().optional(), {
    label: 'Connection ID',
    editor: 'text',
    description: 'Static AWS integration connection ID when no upstream edge is connected.',
  }),
});

const outputSchema = outputs({
  provider: port(z.literal('aws'), {
    label: 'Provider',
    description: 'Resolved provider identifier.',
  }),
  accountId: port(z.string().default(''), {
    label: 'Account ID',
    description: 'AWS account identifier from the resolved connection.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  regions: port(z.string().default(''), {
    label: 'Regions',
    description: 'Regions to scan, defaulting to the connection region when omitted.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  credentials: port(awsCredentialSchema(), {
    label: 'AWS Credentials',
    description: 'Resolved AWS credential payload for downstream components.',
    connectionType: { kind: 'contract', name: 'core.credential.aws', credential: true },
  }),
});

const definition = defineComponent({
  id: 'core.integration.resolve-aws-credentials',
  label: 'Resolve AWS Credentials',
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
  docs: 'Resolve AWS credentials from an integration connection and expose a typed AWS credential output.',
  ui: {
    slug: 'integration-aws-credential-resolver',
    version: '1.0.0',
    type: 'input',
    category: 'core',
    description: 'Resolve an AWS integration connection into typed AWS credentials.',
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
    if (payload.provider !== 'aws') {
      throw new ConfigurationError(
        `Expected an AWS connection but received provider '${payload.provider}'.`,
        { configKey: 'connectionId' },
      );
    }

    const resolvedRegions = (inputs.regions || payload.region || '').trim();

    return outputSchema.parse({
      provider: 'aws',
      accountId: payload.accountId ?? '',
      regions: resolvedRegions,
      credentials: payload.data,
    });
  },
});

componentRegistry.register(definition);

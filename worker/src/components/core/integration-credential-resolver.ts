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
import { fetchConnectionCredentials } from './integration-credential-resolver.shared';

const inputSchema = inputs({
  connectionId: port(
    z.string().trim().optional().describe('Integration connection ID to resolve credentials from.'),
    {
      label: 'Connection ID',
      description: 'Integration connection ID. Wire from Entry Point or set as a parameter.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  regions: port(
    z
      .string()
      .trim()
      .optional()
      .describe('Comma-separated regions to scan. Falls back to the connection default region.'),
    {
      label: 'Regions',
      description: 'Optional region override. If not wired, uses the connection default region.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
});

const parameterSchema = parameters({
  connectionId: param(
    z.string().trim().optional().describe('Integration connection ID to resolve credentials from.'),
    {
      label: 'Connection ID',
      editor: 'text',
      description:
        'Select an integration connection to resolve credentials from. Overridden when wired from an upstream node.',
    },
  ),
  provider: param(
    z.string().trim().optional().describe('Filter connections by provider (e.g. aws, slack).'),
    {
      label: 'Provider Filter',
      editor: 'text',
      description:
        'Optional: restrict the connection dropdown to a specific provider (e.g. "aws", "slack"). Leave empty to show all.',
    },
  ),
});

const outputSchema = outputs({
  credentialType: port(z.string(), {
    label: 'Credential Type',
    description: 'The type of credentials (oauth, api_key, iam_role, webhook)',
  }),
  provider: port(z.string(), {
    label: 'Provider',
    description: 'The integration provider (aws, slack, github, etc.)',
  }),
  accountId: port(z.string().default(''), {
    label: 'Account ID',
    description:
      'Provider account identifier (e.g. AWS 12-digit account ID). Empty when not applicable.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  regions: port(z.string().default(''), {
    label: 'Regions',
    description:
      'Regions to scan. Uses the input override if provided, otherwise falls back to the connection default region.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
  data: port(z.record(z.string(), z.unknown()), {
    label: 'Credentials Data',
    description: 'Resolved credentials data',
    allowAny: true,
    reason: 'Credential payloads vary by provider and credential type.',
    editor: 'secret',
    connectionType: { kind: 'any' },
  }),
});

const definition = defineComponent({
  id: 'core.integration.resolve-credentials',
  label: 'Integration Credential Resolver',
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
  docs: 'Resolve credentials from an integration connection. Calls the internal credentials endpoint and returns the provider, type, and credential data.',
  ui: {
    slug: 'integration-credential-resolver',
    version: '1.0.0',
    type: 'input',
    category: 'core',
    description:
      'Resolve credentials from an integration connection for use by downstream components.',
    icon: 'KeySquare',
  },
  async execute({ inputs, params }, context) {
    // Prefer input port value (wired from upstream), fall back to parameter (static config)
    const connectionId = (inputs.connectionId || params.connectionId || '').trim();

    if (connectionId.length === 0) {
      throw new ConfigurationError('Connection ID is required.', {
        configKey: 'connectionId',
      });
    }

    context.emitProgress(`Resolving credentials for connection ${connectionId}...`);

    const organizationId = context.metadata.organizationId ?? null;
    const payload = await fetchConnectionCredentials(connectionId, organizationId, context);

    context.logger.info(
      `[IntegrationCredentialResolver] Resolved credentials for connection ${connectionId} (provider=${payload.provider}, type=${payload.credentialType}).`,
    );

    // Regions: prefer explicit input, fall back to the connection's default region
    const resolvedRegions = (inputs.regions || payload.region || '').trim();

    // Contribute context for downstream components
    context.contributeRunContext?.('provider', payload.provider);
    if (payload.accountId) context.contributeRunContext?.('accountId', payload.accountId);
    if (payload.displayName) context.contributeRunContext?.('connectionName', payload.displayName);

    return outputSchema.parse({
      credentialType: payload.credentialType,
      provider: payload.provider,
      accountId: payload.accountId ?? '',
      regions: resolvedRegions,
      data: payload.data,
    });
  },
});

componentRegistry.register(definition);

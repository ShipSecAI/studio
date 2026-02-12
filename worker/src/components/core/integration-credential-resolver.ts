import { z } from 'zod';
import {
  componentRegistry,
  ConfigurationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  DEFAULT_SENSITIVE_HEADERS,
  fromHttpResponse,
  type ExecutionContext,
} from '@shipsec/component-sdk';

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

    const payload = await fetchConnectionCredentials(connectionId, context);

    context.logger.info(
      `[IntegrationCredentialResolver] Resolved credentials for connection ${connectionId} (provider=${payload.provider}, type=${payload.credentialType}).`,
    );

    // Regions: prefer explicit input, fall back to the connection's default region
    const resolvedRegions = (inputs.regions || payload.region || '').trim();

    return outputSchema.parse({
      credentialType: payload.credentialType,
      provider: payload.provider,
      accountId: payload.accountId ?? '',
      regions: resolvedRegions,
      data: payload.data,
    });
  },
});

async function fetchConnectionCredentials(
  connectionId: string,
  context: ExecutionContext,
): Promise<{
  credentialType: string;
  provider: string;
  data: Record<string, unknown>;
  accountId?: string;
  region?: string;
}> {
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;

  const baseUrl =
    process.env.STUDIO_API_BASE_URL ??
    process.env.SHIPSEC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    'http://localhost:3211';

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  if (!internalToken) {
    context.emitProgress({
      level: 'warn',
      message:
        'INTERNAL_SERVICE_TOKEN env var not set; requesting credentials without internal auth header.',
    });
  }

  const sensitiveHeaders = internalToken
    ? Array.from(new Set([...DEFAULT_SENSITIVE_HEADERS, 'x-internal-token']))
    : DEFAULT_SENSITIVE_HEADERS;

  const response = await context.http.fetch(
    `${normalizedBase}/integrations/connections/${encodeURIComponent(connectionId)}/credentials`,
    {
      method: 'POST',
      headers: internalToken
        ? {
            'Content-Type': 'application/json',
            'X-Internal-Token': internalToken,
          }
        : {
            'Content-Type': 'application/json',
          },
    },
    { sensitiveHeaders },
  );

  if (!response.ok) {
    const raw = await safeReadText(response);
    throw fromHttpResponse(
      response,
      `Failed to resolve credentials for connection ${connectionId}: ${raw}`,
    );
  }

  const payload = (await response.json()) as {
    credentialType?: string;
    provider?: string;
    data?: Record<string, unknown>;
    accountId?: string;
    region?: string;
  };

  if (!payload.credentialType || !payload.provider) {
    throw new ConfigurationError(
      `Connection ${connectionId} returned an incomplete credential response.`,
      {
        configKey: 'connectionId',
        details: { connectionId },
      },
    );
  }

  return {
    credentialType: payload.credentialType,
    provider: payload.provider,
    data: payload.data ?? {},
    accountId: payload.accountId,
    region: payload.region,
  };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    return `<<unable to read body: ${(error as Error).message}>>`;
  }
}

componentRegistry.register(definition);

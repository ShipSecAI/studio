import { z } from 'zod';
import {
  componentRegistry,
  ConfigurationError,
  fromHttpResponse,
  AuthenticationError,
  ComponentRetryPolicy,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  type PortMeta,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
  // Dynamic values will be injected here by resolvePorts
});

const parameterSchema = parameters({
  authType: param(z.enum(['bot_token', 'webhook', 'credentials']).default('bot_token'), {
    label: 'Connection Method',
    editor: 'select',
    options: [
      { label: 'Slack App (Bot Token)', value: 'bot_token' },
      { label: 'Incoming Webhook', value: 'webhook' },
      { label: 'Integration Connection', value: 'credentials' },
    ],
  }),
  variables: param(
    z.array(z.object({ name: z.string(), type: z.string().optional() })).default([]),
    {
      label: 'Template Variables',
      editor: 'variable-list',
      description: 'Define variables to use as {{name}} in your message.',
    },
  ),
});

const outputSchema = outputs({
  ok: port(z.boolean(), {
    label: 'OK',
  }),
  ts: port(z.string().optional(), {
    label: 'Timestamp',
  }),
  error: port(z.string().optional(), {
    label: 'Error',
  }),
});

/**
 * Recursively flatten nested plain objects so that all leaf values
 * are available as top-level keys.  For example:
 *   { summary: { totalFindings: 5, severityCounts: { critical: 1 } } }
 * becomes:
 *   { summary: {...}, totalFindings: 5, severityCounts: {...}, critical: 1 }
 *
 * Later keys win when there are collisions, which gives inner objects
 * higher specificity than outer ones (desirable for templates).
 */
function flattenObject(
  obj: Record<string, any>,
  result: Record<string, any> = {},
): Record<string, any> {
  for (const [key, value] of Object.entries(obj)) {
    result[key] = value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value as Record<string, any>, result);
    }
  }
  return result;
}

/**
 * Simple helper to replace {{var}} placeholders in a string
 */
function interpolate(template: string, vars: Record<string, any>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return vars[key] !== undefined ? String(vars[key]) : match;
  });
}

const mapTypeToSchema = (
  type: string,
  label: string,
): { schema: z.ZodTypeAny; meta?: PortMeta } => {
  switch (type) {
    case 'string':
      return { schema: z.string().optional(), meta: { label } };
    case 'number':
      return { schema: z.number().optional(), meta: { label } };
    case 'boolean':
      return { schema: z.boolean().optional(), meta: { label } };
    case 'secret':
      return {
        schema: z.unknown().optional(),
        meta: {
          label,
          editor: 'secret',
          allowAny: true,
          reason: 'Slack templates can include secret values.',
          connectionType: { kind: 'primitive', name: 'secret' },
        },
      };
    case 'list':
      return { schema: z.array(z.string()).optional(), meta: { label } };
    default:
      return {
        schema: z.unknown().optional(),
        meta: {
          label,
          allowAny: true,
          reason: 'Slack templates can include arbitrary JSON values.',
          connectionType: { kind: 'primitive', name: 'json' },
        },
      };
  }
};

// Retry policy optimized for Slack API rate limits
const slackRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 5,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['AuthenticationError', 'ConfigurationError', 'ValidationError'],
};

// ---------------------------------------------------------------------------
// Execution helpers (one per auth mode)
// ---------------------------------------------------------------------------

async function executeWebhook(
  body: any,
  webhookUrl: unknown,
  context: any,
): Promise<z.infer<typeof outputSchema>> {
  if (!webhookUrl) {
    throw new ConfigurationError('Slack Webhook URL is required.', {
      configKey: 'webhookUrl',
    });
  }
  const url = typeof webhookUrl === 'string' ? webhookUrl : String(webhookUrl);
  const response = await context.http.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const responseBody = await response.text();
    throw fromHttpResponse(response, responseBody);
  }
  return outputSchema.parse({ ok: true });
}

async function executeBotToken(
  body: any,
  slackToken: unknown,
  channel: unknown,
  thread_ts: unknown,
  context: any,
): Promise<z.infer<typeof outputSchema>> {
  if (!slackToken) {
    throw new ConfigurationError('Slack token missing.', {
      configKey: 'slackToken',
    });
  }
  body.channel = channel;
  body.thread_ts = thread_ts;

  const token = typeof slackToken === 'string' ? slackToken : String(slackToken);
  const response = await context.http.fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const result = (await response.json()) as any;
  if (!result.ok) {
    if (result.error === 'invalid_auth' || result.error === 'token_revoked') {
      throw new AuthenticationError(`Slack authentication failed: ${result.error}`);
    }
    return outputSchema.parse({ ok: false, error: result.error });
  }
  return outputSchema.parse({ ok: true, ts: result.ts });
}

async function executeWithCredentials(
  body: any,
  credentials: unknown,
  channel: unknown,
  thread_ts: unknown,
  context: any,
): Promise<z.infer<typeof outputSchema>> {
  if (!credentials || typeof credentials !== 'object') {
    throw new ConfigurationError(
      'Credentials are required. Wire the "Credentials Data" output from an Integration Credential Resolver.',
      { configKey: 'credentials' },
    );
  }

  const creds = credentials as Record<string, unknown>;

  // Auto-detect credential type from the resolved data shape
  if ('accessToken' in creds && creds.accessToken) {
    // OAuth bot token — delegate to the bot token flow
    context.logger.info('[Slack] Using OAuth bot token from resolved credentials');
    if (!channel) {
      throw new ConfigurationError(
        'Channel is required when using OAuth credentials. Set it as an input override or wire it from an upstream node.',
        { configKey: 'channel' },
      );
    }
    return executeBotToken(body, creds.accessToken, channel, thread_ts, context);
  }

  if ('webhookUrl' in creds && creds.webhookUrl) {
    // Webhook URL — delegate to the webhook flow
    context.logger.info('[Slack] Using webhook URL from resolved credentials');
    return executeWebhook(body, creds.webhookUrl, context);
  }

  throw new ConfigurationError(
    'Unrecognized credential format. Expected credentials with "accessToken" (OAuth) or "webhookUrl" (webhook).',
    { configKey: 'credentials' },
  );
}

const definition = defineComponent({
  id: 'core.notification.slack',
  label: 'Slack Message',
  category: 'notification',
  runner: { kind: 'inline' },
  retryPolicy: slackRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Send dynamic Slack messages with {{variable}} support in both text and Block Kit JSON.',
  ui: {
    slug: 'slack-message',
    version: '1.3.0',
    type: 'output',
    category: 'notification',
    description: 'Send plain text or rich Block Kit messages with dynamic template support.',
    icon: 'Slack',
    author: { name: 'ShipSecAI', type: 'shipsecai' },
    isLatest: true,
    deprecated: false,
  },
  resolvePorts(params: z.infer<typeof parameterSchema>) {
    const inputShape: Record<string, z.ZodTypeAny> = {
      text: port(z.string(), { label: 'Message Text' }),
      blocks: port(z.unknown().optional(), {
        label: 'Blocks (JSON)',
        allowAny: true,
        reason: 'Slack blocks can be raw JSON or string templates.',
        connectionType: { kind: 'primitive', name: 'json' },
      }),
    };

    // Auth specific inputs
    if (params.authType === 'webhook') {
      inputShape.webhookUrl = port(z.unknown(), {
        label: 'Webhook URL',
        editor: 'secret',
        allowAny: true,
        reason: 'Webhook URLs are secrets.',
        connectionType: { kind: 'primitive', name: 'secret' },
      });
    } else if (params.authType === 'credentials') {
      inputShape.credentials = port(z.record(z.string(), z.unknown()), {
        label: 'Credentials',
        description:
          'Resolved credentials from the Integration Credential Resolver. Accepts OAuth (bot token) or webhook credentials.',
        allowAny: true,
        reason: 'Credential payloads vary by provider and credential type.',
        editor: 'secret',
        connectionType: { kind: 'any' },
      });
      inputShape.channel = port(z.string().optional(), {
        label: 'Channel',
        description:
          'Slack channel ID or name. Required when credentials resolve to an OAuth bot token.',
      });
      inputShape.thread_ts = port(z.string().optional(), { label: 'Thread TS' });
    } else {
      inputShape.slackToken = port(z.unknown(), {
        label: 'Bot Token',
        editor: 'secret',
        allowAny: true,
        reason: 'Slack bot tokens are secrets.',
        connectionType: { kind: 'primitive', name: 'secret' },
      });
      inputShape.channel = port(z.string(), { label: 'Channel' });
      inputShape.thread_ts = port(z.string().optional(), { label: 'Thread TS' });
    }

    // Dynamic variable inputs
    if (params.variables && Array.isArray(params.variables)) {
      for (const v of params.variables) {
        if (!v || !v.name) continue;
        const { schema, meta } = mapTypeToSchema(v.type || 'json', v.name);
        inputShape[v.name] = port(schema, meta ?? { label: v.name });
      }
    }

    return { inputs: inputs(inputShape) };
  },
  async execute({ inputs, params }, context) {
    const { text, blocks, channel, thread_ts, slackToken, webhookUrl, credentials } =
      inputs as Record<string, unknown>;
    const { authType } = params;
    // Include execution context metadata so templates can use {{runId}}, {{workflowId}}, etc.
    const contextData = flattenObject({
      ...params,
      ...inputs,
      runId: context.runId,
      workflowId: context.workflowId ?? '',
      workflowName: context.workflowName ?? '',
    });

    // 1. Interpolate text
    const finalText = interpolate(text as string, contextData);

    // 2. Interpolate and parse blocks if it's a template string
    let finalBlocks = blocks;
    if (typeof blocks === 'string') {
      try {
        const interpolated = interpolate(blocks, contextData);
        finalBlocks = JSON.parse(interpolated);
      } catch (_e) {
        context.logger.warn(
          '[Slack] Failed to parse blocks JSON after interpolation, sending as raw string',
        );
        finalBlocks = undefined;
      }
    } else if (Array.isArray(blocks)) {
      const str = JSON.stringify(blocks);
      const interpolated = interpolate(str, contextData);
      finalBlocks = JSON.parse(interpolated);
    }

    context.logger.info(`[Slack] Sending message via ${authType}...`);

    const body: any = {
      text: finalText,
      blocks: finalBlocks,
    };

    // 3. Dispatch based on auth type
    if (authType === 'credentials') {
      return executeWithCredentials(body, credentials, channel, thread_ts, context);
    } else if (authType === 'webhook') {
      return executeWebhook(body, webhookUrl, context);
    } else {
      return executeBotToken(body, slackToken, channel, thread_ts, context);
    }
  },
});

componentRegistry.register(definition);

export { definition };

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
  authType: param(z.enum(['bot_token', 'webhook']).default('bot_token'), {
    label: 'Connection Method',
    editor: 'select',
    options: [
      { label: 'Slack App (Bot Token)', value: 'bot_token' },
      { label: 'Incoming Webhook', value: 'webhook' },
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
    version: '1.2.0',
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
    const { text, blocks, channel, thread_ts, slackToken, webhookUrl } = inputs as Record<
      string,
      unknown
    >;
    const { authType } = params;
    const contextData = { ...params, ...inputs };

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
      // If it's already an object, we'd need a deep interpolation,
      // but typically users will pass a JSON string template for simplicity.
      // For now, let's stringify and interpolate to support variables in objects too!
      const str = JSON.stringify(blocks);
      const interpolated = interpolate(str, contextData);
      finalBlocks = JSON.parse(interpolated);
    }

    context.logger.info(`[Slack] Sending message to ${authType}...`);

    const body: any = {
      text: finalText,
      blocks: finalBlocks,
    };

    if (authType === 'webhook') {
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
    } else {
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
        // Slack API returns ok: false with an error code
        // Check for common auth errors
        if (result.error === 'invalid_auth' || result.error === 'token_revoked') {
          throw new AuthenticationError(`Slack authentication failed: ${result.error}`);
        }
        return outputSchema.parse({ ok: false, error: result.error });
      }
      return outputSchema.parse({ ok: true, ts: result.ts });
    }
  },
});

componentRegistry.register(definition);

export { definition };

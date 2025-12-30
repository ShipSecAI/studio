import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  ConfigurationError,
  fromHttpResponse,
  AuthenticationError,
  ComponentRetryPolicy,
} from '@shipsec/component-sdk';

const inputSchema = z.object({
  // Content
  text: z.string().describe('The plain text message or template.'),
  blocks: z.union([z.string(), z.array(z.record(z.string(), z.any()))]).optional().describe('Slack Block Kit template (JSON string) or object.'),
  
  // Addressing
  channel: z.string().optional().describe('Channel ID or name.'),
  thread_ts: z.string().optional().describe('Thread timestamp for replies.'),
  
  // Auth
  authType: z.enum(['bot_token', 'webhook']).default('bot_token'),
  slackToken: z.string().optional(),
  webhookUrl: z.string().optional(),

  // Dynamic values will be injected here by resolvePorts
}).catchall(z.any());

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  ok: z.boolean(),
  ts: z.string().optional(),
  error: z.string().optional(),
});

type Output = z.infer<typeof outputSchema>;

type Params = {
  authType?: 'bot_token' | 'webhook';
  variables?: { name: string; type: string }[];
};

/**
 * Simple helper to replace {{var}} placeholders in a string
 */
function interpolate(template: string, vars: Record<string, any>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return vars[key] !== undefined ? String(vars[key]) : match;
  });
}

const mapTypeToPort = (type: string, id: string, label: string) => {
    switch (type) {
      case 'string': return { id, label, dataType: port.text(), required: false };
      case 'number': return { id, label, dataType: port.number(), required: false };
      case 'boolean': return { id, label, dataType: port.boolean(), required: false };
      case 'secret': return { id, label, dataType: port.secret(), required: false };
      case 'list': return { id, label, dataType: port.list(port.text()), required: false };
      default: return { id, label, dataType: port.any(), required: false };
    }
  };

// Retry policy optimized for Slack API rate limits
const slackRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 5,
  initialIntervalSeconds: 2,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: [
    'AuthenticationError',
    'ConfigurationError',
    'ValidationError',
  ],
};

const definition: ComponentDefinition<Input, Output, Params> = {
  id: 'core.notification.slack',
  label: 'Slack Message',
  category: 'notification',
  runner: { kind: 'inline' },
  retryPolicy: slackRetryPolicy,
  inputSchema,
  outputSchema,
  docs: 'Send dynamic Slack messages with {{variable}} support in both text and Block Kit JSON.',
  metadata: {
    slug: 'slack-message',
    version: '1.2.0',
    type: 'output',
    category: 'notification',
    description: 'Send plain text or rich Block Kit messages with dynamic template support.',
    icon: 'Slack',
    author: { name: 'ShipSecAI', type: 'shipsecai' },
    isLatest: true,
    deprecated: false,
    inputs: [
      { id: 'text', label: 'Message Text', dataType: port.text(), required: true },
    ],
    parameters: [
      {
        id: 'authType',
        label: 'Connection Method',
        type: 'select',
        default: 'bot_token',
        options: [
          { label: 'Slack App (Bot Token)', value: 'bot_token' },
          { label: 'Incoming Webhook', value: 'webhook' },
        ],
      },
      {
        id: 'variables',
        label: 'Template Variables',
        type: 'variable-list',
        default: [],
        description: 'Define variables to use as {{name}} in your message.',
      }
    ],
  },
  resolvePorts(params) {
    const inputs: any[] = [
      { id: 'text', label: 'Message Text', dataType: port.text(), required: true },
      { id: 'blocks', label: 'Blocks (JSON)', dataType: port.json(), required: false },
    ];

    // Auth specific inputs
    if (params.authType === 'webhook') {
        inputs.push({ id: 'webhookUrl', label: 'Webhook URL', dataType: port.secret(), required: true });
    } else {
        inputs.push(
            { id: 'slackToken', label: 'Bot Token', dataType: port.secret(), required: true },
            { id: 'channel', label: 'Channel', dataType: port.text(), required: true },
            { id: 'thread_ts', label: 'Thread TS', dataType: port.text(), required: false }
        );
    }

    // Dynamic variable inputs
    if (params.variables && Array.isArray(params.variables)) {
      for (const v of params.variables) {
        if (!v || !v.name) continue;
        inputs.push(mapTypeToPort(v.type || 'json', v.name, v.name));
      }
    }

    return { inputs };
  },
  async execute(params, context) {
    const { 
        text, 
        blocks, 
        channel, 
        thread_ts, 
        authType, 
        slackToken, 
        webhookUrl,
        ...rest 
    } = params;

    // 1. Interpolate text
    const finalText = interpolate(text, rest);

    // 2. Interpolate and parse blocks if it's a template string
    let finalBlocks = blocks;
    if (typeof blocks === 'string') {
        try {
            const interpolated = interpolate(blocks, rest);
            finalBlocks = JSON.parse(interpolated);
        } catch (e) {
            context.logger.warn('[Slack] Failed to parse blocks JSON after interpolation, sending as raw string');
            finalBlocks = undefined;
        }
    } else if (Array.isArray(blocks)) {
        // If it's already an object, we'd need a deep interpolation, 
        // but typically users will pass a JSON string template for simplicity.
        // For now, let's stringify and interpolate to support variables in objects too!
        const str = JSON.stringify(blocks);
        const interpolated = interpolate(str, rest);
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
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const responseBody = await response.text();
        throw fromHttpResponse(response, responseBody);
      }
      return { ok: true };
    } else {
      if (!slackToken) {
        throw new ConfigurationError('Slack token missing.', {
          configKey: 'slackToken',
        });
      }
      body.channel = channel;
      body.thread_ts = thread_ts;

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${slackToken}`,
        },
        body: JSON.stringify(body),
      });

      const result = await response.json() as any;
      if (!result.ok) {
        // Slack API returns ok: false with an error code
        // Check for common auth errors
        if (result.error === 'invalid_auth' || result.error === 'token_revoked') {
          throw new AuthenticationError(`Slack authentication failed: ${result.error}`);
        }
        return { ok: false, error: result.error };
      }
      return { ok: true, ts: result.ts };
    }
  },
};

componentRegistry.register(definition);

export { definition };

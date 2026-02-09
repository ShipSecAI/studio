import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  runComponentWithRunner,
  ConfigurationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';

const inputSchema = inputs({
  messages: port(
    z
      .array(z.string().min(1, 'Message cannot be empty'))
      .min(1, 'Provide at least one message to send')
      .describe(
        'Messages to deliver through ProjectDiscovery notify. Each message is treated as a separate line.',
      ),
    {
      label: 'Messages',
      description: 'Messages to send through notify.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
  providerConfig: port(
    z
      .string()
      .min(1, 'Provider configuration is required')
      .optional()
      .describe(
        'YAML provider configuration content used by notify to reach third-party services.',
      ),
    {
      label: 'Provider Config',
      description: 'Provider configuration YAML content (base64-encoded when supplied as a file).',
    },
  ),
  notifyConfig: port(
    z
      .string()
      .trim()
      .min(1, 'Notify configuration cannot be empty')
      .optional()
      .describe(
        'Optional notify CLI configuration file (YAML) providing defaults such as delay or rate limit.',
      ),
    {
      label: 'Notify Config',
      description: 'Optional notify configuration YAML (base64-encoded when supplied as a file).',
    },
  ),
  recipientIds: port(
    z
      .array(z.string().min(1, 'Recipient id cannot be empty'))
      .optional()
      .describe(
        'Restrict delivery to specific recipient identifiers defined under the providers configuration.',
      ),
    {
      label: 'Recipient IDs',
      description: 'Optional recipient identifiers to target within configured providers.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const parameterSchema = parameters({
  providerIds: param(
    z
      .array(z.string().min(1, 'Provider id cannot be empty'))
      .optional()
      .describe('Restrict delivery to specific providers defined in the provider configuration.'),
    {
      label: 'Notification Providers',
      editor: 'multi-select',
      description:
        'Select which notification providers to use. Make sure they are configured in your provider config.',
      helpText: 'If not specified, all configured providers will be used.',
      options: [
        { label: 'Telegram', value: 'telegram' },
        { label: 'Slack', value: 'slack' },
        { label: 'Discord', value: 'discord' },
        { label: 'Microsoft Teams', value: 'teams' },
        { label: 'Email', value: 'email' },
        { label: 'Pushover', value: 'pushover' },
        { label: 'Custom', value: 'custom' },
      ],
    },
  ),
  messageFormat: param(
    z
      .string()
      .trim()
      .min(1, 'Message format cannot be empty')
      .optional()
      .describe('Custom notify message template (e.g. "Finding: {{data}}").'),
    {
      label: 'Message Format Template',
      editor: 'text',
      placeholder: '{{data}}',
      description: 'Custom template for formatting messages. Use {{data}} as a placeholder.',
      helpText: 'Example: "Finding: {{data}}" or "Alert: {{data}}"',
    },
  ),
  bulk: param(
    z.boolean().optional().default(true).describe('Send all messages as a single bulk payload.'),
    {
      label: 'Bulk Mode',
      editor: 'boolean',
      description: 'Send all messages as a single bulk payload.',
    },
  ),
  silent: param(
    z
      .boolean()
      .optional()
      .default(true)
      .describe('Enable notify silent mode to suppress CLI output.'),
    {
      label: 'Silent Mode',
      editor: 'boolean',
      description: 'Suppress notify CLI output.',
    },
  ),
  verbose: param(
    z.boolean().optional().default(false).describe('Enable verbose logging from notify.'),
    {
      label: 'Verbose Logging',
      editor: 'boolean',
      description: 'Enable detailed logging from the notify tool.',
    },
  ),
  charLimit: param(
    z
      .number()
      .int()
      .positive()
      .max(20000)
      .optional()
      .describe('Maximum character count per message.'),
    {
      label: 'Character Limit',
      editor: 'number',
      description: 'Maximum character count per message.',
    },
  ),
  delaySeconds: param(
    z
      .number()
      .int()
      .min(0)
      .max(3600)
      .optional()
      .describe('Delay in seconds between each notification batch.'),
    {
      label: 'Delay (seconds)',
      editor: 'number',
      description: 'Delay between each notification batch.',
    },
  ),
  rateLimit: param(
    z
      .number()
      .int()
      .min(1)
      .max(120)
      .optional()
      .describe('Maximum number of HTTP requests notify should emit per second.'),
    {
      label: 'Rate Limit',
      editor: 'number',
      description: 'Maximum number of HTTP requests per second.',
    },
  ),
  proxy: param(
    z
      .string()
      .trim()
      .min(1, 'Proxy URL cannot be empty')
      .optional()
      .describe('HTTP or SOCKSv5 proxy URL for outbound notify requests.'),
    {
      label: 'Proxy',
      editor: 'text',
      description: 'HTTP or SOCKSv5 proxy URL for outbound notify requests.',
    },
  ),
});

const outputSchema = outputs({
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw notify output for debugging.',
  }),
});

const dockerTimeoutSeconds = (() => {
  const raw = process.env.NOTIFY_TIMEOUT_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return 120;
  }
  return parsed;
})();

const definition = defineComponent({
  id: 'shipsec.notify.dispatch',
  label: 'ProjectDiscovery Notify',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'ghcr.io/shipsecai/notify:v1.0.7',
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: dockerTimeoutSeconds,
    env: {
      HOME: '/root',
    },
    command: [
      '-c',
      String.raw`set -euo pipefail

INPUT=$(cat)

# Extract fields from JSON using jq if available, fallback to sed
if command -v jq >/dev/null 2>&1; then
  MESSAGES=$(printf "%s" "$INPUT" | jq -r '.messages // ""')
  PROVIDER_CONFIG=$(printf "%s" "$INPUT" | jq -r '.providerConfig // ""')
  NOTIFY_CONFIG=$(printf "%s" "$INPUT" | jq -r '.notifyConfig // ""')
else
  MESSAGES=$(printf "%s" "$INPUT" | sed -n 's/.*"messages":"\([^"]*\)".*/\1/p')
  PROVIDER_CONFIG=$(printf "%s" "$INPUT" | sed -n 's/.*"providerConfig":"\([^"]*\)".*/\1/p')
  NOTIFY_CONFIG=$(printf "%s" "$INPUT" | sed -n 's/.*"notifyConfig":"\([^"]*\)".*/\1/p')
fi

# Validate required fields
if [ -z "$PROVIDER_CONFIG" ]; then
  echo "Provider configuration is required" >&2
  exit 1
fi

# Create temporary files for configs and messages
PROVIDER_CONFIG_FILE=$(mktemp)
MESSAGE_FILE=$(mktemp)
NOTIFY_CONFIG_FILE=""

if [ -n "$NOTIFY_CONFIG" ]; then
  NOTIFY_CONFIG_FILE=$(mktemp)
fi

trap 'rm -f "$PROVIDER_CONFIG_FILE" "$MESSAGE_FILE" "$NOTIFY_CONFIG_FILE"' EXIT

# Write provider config to temp file
printf "%s" "$PROVIDER_CONFIG" | base64 -d > "$PROVIDER_CONFIG_FILE"

# Write notify config to temp file if provided
if [ -n "$NOTIFY_CONFIG" ]; then
  printf "%s" "$NOTIFY_CONFIG" | base64 -d > "$NOTIFY_CONFIG_FILE"
fi

# Write messages to temp file
printf "%s" "$MESSAGES" | base64 -d > "$MESSAGE_FILE"

# Build command from args array
if command -v jq >/dev/null 2>&1; then
  ARGS=$(printf "%s" "$INPUT" | jq -r '.args[]' 2>/dev/null || echo "")
else
  ARGS_JSON=$(printf "%s" "$INPUT" | sed -n 's/.*"args":\[\([^]]*\)\].*/\1/p')
  ARGS=$(printf "%s" "$ARGS_JSON" | tr ',' '\n' | sed 's/^"//; s/"$//' | grep -v '^$')
fi

# Build command with provider config
set -- notify -provider-config "$PROVIDER_CONFIG_FILE"

# Add notify config if provided
if [ -n "$NOTIFY_CONFIG_FILE" ]; then
  set -- "$@" -config "$NOTIFY_CONFIG_FILE"
fi

# Add arguments from TypeScript
while IFS= read -r arg; do
  [ -n "$arg" ] && set -- "$@" "$arg"
done << EOF
$ARGS
EOF

# Execute notify
cat "$MESSAGE_FILE" | "$@"
`,
    ],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Sends notifications using ProjectDiscovery notify with a provided provider configuration.',
  retryPolicy: {
    maxAttempts: 3,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
  } satisfies ComponentRetryPolicy,
  ui: {
    slug: 'notify',
    version: '1.0.0',
    type: 'output',
    category: 'security',
    description:
      'Deliver security findings to Slack, Teams, and other channels using ProjectDiscovery notify.',
    documentation:
      'Configure provider credentials via YAML then stream workflow output to notify for alerting.',
    documentationUrl: 'https://github.com/projectdiscovery/notify',
    icon: 'Bell',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`echo "Critical finding" | notify -bulk` — Broadcast a message to configured providers.',
    examples: [
      'Forward a consolidated reconnaissance summary to Slack and Telegram.',
      'Send high-priority vulnerability findings to multiple notification channels in bulk.',
    ],
  },
  async execute({ inputs, params }, context) {
    // Validate that providerConfig is provided
    if (!inputs.providerConfig || inputs.providerConfig.trim() === '') {
      throw new ConfigurationError(
        'Provider configuration is required. Please provide it via the Provider Config input.',
        { configKey: 'providerConfig' },
      );
    }

    const { messages, recipientIds, providerConfig, notifyConfig } = inputs;
    const { providerIds } = params;

    context.logger.info(
      `[Notify] Sending ${messages.length} message(s) via ${providerIds && providerIds.length > 0 ? providerIds.join(', ') : 'all configured providers'}`,
    );
    context.emitProgress(
      `Sending ${messages.length} notification${messages.length > 1 ? 's' : ''}`,
    );

    // Build notify command arguments (all logic in TypeScript!)
    // Note: Config file paths will be added by bash script using temp files
    const args: string[] = [];

    // Boolean flags
    if (params.bulk ?? true) {
      args.push('-bulk');
    }

    // Verbose and silent are mutually exclusive - verbose takes precedence
    if (params.verbose ?? false) {
      args.push('-verbose');
    } else if (params.silent ?? true) {
      args.push('-silent');
    }

    // Numeric options
    if (params.charLimit != null) {
      args.push('-char-limit', String(params.charLimit));
    }
    if (params.delaySeconds != null) {
      args.push('-delay', String(params.delaySeconds));
    }
    if (params.rateLimit != null) {
      args.push('-rate-limit', String(params.rateLimit));
    }

    // String options
    if (params.proxy) {
      args.push('-proxy', params.proxy);
    }
    if (params.messageFormat) {
      args.push('-msg-format', params.messageFormat);
    }

    // Provider and recipient filtering
    if (providerIds && providerIds.length > 0) {
      args.push('-provider', providerIds.join(','));
    }
    if (recipientIds && recipientIds.length > 0) {
      args.push('-id', recipientIds.join(','));
    }

    // Build docker payload (minimal, just data for bash)
    const dockerPayload = {
      messages: Buffer.from(messages.join('\n'), 'utf8').toString('base64'),
      providerConfig: Buffer.from(providerConfig, 'utf8').toString('base64'),
      notifyConfig: notifyConfig ? Buffer.from(notifyConfig, 'utf8').toString('base64') : '',
      args, // TypeScript-built command arguments!
    };

    // Execute notify via Docker
    const rawResult = await runComponentWithRunner<typeof dockerPayload, string>(
      this.runner,
      async () => '',
      dockerPayload,
      context,
    );

    // Return raw output
    const rawOutput = typeof rawResult === 'string' ? rawResult.trim() : '';

    context.logger.info(`[Notify] Notifications sent successfully`);

    return {
      rawOutput,
    };
  },
});

componentRegistry.register(definition);

// Create local type aliases for backward compatibility
type Input = typeof inputSchema;
type Output = typeof outputSchema;

export type { Input as NotifyInput, Output as NotifyOutput };

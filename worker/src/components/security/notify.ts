import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  ComponentRetryPolicy,
  port,
  runComponentWithRunner,
  ConfigurationError,
} from '@shipsec/component-sdk';

const inputSchema = z.object({
  messages: z
    .array(z.string().min(1, 'Message cannot be empty'))
    .min(1, 'Provide at least one message to send')
    .describe('Messages to deliver through ProjectDiscovery notify. Each message is treated as a separate line.'),
  providerConfig: z
    .string()
    .min(1, 'Provider configuration is required')
    .optional()
    .describe('YAML provider configuration content used by notify to reach third-party services.'),
  notifyConfig: z
    .string()
    .trim()
    .min(1, 'Notify configuration cannot be empty')
    .optional()
    .describe('Optional notify CLI configuration file (YAML) providing defaults such as delay or rate limit.'),
  providerIds: z
    .array(z.string().min(1, 'Provider id cannot be empty'))
    .optional()
    .describe('Restrict delivery to specific providers defined in the provider configuration.'),
  recipientIds: z
    .array(z.string().min(1, 'Recipient id cannot be empty'))
    .optional()
    .describe('Restrict delivery to specific recipient identifiers defined under the providers configuration.'),
  messageFormat: z
    .string()
    .trim()
    .min(1, 'Message format cannot be empty')
    .optional()
    .describe('Custom notify message template (e.g. "Finding: {{data}}").'),
  bulk: z
    .boolean()
    .optional()
    .default(true)
    .describe('Send all messages as a single bulk payload.'),
  silent: z
    .boolean()
    .optional()
    .default(true)
    .describe('Enable notify silent mode to suppress CLI output.'),
  verbose: z
    .boolean()
    .optional()
    .default(false)
    .describe('Enable verbose logging from notify.'),
  charLimit: z
    .number()
    .int()
    .positive()
    .max(20000)
    .optional()
    .describe('Maximum character count per message.'),
  delaySeconds: z
    .number()
    .int()
    .min(0)
    .max(3600)
    .optional()
    .describe('Delay in seconds between each notification batch.'),
  rateLimit: z
    .number()
    .int()
    .min(1)
    .max(120)
    .optional()
    .describe('Maximum number of HTTP requests notify should emit per second.'),
  proxy: z
    .string()
    .trim()
    .min(1, 'Proxy URL cannot be empty')
    .optional()
    .describe('HTTP or SOCKSv5 proxy URL for outbound notify requests.'),
});

const outputSchema = z.object({
  rawOutput: z.string(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

const dockerTimeoutSeconds = (() => {
  const raw = process.env.NOTIFY_TIMEOUT_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return 120;
  }
  return parsed;
})();

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.notify.dispatch',
  label: 'ProjectDiscovery Notify',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'projectdiscovery/notify:v1.0.7',
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
  inputSchema,
  outputSchema,
  docs: 'Sends notifications using ProjectDiscovery notify with a provided provider configuration.',
  retryPolicy: {
    maxAttempts: 3,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
  } satisfies ComponentRetryPolicy,
  metadata: {
    slug: 'notify',
    version: '1.0.0',
    type: 'output',
    category: 'security',
    description: 'Deliver security findings to Slack, Teams, and other channels using ProjectDiscovery notify.',
    documentation: 'Configure provider credentials via YAML then stream workflow output to notify for alerting.',
    documentationUrl: 'https://github.com/projectdiscovery/notify',
    icon: 'Bell',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: '`echo "Critical finding" | notify -bulk` — Broadcast a message to configured providers.',
    inputs: [
      {
        id: 'messages',
        label: 'Messages',
        dataType: port.list(port.text()),
        required: true,
        description: 'Array of messages that notify should deliver.',
      },
      {
        id: 'providerConfig',
        label: 'Provider Configuration',
        dataType: port.text({ coerceFrom: [] }),
        required: true,
        description: 'YAML defining provider credentials and channels (plain text YAML content).',
      },
    ],
    outputs: [
      {
        id: 'rawOutput',
        label: 'Raw Output',
        dataType: port.text(),
        description: 'Raw CLI output returned by notify.',
      },
    ],
    examples: [
      'Forward a consolidated reconnaissance summary to Slack and Telegram.',
      'Send high-priority vulnerability findings to multiple notification channels in bulk.',
    ],
    parameters: [
      {
        id: 'providerIds',
        label: 'Notification Providers',
        type: 'multi-select',
        required: false,
        description: 'Select which notification providers to use. Make sure they are configured in your provider config.',
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
      {
        id: 'providerConfig',
        label: 'Provider Configuration (YAML)',
        type: 'textarea',
        required: false,
        rows: 8,
        placeholder: `telegram:
  - id: "telegram"
    telegram_api_key: "YOUR_BOT_TOKEN"
    telegram_chat_id: "YOUR_CHAT_ID"`,
        description: 'YAML configuration for your notification providers. Include API keys and channel/chat IDs here.',
        helpText: 'You can also connect this from another component output.',
      },
      {
        id: 'messageFormat',
        label: 'Message Format Template',
        type: 'text',
        required: false,
        placeholder: '{{data}}',
        description: 'Custom template for formatting messages. Use {{data}} as a placeholder.',
        helpText: 'Example: "Finding: {{data}}" or "Alert: {{data}}"',
      },
      {
        id: 'verbose',
        label: 'Verbose Logging',
        type: 'boolean',
        required: false,
        default: false,
        description: 'Enable detailed logging from the notify tool.',
      },
    ],
  },
  async execute(input, context) {
    // Validate that providerConfig is provided
    if (!input.providerConfig || input.providerConfig.trim() === '') {
      throw new ConfigurationError(
        'Provider configuration is required. Please provide it via the parameter field or as an input.',
        { configKey: 'providerConfig' },
      );
    }

    const { messages, providerIds, recipientIds } = input;

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
    if (input.bulk ?? true) {
      args.push('-bulk');
    }

    // Verbose and silent are mutually exclusive - verbose takes precedence
    if (input.verbose ?? false) {
      args.push('-verbose');
    } else if (input.silent ?? true) {
      args.push('-silent');
    }

    // Numeric options
    if (input.charLimit != null) {
      args.push('-char-limit', String(input.charLimit));
    }
    if (input.delaySeconds != null) {
      args.push('-delay', String(input.delaySeconds));
    }
    if (input.rateLimit != null) {
      args.push('-rate-limit', String(input.rateLimit));
    }

    // String options
    if (input.proxy) {
      args.push('-proxy', input.proxy);
    }
    if (input.messageFormat) {
      args.push('-msg-format', input.messageFormat);
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
      providerConfig: Buffer.from(input.providerConfig, 'utf8').toString('base64'),
      notifyConfig: input.notifyConfig
        ? Buffer.from(input.notifyConfig, 'utf8').toString('base64')
        : '',
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
};

componentRegistry.register(definition);

export type { Input as NotifyInput, Output as NotifyOutput };

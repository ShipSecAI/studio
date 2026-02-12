import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  runComponentWithRunner,
  ConfigurationError,
  ContainerError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  type DockerRunnerConfig,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const NOTIFY_IMAGE = 'ghcr.io/shipsecai/notify:v1.0.7';
const INPUT_MOUNT_NAME = 'inputs';
const CONTAINER_INPUT_DIR = `/${INPUT_MOUNT_NAME}`;
const MESSAGES_FILE_NAME = 'messages.txt';
const PROVIDER_CONFIG_FILE_NAME = 'provider-config.yaml';
const NOTIFY_CONFIG_FILE_NAME = 'notify-config.yaml';

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

interface BuildNotifyArgsOptions {
  messagesFile: string;
  providerConfigFile: string;
  notifyConfigFile?: string;
  providerIds?: string[];
  recipientIds?: string[];
  messageFormat?: string;
  bulk: boolean;
  silent: boolean;
  verbose: boolean;
  charLimit?: number;
  delaySeconds?: number;
  rateLimit?: number;
  proxy?: string;
}

/**
 * Build Notify CLI arguments in TypeScript.
 * Follows the Dynamic Args Pattern from component-development.mdx
 */
const buildNotifyArgs = (options: BuildNotifyArgsOptions): string[] => {
  const args: string[] = [];

  // Input file (messages) — uses -i flag instead of stdin piping
  args.push('-i', options.messagesFile);

  // Provider config (required)
  args.push('-provider-config', options.providerConfigFile);

  // Optional notify config
  if (options.notifyConfigFile) {
    args.push('-config', options.notifyConfigFile);
  }

  // Boolean flags
  if (options.bulk) {
    args.push('-bulk');
  }

  // Verbose and silent are mutually exclusive — verbose takes precedence
  if (options.verbose) {
    args.push('-verbose');
  } else if (options.silent) {
    args.push('-silent');
  }

  // Numeric options
  if (options.charLimit != null) {
    args.push('-char-limit', String(options.charLimit));
  }
  if (options.delaySeconds != null) {
    args.push('-delay', String(options.delaySeconds));
  }
  if (options.rateLimit != null) {
    args.push('-rate-limit', String(options.rateLimit));
  }

  // String options
  if (options.proxy) {
    args.push('-proxy', options.proxy);
  }
  if (options.messageFormat) {
    args.push('-msg-format', options.messageFormat);
  }

  // Provider and recipient filtering
  if (options.providerIds && options.providerIds.length > 0) {
    args.push('-provider', options.providerIds.join(','));
  }
  if (options.recipientIds && options.recipientIds.length > 0) {
    args.push('-id', options.recipientIds.join(','));
  }

  return args;
};

const definition = defineComponent({
  id: 'shipsec.notify.dispatch',
  label: 'ProjectDiscovery Notify',
  category: 'security',
  runner: {
    kind: 'docker',
    image: NOTIFY_IMAGE,
    // The notify image is distroless (no shell available).
    // Use the image's default entrypoint directly and pass args via command.
    network: 'bridge',
    timeoutSeconds: dockerTimeoutSeconds,
    env: {
      // Image runs as nonroot — /root is not writable.
      // Use /tmp so notify can create its config dir.
      HOME: '/tmp',
    },
    command: [],
    stdinJson: false,
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
    const parsedParams = parameterSchema.parse(params);
    const { providerIds } = parsedParams;

    context.logger.info(
      `[Notify] Sending ${messages.length} message(s) via ${providerIds && providerIds.length > 0 ? providerIds.join(', ') : 'all configured providers'}`,
    );
    context.emitProgress(
      `Sending ${messages.length} notification${messages.length > 1 ? 's' : ''}`,
    );

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);
    const baseRunner = definition.runner;

    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Notify runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput: string;
    try {
      // Prepare input files for the volume
      const inputFiles: Record<string, string> = {
        [MESSAGES_FILE_NAME]: messages.join('\n'),
        [PROVIDER_CONFIG_FILE_NAME]: providerConfig,
      };

      // Add notify config file if provided
      if (notifyConfig && notifyConfig.trim().length > 0) {
        inputFiles[NOTIFY_CONFIG_FILE_NAME] = notifyConfig;
      }

      const volumeName = await volume.initialize(inputFiles);
      context.logger.info(`[Notify] Created isolated volume: ${volumeName}`);

      // Build notify CLI arguments in TypeScript
      const notifyArgs = buildNotifyArgs({
        messagesFile: `${CONTAINER_INPUT_DIR}/${MESSAGES_FILE_NAME}`,
        providerConfigFile: `${CONTAINER_INPUT_DIR}/${PROVIDER_CONFIG_FILE_NAME}`,
        notifyConfigFile:
          notifyConfig && notifyConfig.trim().length > 0
            ? `${CONTAINER_INPUT_DIR}/${NOTIFY_CONFIG_FILE_NAME}`
            : undefined,
        providerIds,
        recipientIds,
        messageFormat: parsedParams.messageFormat,
        bulk: parsedParams.bulk ?? true,
        silent: parsedParams.silent ?? true,
        verbose: parsedParams.verbose ?? false,
        charLimit: parsedParams.charLimit,
        delaySeconds: parsedParams.delaySeconds,
        rateLimit: parsedParams.rateLimit,
        proxy: parsedParams.proxy,
      });

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds ?? dockerTimeoutSeconds,
        env: { ...(baseRunner.env ?? {}) },
        stdinJson: false,
        // Pass notify CLI args directly (image default entrypoint is notify)
        command: [...(baseRunner.command ?? []), ...notifyArgs],
        volumes: [volume.getVolumeConfig(CONTAINER_INPUT_DIR, true)],
      };

      const result = await runComponentWithRunner<Record<string, never>, string>(
        runnerConfig,
        async () => '',
        {},
        context,
      );

      rawOutput = typeof result === 'string' ? result.trim() : '';
    } finally {
      await volume.cleanup();
      context.logger.info('[Notify] Cleaned up isolated volume');
    }

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

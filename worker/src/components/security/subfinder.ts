import { z } from 'zod';
import {
  componentRegistry,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ContainerError,
  ComponentRetryPolicy,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const SUBFINDER_IMAGE = 'ghcr.io/shipsecai/subfinder:v2.12.0';
const SUBFINDER_TIMEOUT_SECONDS = 1800; // 30 minutes
const INPUT_MOUNT_NAME = 'inputs';
const CONTAINER_INPUT_DIR = `/${INPUT_MOUNT_NAME}`;
const DOMAIN_FILE_NAME = 'domains.txt';
const PROVIDER_CONFIG_FILE_NAME = 'provider-config.yaml';

const domainValueSchema = z.preprocess(
  (val) => (typeof val === 'string' ? [val] : val),
  z.array(z.string().min(1)),
);

const inputSchema = inputs({
  domains: port(domainValueSchema.optional().describe('Array of target domains'), {
    label: 'Target Domains',
    description: 'Array of domain names to enumerate for subdomains.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  providerConfig: port(
    z
      .string()
      .optional()
      .describe('Resolved provider-config.yaml content (connect via Secret Loader)'),
    {
      label: 'Provider Config',
      description:
        'Connect the provider-config.yaml contents via a Secret Loader if authenticated sources are needed.',
      editor: 'secret',
      connectionType: { kind: 'primitive', name: 'secret' },
    },
  ),
});

const parameterSchema = parameters({
  domain: param(z.string().optional().describe('Legacy single domain input'), {
    label: 'Legacy Domain',
    editor: 'text',
    description: 'Legacy single-domain input (prefer Target Domains).',
    visibleWhen: { __legacy: true },
  }),
  threads: param(z.number().int().min(1).max(100).default(10), {
    label: 'Threads',
    editor: 'number',
    min: 1,
    max: 100,
    description: 'Number of concurrent threads for subdomain enumeration.',
  }),
  timeout: param(z.number().int().min(1).max(300).default(30), {
    label: 'Timeout (seconds)',
    editor: 'number',
    min: 1,
    max: 300,
    description: 'Timeout per source in seconds.',
  }),
  maxEnumerationTime: param(z.number().int().min(1).max(60).optional(), {
    label: 'Max Enumeration Time (minutes)',
    editor: 'number',
    min: 1,
    max: 60,
    description: 'Maximum enumeration time in minutes (optional).',
  }),
  rateLimit: param(z.number().int().min(1).max(1000).optional(), {
    label: 'Rate Limit',
    editor: 'number',
    min: 1,
    max: 1000,
    description: 'Maximum rate limit per source (requests per minute).',
  }),
  allSources: param(z.boolean().default(false), {
    label: 'Use All Sources',
    editor: 'boolean',
    description: 'Use all available sources (slow but comprehensive).',
  }),
  recursive: param(z.boolean().default(false), {
    label: 'Recursive Enumeration',
    editor: 'boolean',
    description: 'Enable recursive subdomain enumeration.',
  }),
  customFlags: param(
    z.string().trim().optional().describe('Raw CLI flags to append to the subfinder command'),
    {
      label: 'Custom CLI Flags',
      editor: 'textarea',
      rows: 3,
      placeholder: '-sources shodan,censys',
      description:
        'Paste additional subfinder CLI options exactly as you would on the command line.',
      helpText: 'Flags are appended after the generated options.',
    },
  ),
});

const outputSchema = outputs({
  subdomains: port(z.array(z.string()), {
    label: 'Discovered Subdomains',
    description: 'Array of all subdomain hostnames discovered.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw tool output for debugging.',
  }),
  domainCount: port(z.number(), {
    label: 'Domain Count',
    description: 'Number of domains scanned.',
  }),
  subdomainCount: port(z.number(), {
    label: 'Subdomain Count',
    description: 'Number of subdomains discovered.',
  }),
});

// Split custom CLI flags into an array of arguments
const splitCliArgs = (input: string): string[] => {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escape = false;

  for (const ch of input) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      escape = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch as '"' | "'";
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
};

interface BuildSubfinderArgsOptions {
  domainFile: string;
  providerConfigFile?: string;
  threads?: number;
  timeout?: number;
  maxEnumerationTime?: number;
  rateLimit?: number;
  allSources: boolean;
  recursive: boolean;
  customFlags: string[];
}

/**
 * Build Subfinder CLI arguments in TypeScript.
 * This follows the Dynamic Args Pattern recommended in component-development.md
 */
const buildSubfinderArgs = (options: BuildSubfinderArgsOptions): string[] => {
  const args: string[] = [];

  // Always use silent mode for clean output
  args.push('-silent');

  // Domain list file input
  args.push('-dL', options.domainFile);

  // Provider config file (if provided)
  if (options.providerConfigFile) {
    args.push('-pc', options.providerConfigFile);
  }

  // Thread count
  if (typeof options.threads === 'number' && options.threads >= 1) {
    args.push('-t', String(options.threads));
  }

  // Timeout per source
  if (typeof options.timeout === 'number' && options.timeout >= 1) {
    args.push('-timeout', String(options.timeout));
  }

  // Max enumeration time
  if (typeof options.maxEnumerationTime === 'number' && options.maxEnumerationTime >= 1) {
    args.push('-max-time', String(options.maxEnumerationTime));
  }

  // Rate limit
  if (typeof options.rateLimit === 'number' && options.rateLimit >= 1) {
    args.push('-rl', String(options.rateLimit));
  }

  // All sources
  if (options.allSources) {
    args.push('-all');
  }

  // Recursive enumeration
  if (options.recursive) {
    args.push('-recursive');
  }

  // Custom flags (appended last)
  for (const flag of options.customFlags) {
    if (flag.length > 0) {
      args.push(flag);
    }
  }

  return args;
};

// Retry policy for Subfinder - long-running discovery operations
const subfinderRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2, // Only retry once for expensive scans
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'shipsec.subfinder.run',
  label: 'Subfinder',
  category: 'security',
  retryPolicy: subfinderRetryPolicy,
  runner: {
    kind: 'docker',
    image: SUBFINDER_IMAGE,
    // IMPORTANT: Use shell wrapper for PTY compatibility
    // Running CLI tools directly as entrypoint can cause them to hang with PTY (pseudo-terminal)
    // The shell wrapper ensures proper TTY signal handling and clean exit
    // See docs/component-development.md "Docker Entrypoint Pattern" for details
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: SUBFINDER_TIMEOUT_SECONDS,
    env: {
      HOME: '/root',
    },
    // Shell wrapper pattern: sh -c 'subfinder "$@"' -- [args...]
    // This allows dynamic args to be appended and properly passed to subfinder
    command: ['-c', 'subfinder "$@"', '--'],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs subfinder to discover subdomains for a given domain. Optionally accepts a provider config secret to enable authenticated sources.',
  ui: {
    slug: 'subfinder',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Discover subdomains for a target domain using ProjectDiscovery subfinder.',
    documentation:
      'ProjectDiscovery Subfinder documentation details configuration, data sources, and usage examples.',
    documentationUrl: 'https://github.com/projectdiscovery/subfinder',
    icon: 'Radar',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`subfinder -d example.com -silent` - Passively gathers subdomains before chaining into deeper discovery tools.',
    examples: [
      'Enumerate subdomains for a single target domain prior to Amass or Naabu.',
      'Quick passive discovery during scope triage workflows.',
    ],
    agentTool: {
      enabled: true,
      toolDescription: 'Passive subdomain enumeration tool (Subfinder).',
    },
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const {
      domain: legacyDomain,
      threads,
      timeout,
      maxEnumerationTime,
      rateLimit,
      allSources,
      recursive,
      customFlags,
    } = parsedParams;

    const trimmedCustomFlags =
      typeof customFlags === 'string' && customFlags.length > 0 ? customFlags : null;
    const customFlagArgs = trimmedCustomFlags ? splitCliArgs(trimmedCustomFlags) : [];

    // Collect domains from both inputs and legacy parameter
    const values = new Set<string>();
    const addValue = (value: string | string[] | undefined) => {
      if (Array.isArray(value)) {
        value.forEach((item) => {
          const trimmed = item.trim();
          if (trimmed.length > 0) {
            values.add(trimmed);
          }
        });
        return;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          values.add(trimmed);
        }
      }
    };

    addValue(inputs.domains);
    addValue(legacyDomain);

    const domains = Array.from(values);
    const domainCount = domains.length;

    const providerConfig =
      typeof inputs.providerConfig === 'string' && inputs.providerConfig.trim().length > 0
        ? inputs.providerConfig
        : undefined;

    if (domainCount === 0) {
      context.logger.info('[Subfinder] Skipping execution because no domains were provided.');
      return {
        subdomains: [],
        rawOutput: '',
        domainCount: 0,
        subdomainCount: 0,
      };
    }

    context.logger.info(`[Subfinder] Enumerating ${domainCount} domain(s)`);
    context.emitProgress({
      message: `Launching Subfinder for ${domainCount} domain${domainCount === 1 ? '' : 's'}`,
      level: 'info',
      data: { domains },
    });

    // Extract tenant ID from context
    const tenantId = (context as any).tenantId ?? 'default-tenant';

    // Create isolated volume for this execution
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Subfinder runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput: string;
    try {
      // Prepare input files for the volume
      const inputFiles: Record<string, string> = {
        [DOMAIN_FILE_NAME]: domains.join('\n'),
      };

      // Add provider config file if provided
      if (providerConfig) {
        inputFiles[PROVIDER_CONFIG_FILE_NAME] = providerConfig;
        context.logger.info('[Subfinder] Provider configuration will be mounted.');
      }

      // Initialize the volume with input files
      const volumeName = await volume.initialize(inputFiles);
      context.logger.info(`[Subfinder] Created isolated volume: ${volumeName}`);

      // Build Subfinder arguments in TypeScript
      const subfinderArgs = buildSubfinderArgs({
        domainFile: `${CONTAINER_INPUT_DIR}/${DOMAIN_FILE_NAME}`,
        providerConfigFile: providerConfig
          ? `${CONTAINER_INPUT_DIR}/${PROVIDER_CONFIG_FILE_NAME}`
          : undefined,
        threads: threads ?? 10,
        timeout: timeout ?? 30,
        maxEnumerationTime,
        rateLimit,
        allSources: allSources ?? false,
        recursive: recursive ?? false,
        customFlags: customFlagArgs,
      });

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds ?? SUBFINDER_TIMEOUT_SECONDS,
        env: { ...(baseRunner.env ?? {}) },
        // Preserve the shell wrapper from baseRunner (sh -c 'subfinder "$@"' --)
        entrypoint: baseRunner.entrypoint,
        // Append subfinder arguments to shell wrapper command
        command: [...(baseRunner.command ?? []), ...subfinderArgs],
        volumes: [volume.getVolumeConfig(CONTAINER_INPUT_DIR, true)],
      };

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { domains, providerConfig },
          context,
        );

        // Get raw output (either string or from object)
        if (typeof result === 'string') {
          rawOutput = result;
        } else if (result && typeof result === 'object' && 'rawOutput' in result) {
          rawOutput = String((result as any).rawOutput ?? '');
        } else {
          rawOutput = '';
        }
      } catch (error) {
        // Subfinder can exit non-zero when some sources fail or rate-limit,
        // even though it still printed valid findings. Preserve partial results
        // instead of failing the entire workflow.
        if (error instanceof ContainerError) {
          const details = (error as any).details as Record<string, unknown> | undefined;
          const capturedStdout = details?.stdout;
          if (typeof capturedStdout === 'string' && capturedStdout.trim().length > 0) {
            context.logger.warn(
              `[Subfinder] Container exited non-zero but produced output. Preserving partial results.`,
            );
            context.emitProgress({
              message: 'Subfinder exited with errors but found some results',
              level: 'warn',
              data: { exitCode: details?.exitCode },
            });
            rawOutput = capturedStdout;
          } else {
            // No output captured - re-throw the original error
            throw error;
          }
        } else {
          throw error;
        }
      }
    } finally {
      // Always cleanup the volume
      await volume.cleanup();
      context.logger.info('[Subfinder] Cleaned up isolated volume');
    }

    // Parse output in TypeScript (not shell)
    // NOTE: We intentionally DO NOT use the -json flag for subfinder
    // Reason: Subfinder's -json outputs JSONL (one JSON per line), not a JSON array
    // JSONL requires line-by-line parsing: output.split('\n').map(line => JSON.parse(line))
    // Plain text is simpler: output.split('\n').filter(line => line.length > 0)
    const lines = rawOutput
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // Deduplicate subdomains
    const subdomainSet = new Set(lines);
    const subdomains = Array.from(subdomainSet);
    const subdomainCount = subdomains.length;

    context.logger.info(
      `[Subfinder] Found ${subdomainCount} unique subdomains across ${domainCount} domains`,
    );

    if (subdomainCount === 0) {
      context.emitProgress({
        message: 'No subdomains discovered by Subfinder',
        level: 'warn',
      });
    } else {
      context.emitProgress({
        message: `Subfinder discovered ${subdomainCount} subdomains`,
        level: 'info',
        data: { subdomains: subdomains.slice(0, 10) },
      });
    }

    return {
      subdomains,
      rawOutput,
      domainCount,
      subdomainCount,
    };
  },
});

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];

type SubfinderInput = typeof inputSchema;
type SubfinderOutput = typeof outputSchema;

export type { SubfinderInput, SubfinderOutput };

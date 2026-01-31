import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  runComponentWithRunner,
  ContainerError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  type DockerRunnerConfig,
  generateFindingHash,
  analyticsResultSchema,
  type AnalyticsResult,
  type ExecutionContext,
  type ExecutionPayload,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const AMASS_IMAGE = 'owaspamass/amass:v5.0.1';
const AMASS_TIMEOUT_SECONDS = (() => {
  const raw = process.env.AMASS_TIMEOUT_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return 900; // 15 minutes default
  }
  return parsed;
})();

// Free data sources that don't require API keys (fast, lightweight)
// NOTE: wayback and commoncrawl are excluded - they return massive amounts of data
// and can choke the system with 1GB+ downloads even for a single domain
const DEFAULT_FREE_DATA_SOURCES = ['crtsh', 'hackertarget'];
const DEFAULT_DATA_SOURCES_STRING = DEFAULT_FREE_DATA_SOURCES.join(',');

// Fast public DNS resolvers (Cloudflare, Google, Quad9)
const DEFAULT_RESOLVERS = ['1.1.1.1', '8.8.8.8', '9.9.9.9', '8.8.4.4', '1.0.0.1'];
const DEFAULT_RESOLVERS_STRING = DEFAULT_RESOLVERS.join(',');
const INPUT_MOUNT_NAME = 'inputs';
const CONTAINER_INPUT_DIR = `/${INPUT_MOUNT_NAME}`;
const DOMAIN_FILE_NAME = 'domains.txt';

const inputSchema = inputs({
  domains: port(
    z
      .array(z.string().min(1, 'Domain cannot be empty'))
      .min(1, 'Provide at least one domain')
      .describe('Array of root domains to enumerate'),
    {
      label: 'Target Domains',
      description: 'Root domains to enumerate using Amass.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const parameterSchema = parameters({
  passive: param(
    z.boolean().default(true).describe('Use passive mode only (no DNS queries, faster)'),
    {
      label: 'Passive Mode',
      editor: 'boolean',
      description: 'Skip DNS verification for faster execution (recommended for quick scans).',
      helpText: 'Disable only if you need verified DNS records.',
    },
  ),
  active: param(
    z
      .boolean()
      .default(false)
      .describe('Attempt active techniques (zone transfers, certificate name grabs)'),
    {
      label: 'Active Enumeration',
      editor: 'boolean',
      description: 'Enable active techniques (zone transfers, certificate name grabs).',
      helpText: 'Requires network reachability for authoritative DNS and may be noisy.',
    },
  ),
  bruteForce: param(
    z.boolean().default(false).describe('Enable DNS brute forcing after passive enumeration'),
    {
      label: 'DNS Brute Force',
      editor: 'boolean',
      description: 'Perform DNS brute forcing after passive enumeration.',
      helpText: 'Increases runtime and query volume but uncovers additional hosts.',
    },
  ),
  enableAlterations: param(
    z.boolean().default(false).describe('Enable Amass alterations engine for mutated hostnames'),
    {
      label: 'Enable Alterations',
      editor: 'boolean',
      description: 'Generate altered hostnames derived from known discoveries.',
      helpText: 'Pairs well with brute forcing when exploring complex environments.',
    },
  ),
  recursive: param(
    z
      .boolean()
      .default(false)
      .describe('Allow recursive brute forcing when enough labels are discovered'),
    {
      label: 'Recursive Brute Force',
      editor: 'boolean',
      description: 'Allow recursive brute forcing when sufficient labels are discovered.',
      helpText: 'Enable for deeper enumeration. Keep disabled for faster, shallower scans.',
    },
  ),
  minForRecursive: param(
    z
      .number()
      .int()
      .positive()
      .max(10, 'Recursive threshold above 10 is not supported')
      .optional()
      .describe('Labels required before recursive brute forcing starts'),
    {
      label: 'Labels Before Recursion',
      editor: 'number',
      min: 1,
      max: 10,
      description: 'Minimum number of labels before recursion begins.',
      helpText: 'Only used when recursive brute forcing is enabled.',
    },
  ),
  maxDepth: param(
    z
      .number()
      .int()
      .min(1)
      .max(10, 'Maximum depth above 10 is not supported')
      .optional()
      .describe('Maximum number of subdomain labels during brute forcing'),
    {
      label: 'Maximum Depth',
      editor: 'number',
      min: 1,
      max: 10,
      description: 'Limit brute forcing depth (number of labels).',
    },
  ),
  dnsQueryRate: param(
    z
      .number()
      .int()
      .positive()
      .max(1000, 'DNS query rate above 1000 QPS is not supported')
      .optional()
      .describe('Maximum DNS queries per second across all resolvers'),
    {
      label: 'DNS QPS Limit',
      editor: 'number',
      min: 1,
      max: 1000,
      description: 'Throttle the maximum DNS queries per second across resolvers.',
      helpText: 'Helpful when respecting rate limits or protecting monitored DNS.',
    },
  ),
  customFlags: param(
    z.string().trim().optional().describe('Raw CLI flags to append to the Amass command'),
    {
      label: 'Custom CLI Flags',
      editor: 'textarea',
      rows: 3,
      placeholder: '--config /work/config.yaml',
      description: 'Paste additional Amass CLI options exactly as you would on the command line.',
      helpText:
        'Flags are appended after the generated options; avoid duplicating -d domain arguments.',
    },
  ),
  includeIps: param(
    z.boolean().default(false).describe('Include discovered IP addresses alongside hostnames'),
    {
      label: 'Include IP Addresses',
      editor: 'boolean',
      description: 'Return discovered IPs alongside hostnames in the raw output.',
    },
  ),
  verbose: param(z.boolean().default(false).describe('Emit verbose Amass logging output'), {
    label: 'Verbose Output',
    editor: 'boolean',
    description: 'Emit verbose Amass logs in the workflow output.',
  }),
  demoMode: param(
    z.boolean().default(false).describe('Censor sensitive data in the Amass output (demo mode)'),
    {
      label: 'Demo Mode',
      editor: 'boolean',
      description: 'Censor sensitive values in the console output.',
    },
  ),
  timeoutMinutes: param(
    z
      .number()
      .int()
      .positive()
      .max(360, 'Timeout larger than 6 hours is not supported')
      .default(15)
      .describe('Maximum enumeration runtime before Amass exits'),
    {
      label: 'Timeout (minutes)',
      editor: 'number',
      min: 1,
      max: 360,
      description: 'Stop Amass after the specified number of minutes.',
      placeholder: '15',
      helpText:
        'Default is 15 minutes. Decrease for quick scans, increase for thorough enumeration.',
    },
  ),
  resolvers: param(
    z
      .string()
      .trim()
      .default(DEFAULT_RESOLVERS_STRING)
      .describe('Comma-separated list of DNS resolvers to use'),
    {
      label: 'DNS Resolvers',
      editor: 'text',
      placeholder: '1.1.1.1,8.8.8.8,9.9.9.9',
      description: 'Fast DNS resolvers for query resolution.',
      helpText:
        'Default uses Cloudflare (1.1.1.1), Google (8.8.8.8), and Quad9 (9.9.9.9). Add custom resolvers if needed.',
    },
  ),
  dataSources: param(
    z
      .string()
      .trim()
      .default(DEFAULT_DATA_SOURCES_STRING)
      .describe('Comma-separated list of data sources to query'),
    {
      label: 'Data Sources',
      editor: 'text',
      placeholder: 'crtsh,hackertarget',
      description: 'Limit which data sources Amass queries (speeds up enumeration).',
      helpText:
        'Default uses lightweight free sources. Add wayback,commoncrawl for more coverage (warning: very data-heavy).',
    },
  ),
});

const outputSchema = outputs({
  subdomains: port(z.array(z.string()), {
    label: 'Discovered Subdomains',
    description: 'Unique list of subdomains discovered by Amass.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw Amass console output for deeper inspection.',
  }),
  domainCount: port(z.number(), {
    label: 'Domain Count',
    description: 'Number of root domains scanned.',
  }),
  subdomainCount: port(z.number(), {
    label: 'Subdomain Count',
    description: 'Number of unique subdomains discovered.',
  }),
  options: port(
    z.object({
      passive: z.boolean(),
      active: z.boolean(),
      bruteForce: z.boolean(),
      includeIps: z.boolean(),
      enableAlterations: z.boolean(),
      recursive: z.boolean(),
      verbose: z.boolean(),
      demoMode: z.boolean(),
      timeoutMinutes: z.number().nullable(),
      minForRecursive: z.number().nullable(),
      maxDepth: z.number().nullable(),
      dnsQueryRate: z.number().nullable(),
      resolvers: z.string().nullable(),
      dataSources: z.string().nullable(),
      customFlags: z.string().nullable(),
    }),
    {
      label: 'Options',
      description: 'Effective Amass options applied during the run.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
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

interface BuildAmassArgsOptions {
  domainFile: string;
  passive: boolean;
  active: boolean;
  bruteForce: boolean;
  enableAlterations: boolean;
  recursive: boolean;
  minForRecursive?: number;
  maxDepth?: number;
  dnsQueryRate?: number;
  includeIps: boolean;
  verbose: boolean;
  demoMode: boolean;
  timeoutMinutes?: number;
  resolvers?: string;
  dataSources?: string;
  customFlags: string[];
}

/**
 * Build Amass CLI arguments in TypeScript.
 * This follows the Dynamic Args Pattern recommended in component-development.md
 */
const buildAmassArgs = (options: BuildAmassArgsOptions): string[] => {
  const args: string[] = ['enum'];

  // CRITICAL: Always use -silent to prevent progress bar spam
  // Without this, Amass outputs "0 / 1 [____]" to stderr hundreds of times per second
  // This floods Loki and can cause system overload (see incident report)
  args.push('-silent');

  // Domain file input
  args.push('-df', options.domainFile);

  // Passive mode - recommended for quick scans
  if (options.passive) {
    args.push('-passive');
  }

  // Active techniques (zone transfers, cert grabs)
  if (options.active) {
    args.push('-active');
  }

  // Brute force
  if (options.bruteForce) {
    args.push('-brute');
  }

  // Alterations engine
  if (options.enableAlterations) {
    args.push('-alts');
  }

  // Include IP addresses
  if (options.includeIps) {
    args.push('-ip');
  }

  // Recursive brute forcing
  if (!options.recursive) {
    args.push('-norecursive');
  } else if (typeof options.minForRecursive === 'number' && options.minForRecursive >= 1) {
    args.push('-min-for-recursive', String(options.minForRecursive));
  }

  // Max depth
  if (typeof options.maxDepth === 'number' && options.maxDepth >= 1) {
    args.push('-max-depth', String(options.maxDepth));
  }

  // DNS query rate
  if (typeof options.dnsQueryRate === 'number' && options.dnsQueryRate >= 1) {
    args.push('-dns-qps', String(options.dnsQueryRate));
  }

  // Timeout
  if (typeof options.timeoutMinutes === 'number' && options.timeoutMinutes >= 1) {
    args.push('-timeout', String(options.timeoutMinutes));
  }

  // Data sources - limit which sources to query for faster enumeration
  // Use -include flag (not -src) to specify which data sources to use
  if (typeof options.dataSources === 'string' && options.dataSources.length > 0) {
    args.push('-include', options.dataSources);
  }

  // DNS resolvers - use fast public resolvers for better performance
  if (typeof options.resolvers === 'string' && options.resolvers.length > 0) {
    args.push('-r', options.resolvers);
  }

  // Verbose
  if (options.verbose) {
    args.push('-v');
  }

  // Demo mode
  if (options.demoMode) {
    args.push('-demo');
  }

  // Custom flags (appended last)
  for (const flag of options.customFlags) {
    if (flag.length > 0) {
      args.push(flag);
    }
  }

  return args;
};

// Retry policy for Amass - long-running subdomain enumeration
const amassRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 10,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 1.5,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = (defineComponent as any)({
  id: 'shipsec.amass.enum',
  label: 'Amass Enumeration',
  category: 'security',
  retryPolicy: amassRetryPolicy,
  runner: {
    kind: 'docker',
    image: AMASS_IMAGE,
    // IMPORTANT: Use shell wrapper for PTY compatibility
    // Running CLI tools directly as entrypoint can cause them to hang with PTY (pseudo-terminal)
    // The shell wrapper ensures proper TTY signal handling and clean exit
    // See docs/component-development.md "Docker Entrypoint Pattern" for details
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: AMASS_TIMEOUT_SECONDS,
    env: {
      HOME: '/tmp',
    },
    // Shell wrapper pattern: sh -c 'amass "$@"' -- [args...]
    // This allows dynamic args to be appended and properly passed to amass
    command: ['-c', 'amass "$@"', '--'],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Enumerate subdomains with OWASP Amass. Supports active techniques, brute forcing, alterations, recursion tuning, and DNS throttling.',
  ui: {
    slug: 'amass',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'OWASP Amass powered subdomain enumeration with optional brute force, alterations, and recursion controls.',
    documentation:
      'OWASP Amass is a comprehensive attack surface mapping toolkit. Adjust enumeration depth, mutation behaviour, and DNS query rates to match your engagement.',
    documentationUrl: 'https://github.com/owasp-amass/amass',
    icon: 'Network',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`amass enum -d example.com -brute -alts` - Aggressively enumerates subdomains with brute force and alteration engines enabled.',
    examples: [
      'Run full-depth enumeration with brute force and alterations on a scope domain.',
      'Perform quick passive reconnaissance using custom CLI flags like --passive.',
    ],
  },
  async execute(
    {
      inputs,
      params,
    }: ExecutionPayload<z.infer<typeof inputSchema>, z.infer<typeof parameterSchema>>,
    context: ExecutionContext,
  ) {
    const parsedParams = parameterSchema.parse(params);
    const {
      passive,
      active,
      bruteForce,
      enableAlterations,
      recursive,
      minForRecursive,
      maxDepth,
      dnsQueryRate,
      includeIps,
      verbose,
      demoMode,
      timeoutMinutes,
      resolvers,
      dataSources,
      customFlags,
    } = parsedParams;

    const trimmedCustomFlags =
      typeof customFlags === 'string' && customFlags.length > 0 ? customFlags : null;
    const customFlagArgs = trimmedCustomFlags ? splitCliArgs(trimmedCustomFlags) : [];

    const effectiveDataSources = dataSources ?? DEFAULT_DATA_SOURCES_STRING;
    const effectiveResolvers = resolvers ?? DEFAULT_RESOLVERS_STRING;

    const optionsSummary = {
      passive: passive ?? true,
      active: active ?? false,
      bruteForce: bruteForce ?? false,
      enableAlterations: enableAlterations ?? false,
      includeIps: includeIps ?? false,
      recursive: recursive ?? false,
      minForRecursive: minForRecursive ?? null,
      maxDepth: maxDepth ?? null,
      dnsQueryRate: dnsQueryRate ?? null,
      verbose: verbose ?? false,
      demoMode: demoMode ?? false,
      timeoutMinutes: timeoutMinutes ?? 15,
      resolvers: effectiveResolvers,
      dataSources: effectiveDataSources,
      customFlags: trimmedCustomFlags,
    };

    // Normalize domains
    const normalisedDomains = inputs.domains
      .map((domain) => domain.trim())
      .filter((domain) => domain.length > 0);

    const domainCount = normalisedDomains.length;

    if (domainCount === 0) {
      context.logger.info('[Amass] Skipping execution because no domains were provided.');
      return {
        subdomains: [],
        rawOutput: '',
        domainCount: 0,
        subdomainCount: 0,
        options: optionsSummary,
      };
    }

    context.logger.info(
      `[Amass] Enumerating ${domainCount} domain(s) with options: ${JSON.stringify(optionsSummary)}`,
    );

    context.emitProgress({
      message: 'Launching Amass enumeration container…',
      level: 'info',
      data: { domains: inputs.domains, options: optionsSummary },
    });

    // Extract tenant ID from context
    const tenantId = (context as any).tenantId ?? 'default-tenant';

    // Create isolated volume for this execution
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Amass runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput: string;
    try {
      // Initialize volume with domain file
      const volumeName = await volume.initialize({
        [DOMAIN_FILE_NAME]: normalisedDomains.join('\n'),
      });
      context.logger.info(`[Amass] Created isolated volume: ${volumeName}`);

      // Build Amass arguments in TypeScript
      const amassArgs = buildAmassArgs({
        domainFile: `${CONTAINER_INPUT_DIR}/${DOMAIN_FILE_NAME}`,
        passive: passive ?? true,
        active: active ?? false,
        bruteForce: bruteForce ?? false,
        enableAlterations: enableAlterations ?? false,
        recursive: recursive ?? false,
        minForRecursive,
        maxDepth,
        dnsQueryRate,
        includeIps: includeIps ?? false,
        verbose: verbose ?? false,
        demoMode: demoMode ?? false,
        timeoutMinutes: timeoutMinutes ?? 15,
        resolvers: effectiveResolvers,
        dataSources: effectiveDataSources,
        customFlags: customFlagArgs,
      });

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds ?? AMASS_TIMEOUT_SECONDS,
        env: { ...(baseRunner.env ?? {}) },
        // Preserve the shell wrapper from baseRunner (sh -c 'amass "$@"' --)
        entrypoint: baseRunner.entrypoint,
        // Append amass arguments to shell wrapper command
        command: [...(baseRunner.command ?? []), ...amassArgs],
        volumes: [volume.getVolumeConfig(CONTAINER_INPUT_DIR, true)],
      };

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { domains: inputs.domains },
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
        // Amass can exit non-zero when some data sources fail or rate-limit,
        // even though it still printed valid findings. Preserve partial results
        // instead of failing the entire workflow.
        if (error instanceof ContainerError) {
          const details = (error as any).details as Record<string, unknown> | undefined;
          const capturedStdout = details?.stdout;
          if (typeof capturedStdout === 'string' && capturedStdout.trim().length > 0) {
            context.logger.warn(
              `[Amass] Container exited non-zero but produced output. Preserving partial results.`,
            );
            context.emitProgress({
              message: 'Amass exited with errors but found some results',
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
      context.logger.info('[Amass] Cleaned up isolated volume');
    }

    // Parse output in TypeScript (not shell)
    const lines = rawOutput
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    // Deduplicate subdomains - extract hostname from each line
    // Amass output can include IP addresses or other data after the hostname
    const subdomainSet = new Set(
      lines
        .map((line) => {
          // Extract first token (hostname)
          const tokens = line.split(/\s+/);
          return tokens[0] || '';
        })
        .filter((host) => host.length > 0 && !host.startsWith('[')),
    );
    const subdomains = Array.from(subdomainSet);
    const subdomainCount = subdomains.length;

    context.logger.info(
      `[Amass] Found ${subdomainCount} unique subdomains across ${domainCount} domains`,
    );

    if (subdomainCount === 0) {
      context.emitProgress({
        message: 'No subdomains discovered by Amass',
        level: 'warn',
      });
    } else {
      context.emitProgress({
        message: `Amass discovered ${subdomainCount} subdomains`,
        level: 'info',
        data: { subdomains: subdomains.slice(0, 10) },
      });
    }

    // Build analytics-ready results with scanner metadata
    const analyticsResults: AnalyticsResult[] = subdomains.map((subdomain) => ({
      scanner: 'amass',
      finding_hash: generateFindingHash('subdomain-discovery', subdomain, inputs.domains.join(',')),
      severity: 'info' as const,
      asset_key: subdomain,
      subdomain,
      parent_domains: inputs.domains,
    }));

    return {
      subdomains,
      rawOutput,
      domainCount,
      subdomainCount,
      options: optionsSummary,
      results: analyticsResults,
    };
  },
});

componentRegistry.register(definition);

// Internal type for execute function
type Output = (typeof outputSchema)['__inferred'];

// Create local type aliases for backward compatibility
type AmassInput = typeof inputSchema;
type AmassOutput = typeof outputSchema;

export type { AmassInput, AmassOutput };

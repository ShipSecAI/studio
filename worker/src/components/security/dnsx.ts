import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  runComponentWithRunner,
  type DockerRunnerConfig,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const recordTypeEnum = z.enum([
  'A',
  'AAAA',
  'CNAME',
  'MX',
  'NS',
  'TXT',
  'PTR',
  'SRV',
  'SOA',
  'CAA',
  'AXFR',
  'ANY',
  'RECON',
]);

const outputModeEnum = z.enum(['silent', 'json']);

const DNSX_IMAGE = 'projectdiscovery/dnsx:v1.2.3';
const DNSX_TIMEOUT_SECONDS = 180;
const INPUT_MOUNT_NAME = 'inputs';
const CONTAINER_INPUT_DIR = `/${INPUT_MOUNT_NAME}`;
const DOMAIN_FILE_NAME = 'domains.txt';
const RESOLVER_FILE_NAME = 'resolvers.txt';

const inputSchema = z.object({
  domains: z.array(
    z
      .string()
      .min(1)
      .regex(/^[\w.-]+$/, 'Domains may only include letters, numbers, dots, underscores, and hyphens.'),
  ),
  recordTypes: z.array(recordTypeEnum).default(['A']),
  resolvers: z
    .array(
      z
        .string()
        .min(1, 'Resolver addresses cannot be empty.')
        .regex(
          /^[\w.:+-]+$/,
          'Resolvers should be hostnames or IPs, optionally including port (e.g. 1.1.1.1:53).',
        ),
    )
    .default(['1.1.1.1:53', '1.0.0.1:53', '8.8.8.8:53', '8.8.4.4:53']),
  retryCount: z.number().int().min(1).max(10).default(2),
  rateLimit: z.number().int().positive().max(10000).optional(),
  threads: z.number().int().min(1).max(10000).default(100),
  includeResponses: z.boolean().default(true),
  responsesOnly: z.boolean().default(false),
  statusCodeFilter: z
    .string()
    .trim()
    .max(200, 'Status code filter should be a comma-separated list (max 200 chars).')
    .optional(),
  showCdn: z.boolean().default(false),
  showAsn: z.boolean().default(false),
  includeStats: z.boolean().default(false),
  verbose: z.boolean().default(false),
  includeRawDns: z.boolean().default(false),
  omitRawInJson: z.boolean().default(false),
  wildcardThreshold: z.number().int().min(1).max(1000).optional(),
  wildcardDomain: z
    .string()
    .trim()
    .max(255, 'Wildcard filter domain must be shorter than 255 characters.')
    .optional(),
  proxy: z
    .string()
    .trim()
    .max(255, 'Proxy definitions must be shorter than 255 characters.')
    .optional(),
  customFlags: z
    .string()
    .trim()
    .optional()
    .describe('Raw CLI flags appended to the dnsx invocation.'),
  outputMode: outputModeEnum.default('json'),
});

type Input = z.infer<typeof inputSchema>;

type DnsxRecord = {
  host: string;
  statusCode?: string;
  ttl?: number;
  resolver?: string[];
  answers: Record<string, string[]>;
  timestamp?: string;
};

type Output = {
  results: DnsxRecord[];
  rawOutput: string;
  domainCount: number;
  recordCount: number;
  recordTypes: string[];
  resolvers: string[];
  resolvedHosts: string[];
  errors?: string[];
};

const dnsxLineSchema = z
  .object({
    host: z.string(),
    status_code: z.string().optional(),
    ttl: z.union([z.number(), z.string()]).optional(),
    resolver: z.array(z.string()).optional(),
    timestamp: z.string().optional(),
    raw_resp: z.unknown().optional(),
  })
  .passthrough();

const outputSchema: z.ZodType<Output> = z.object({
  results: z.array(z.any()),
  rawOutput: z.string(),
  domainCount: z.number(),
  recordCount: z.number(),
  recordTypes: z.array(z.string()),
  resolvers: z.array(z.string()),
  resolvedHosts: z.array(z.string()),
  errors: z.array(z.string()).optional(),
}) as z.ZodType<Output>;

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

type DnsxRecordType = z.infer<typeof recordTypeEnum>;

const recordTypeFlagMap: Record<DnsxRecordType, string> = {
  A: '-a',
  AAAA: '-aaaa',
  CNAME: '-cname',
  MX: '-mx',
  NS: '-ns',
  TXT: '-txt',
  PTR: '-ptr',
  SRV: '-srv',
  SOA: '-soa',
  CAA: '-caa',
  AXFR: '-axfr',
  ANY: '-any',
  RECON: '-recon',
};

interface BuildDnsxArgsOptions {
  outputMode: z.infer<typeof outputModeEnum>;
  includeResponses: boolean;
  responsesOnly: boolean;
  statusCodeFilter?: string;
  showCdn: boolean;
  showAsn: boolean;
  includeStats: boolean;
  verbose: boolean;
  includeRawDns: boolean;
  omitRawInJson: boolean;
  wildcardThreshold?: number;
  wildcardDomain?: string;
  proxy?: string;
  recordTypes: DnsxRecordType[];
  resolverFile: boolean;
  threads?: number;
  retryCount?: number;
  rateLimit?: number;
  customFlags: string[];
}

const buildDnsxArgs = (options: BuildDnsxArgsOptions): string[] => {
  const args: string[] = [];

  if (options.outputMode === 'json') {
    args.push('-json', '-silent');
  } else {
    args.push('-silent');
  }

  args.push('-l', `${CONTAINER_INPUT_DIR}/${DOMAIN_FILE_NAME}`);

  if (options.resolverFile) {
    args.push('-r', `${CONTAINER_INPUT_DIR}/${RESOLVER_FILE_NAME}`);
  }

  args.push('-t', String(options.threads ?? 100));

  if (typeof options.retryCount === 'number' && options.retryCount >= 1) {
    args.push('-retry', String(options.retryCount));
  }

  if (typeof options.rateLimit === 'number' && options.rateLimit >= 1) {
    args.push('-rl', String(options.rateLimit));
  }

  if (options.includeResponses) {
    args.push('-resp');
  }

  if (options.responsesOnly) {
    args.push('-resp-only');
  }

  if (options.statusCodeFilter) {
    args.push('-rcode', options.statusCodeFilter);
  }

  if (options.showCdn) {
    args.push('-cdn');
  }

  if (options.showAsn) {
    args.push('-asn');
  }

  if (options.includeStats) {
    args.push('-stats');
  }

  if (options.includeRawDns) {
    args.push('-raw');
  }

  if (options.verbose) {
    args.push('-verbose');
  }

  if (options.omitRawInJson) {
    args.push('-omit-raw');
  }

  if (typeof options.wildcardThreshold === 'number' && options.wildcardThreshold >= 1) {
    args.push('-wt', String(options.wildcardThreshold));
  }

  if (options.wildcardDomain) {
    args.push('-wd', options.wildcardDomain);
  }

  if (options.proxy) {
    args.push('-proxy', options.proxy);
  }

  for (const recordType of options.recordTypes) {
    const flag = recordTypeFlagMap[recordType];
    if (flag) {
      args.push(flag);
    }
  }

  // CRITICAL: Enable stream mode to prevent output buffering
  // ProjectDiscovery tools buffer output by default, causing containers to appear hung
  // -stream flag: Disables buffering + forces immediate output flush
  // Without this, dnsx buffers up to 8KB before flushing, causing 180s timeout failures
  // See docs/component-development.md "Output Buffering" section for details
  args.push('-stream');

  for (const flag of options.customFlags) {
    if (flag.length > 0) {
      args.push(flag);
    }
  }

  return args;
};

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.dnsx.run',
  label: 'DNSX Resolver',
  category: 'security',
  runner: {
    kind: 'docker',
    image: DNSX_IMAGE,
    // IMPORTANT: Use shell wrapper for PTY compatibility
    // Running CLI tools directly as entrypoint can cause them to hang with PTY (pseudo-terminal)
    // The shell wrapper ensures proper TTY signal handling and clean exit
    // See docs/component-development.md "Docker Entrypoint Pattern" for details
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: DNSX_TIMEOUT_SECONDS,
    env: {
      HOME: '/root',
    },
    // Shell wrapper pattern: sh -c 'dnsx "$@"' -- [args...]
    // This allows dynamic args to be appended and properly passed to dnsx
    command: ['-c', 'dnsx "$@"', '--'],
  },
  inputSchema,
  outputSchema,
  docs:
    'Executes dnsx inside Docker to resolve DNS records for the provided domains. Supports multiple record types, custom resolvers, and rate limiting.',
  metadata: {
    slug: 'dnsx',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Resolve DNS records using ProjectDiscovery dnsx with support for multiple record types, custom resolvers, and rate limiting.',
    documentation: 'https://github.com/projectdiscovery/dnsx',
    icon: 'Globe',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'domains',
        label: 'Target Domains',
        dataType: port.list(port.text()),
        required: true,
        description: 'Array of domains or hostnames to resolve.',
      },
      {
        id: 'recordTypes',
        label: 'Record Types',
        dataType: port.list(port.text()),
        description: 'DNS record types to query (e.g. A, AAAA, CNAME).',
      },
      {
        id: 'resolvers',
        label: 'Resolvers',
        dataType: port.list(port.text()),
        description: 'Optional resolver IPs/hosts (e.g. 1.1.1.1:53).',
      },
    ],
    outputs: [
      {
        id: 'results',
        label: 'DNS Responses',
        dataType: port.list(port.json()),
        description: 'Structured dnsx JSONL output grouped by record type.',
      },
      {
        id: 'rawOutput',
        label: 'Raw Output',
        dataType: port.text(),
        description: 'Raw dnsx JSONL output prior to normalisation.',
      },
      {
        id: 'resolvedHosts',
        label: 'Resolved Hosts',
        dataType: port.list(port.text()),
        description: 'Unique hostnames resolved by dnsx (ideal for chaining into httpx).',
      },
    ],
    parameters: [
      {
        id: 'outputMode',
        label: 'Output Mode',
        type: 'select',
        default: 'json',
        description: 'JSON mode (default) returns structured dnsx records; Silent mode prints resolved hosts only.',
        options: [
          { label: 'Silent (resolved hosts)', value: 'silent' },
          { label: 'JSON (structured records)', value: 'json' },
        ],
      },
      {
        id: 'includeResponses',
        label: 'Include DNS Responses',
        type: 'boolean',
        default: true,
        description: 'Adds -resp so dnsx returns answer sections (recommended for JSON mode).',
        helpText: 'Disable only if you strictly need terse host output; JSON parsing may lose data otherwise.',
      },
      {
        id: 'responsesOnly',
        label: 'Responses Only',
        type: 'boolean',
        default: false,
        description: 'Forward dnsx response blobs without the leading hostname (-resp-only).',
      },
      {
        id: 'statusCodeFilter',
        label: 'Status Code Filter',
        type: 'text',
        placeholder: 'noerror,servfail,refused',
        description: 'Comma-separated DNS status codes to keep (dnsx -rcode).',
      },
      {
        id: 'threads',
        label: 'Thread Count',
        type: 'number',
        min: 1,
        max: 10000,
        default: 100,
        description: 'Number of concurrent dnsx workers (-t).',
      },
      {
        id: 'retryCount',
        label: 'Retry Count',
        type: 'number',
        default: 2,
        min: 1,
        max: 10,
        description: 'Number of retry attempts dnsx should make for failed queries.',
      },
      {
        id: 'rateLimit',
        label: 'Rate Limit (req/s)',
        type: 'number',
        description: 'Throttle dnsx requests per second (optional).',
        min: 1,
        max: 10000,
      },
      {
        id: 'showCdn',
        label: 'Show CDN Names',
        type: 'boolean',
        default: false,
        description: 'Adds -cdn to annotate responses with detected CDN providers.',
      },
      {
        id: 'showAsn',
        label: 'Show ASN Info',
        type: 'boolean',
        default: false,
        description: 'Adds -asn to include the autonomous system number for each result.',
      },
      {
        id: 'includeStats',
        label: 'Emit Scan Stats',
        type: 'boolean',
        default: false,
        description: 'Adds -stats to show resolver throughput summary blocks.',
      },
      {
        id: 'includeRawDns',
        label: 'Include Raw DNS',
        type: 'boolean',
        default: false,
        description: 'Adds -raw for debugging raw dns responses.',
      },
      {
        id: 'omitRawInJson',
        label: 'Omit Raw (JSON)',
        type: 'boolean',
        default: false,
        description: 'Adds -omit-raw to skip base64 payloads in JSON output.',
      },
      {
        id: 'verbose',
        label: 'Verbose Logs',
        type: 'boolean',
        default: false,
        description: 'Adds -verbose for additional dnsx logging.',
      },
      {
        id: 'wildcardThreshold',
        label: 'Wildcard Threshold',
        type: 'number',
        min: 1,
        max: 1000,
        description: 'Adds -wildcard-threshold to drop noisy wildcard responses.',
      },
      {
        id: 'wildcardDomain',
        label: 'Wildcard Domain',
        type: 'text',
        placeholder: 'example.com',
        description: 'Adds -wildcard-domain for focused wildcard filtering.',
      },
      {
        id: 'proxy',
        label: 'Proxy',
        type: 'text',
        placeholder: 'socks5://127.0.0.1:9050',
        description: 'Route all dnsx traffic through a proxy (-proxy).',
      },
      {
        id: 'customFlags',
        label: 'Custom CLI Flags',
        type: 'textarea',
        rows: 3,
        placeholder: '--rcode noerror --proxy socks5://127.0.0.1:9050',
        description: 'Paste additional dnsx CLI options exactly as you would on the command line.',
        helpText: 'Flags are appended after the generated options; avoid duplicating list/record selections.',
      },
    ],
  },
  async execute(input, context) {
    const {
      domains,
      recordTypes,
      resolvers,
      retryCount,
      rateLimit,
      outputMode,
      threads,
      includeResponses,
      responsesOnly,
      statusCodeFilter,
      showCdn,
      showAsn,
      includeStats,
      verbose,
      includeRawDns,
      omitRawInJson,
      wildcardThreshold,
      wildcardDomain,
      proxy,
      customFlags,
    } = input;

    const trimmedStatusCodeFilter =
      typeof statusCodeFilter === 'string' && statusCodeFilter.length > 0 ? statusCodeFilter : undefined;
    const trimmedWildcardDomain =
      typeof wildcardDomain === 'string' && wildcardDomain.length > 0 ? wildcardDomain : undefined;
    const trimmedProxy = typeof proxy === 'string' && proxy.length > 0 ? proxy : undefined;
    const customFlagArgs =
      typeof customFlags === 'string' && customFlags.length > 0 ? splitCliArgs(customFlags) : [];

    const normalisedDomains = domains
      .map((domain) => domain.trim())
      .filter((domain) => domain.length > 0);
    const domainCount = normalisedDomains.length;

    const resolverList = resolvers
      .map((resolver) => resolver.trim())
      .filter((resolver) => resolver.length > 0);

    const ensureUnique = (values: string[]) =>
      Array.from(new Set(values.filter((value) => value && value.length > 0)));

    const requestedRecordTypes = ensureUnique(recordTypes);
    const requestedResolvers = ensureUnique(resolverList);

    if (domainCount === 0) {
      context.logger.info('[DNSX] Skipping dnsx execution because no domains were provided.');
      return outputSchema.parse({
        results: [],
        rawOutput: '',
        domainCount: 0,
        recordCount: 0,
        recordTypes: requestedRecordTypes,
        resolvers: requestedResolvers,
        resolvedHosts: [],
        errors: ['No domains were provided to dnsx; upstream component produced an empty list.'],
      });
    }

    const dnsxArgs = buildDnsxArgs({
      outputMode,
      includeResponses,
      responsesOnly,
      statusCodeFilter: trimmedStatusCodeFilter,
      showCdn,
      showAsn,
      includeStats,
      verbose,
      includeRawDns,
      omitRawInJson,
      wildcardThreshold,
      wildcardDomain: trimmedWildcardDomain,
      proxy: trimmedProxy,
      recordTypes,
      resolverFile: resolverList.length > 0,
      threads,
      retryCount,
      rateLimit,
      customFlags: customFlagArgs,
    });

    context.logger.info(
      `[DNSX] Resolving ${domainCount} domain(s) with record types: ${recordTypes.join(', ')}`,
    );
    context.emitProgress(`Running dnsx for ${domainCount} domain${domainCount === 1 ? '' : 's'}`);

    // Extract tenant ID from context (assuming it's available)
    // TODO: Update this line when context includes tenantId
    const tenantId = (context as any).tenantId ?? 'default-tenant';

    // Create isolated volume for this execution
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new Error('DNSX runner must be docker');
    }

    let rawPayload: unknown;
    try {
      // Prepare input files for the volume
      const inputFiles: Record<string, string> = {
        [DOMAIN_FILE_NAME]: normalisedDomains.join('\n'),
      };

      // Add resolver file if resolvers are provided
      if (resolverList.length > 0) {
        inputFiles[RESOLVER_FILE_NAME] = resolverList.join('\n');
      }

      // Initialize the volume with input files
      const volumeName = await volume.initialize(inputFiles);
      context.logger.info(`[DNSX] Created isolated volume: ${volumeName}`);

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds ?? DNSX_TIMEOUT_SECONDS,
        env: { ...(baseRunner.env ?? {}) },
        // Preserve the shell wrapper from baseRunner (sh -c 'dnsx "$@"' --)
        // This is critical for PTY compatibility - do not override with 'dnsx'
        entrypoint: baseRunner.entrypoint,
        // Append dnsx arguments to shell wrapper command
        // Resulting command: ['sh', '-c', 'dnsx "$@"', '--', ...dnsxArgs]
        command: [...(baseRunner.command ?? []), ...dnsxArgs],
        volumes: [volume.getVolumeConfig(CONTAINER_INPUT_DIR, true)],
      };

      rawPayload = await runComponentWithRunner(
        runnerConfig,
        async () => ({} as Output),
        input,
        context,
      );
    } finally {
      // Always cleanup the volume, even on error
      await volume.cleanup();
      context.logger.info('[DNSX] Cleaned up isolated volume');
    }

    const buildOutput = (params: {
      records: Array<z.infer<typeof dnsxLineSchema>>;
      rawOutput: string;
      domainCount: number;
      recordCount: number;
      recordTypes: string[];
      resolvers: string[];
      errors?: string[];
    }): Output => {
      const normalisedRecords: DnsxRecord[] = params.records.map((record) => {
        const answers: Record<string, string[]> = {};
        const candidateKeys = [
          'a',
          'aaaa',
          'cname',
          'mx',
          'ns',
          'txt',
          'ptr',
          'srv',
          'soa',
          'caa',
          'any',
          'axfr',
          'all',
        ];

        candidateKeys.forEach((key: string) => {
          const value = (record as Record<string, unknown>)[key];
          if (Array.isArray(value) && value.length > 0) {
            answers[key] = value.map((entry: unknown) => String(entry));
          }
        });

        const ttlValue = (record as Record<string, unknown>).ttl;
        const ttl =
          typeof ttlValue === 'number'
            ? ttlValue
            : typeof ttlValue === 'string' && ttlValue.trim().length > 0
              ? Number.parseInt(ttlValue, 10)
              : undefined;

        return {
          host: record.host,
          statusCode: typeof (record as Record<string, unknown>).status_code === 'string'
            ? (record as Record<string, unknown>).status_code as string
            : undefined,
          ttl: Number.isFinite(ttl) ? ttl : undefined,
          resolver: Array.isArray(record.resolver)
            ? record.resolver.map((entry: unknown) => String(entry))
            : undefined,
          answers,
          timestamp: record.timestamp,
        };
      });

      const derivedResolvers = ensureUnique(
        params.records
          .flatMap((record) => (Array.isArray(record.resolver) ? record.resolver.map((entry) => String(entry)) : [])),
      );

      const derivedRecordTypes = ensureUnique(
        params.records.flatMap((record) => {
          const keys: string[] = [];
          const candidateKeys = ['a', 'aaaa', 'cname', 'mx', 'ns', 'txt', 'ptr', 'srv', 'soa', 'caa', 'any', 'axfr'];
          candidateKeys.forEach((key) => {
            const value = (record as Record<string, unknown>)[key];
            if (Array.isArray(value) && value.length > 0) {
              keys.push(key.toUpperCase());
            }
          });
          return keys;
        }),
      );

      const requestedRecordTypes = Array.isArray(params.recordTypes)
        ? params.recordTypes.filter((entry) => typeof entry === 'string')
        : [];

      const requestedResolvers = Array.isArray(params.resolvers)
        ? params.resolvers.filter((entry) => typeof entry === 'string')
        : [];

      const resolvedHosts = ensureUnique(
        normalisedRecords
          .map((record) => record.host)
          .filter((host): host is string => typeof host === 'string' && host.length > 0),
      );

      return {
        results: normalisedRecords,
        rawOutput: params.rawOutput,
        domainCount: params.domainCount,
        recordCount: params.recordCount,
        recordTypes: ensureUnique(
          requestedRecordTypes.length > 0
            ? requestedRecordTypes
            : derivedRecordTypes.length > 0
              ? derivedRecordTypes
              : recordTypes,
        ),
        resolvers: ensureUnique(
          requestedResolvers.length > 0
            ? requestedResolvers
            : derivedResolvers.length > 0
              ? derivedResolvers
              : resolverList,
        ),
        resolvedHosts,
        errors: params.errors && params.errors.length > 0 ? ensureUnique(params.errors) : undefined,
      };
    };

    const buildSilentOutput = (payload: unknown): Output => {
      let rawOutput: string;
      if (typeof payload === 'string') {
        rawOutput = payload;
      } else {
        try {
          rawOutput = JSON.stringify(payload ?? '');
        } catch {
          rawOutput = '';
        }
      }

      const trimmed = rawOutput.trim();

      if (trimmed.length === 0) {
        return {
          results: [],
          rawOutput,
          domainCount: domainCount,
          recordCount: 0,
          recordTypes,
          resolvers: resolverList,
          resolvedHosts: [],
        };
      }

      try {
        const maybeJson = JSON.parse(trimmed);
        if (maybeJson && typeof maybeJson === 'object' && !Array.isArray(maybeJson)) {
          const record = maybeJson as Record<string, unknown>;
          if (record.__error__ === true) {
            const message =
              typeof record.message === 'string'
                ? (record.message as string)
                : 'dnsx returned an error.';
            const errorDomainCount =
              typeof record.domainCount === 'number' && Number.isFinite(record.domainCount)
                ? (record.domainCount as number)
                : domainCount;
            return {
              results: [],
              rawOutput: trimmed,
              domainCount: errorDomainCount,
              recordCount: 0,
              recordTypes,
              resolvers: resolverList,
              resolvedHosts: [],
              errors: [message],
            };
          }

          const validated = outputSchema.safeParse(record);
          if (validated.success) {
            return buildOutput({
              records: validated.data.results as Array<z.infer<typeof dnsxLineSchema>>,
              rawOutput: validated.data.rawOutput ?? rawOutput,
              domainCount: validated.data.domainCount ?? domainCount,
              recordCount: validated.data.recordCount ?? validated.data.results.length,
              recordTypes: validated.data.recordTypes ?? recordTypes,
              resolvers: validated.data.resolvers ?? resolverList,
              errors: validated.data.errors,
            });
          }
        }
      } catch {
        // Not JSON; continue with silent parsing.
      }

      const lines = trimmed
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length === 0) {
        return {
          results: [],
          rawOutput,
          domainCount: domainCount,
          recordCount: 0,
          recordTypes,
          resolvers: resolverList,
          resolvedHosts: [],
        };
      }

      const silentRecords: DnsxRecord[] = lines.map((line) => {
        const tokens = line.split(/\s+/).filter((token) => token.length > 0);
        const host = tokens.length > 0 ? tokens[0] : line;
        const answers: Record<string, string[]> = { raw: [line] };
        const resolvedMatches = Array.from(line.matchAll(/\[([^\]]+)\]/g))
          .map((match) => match[1])
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
        if (resolvedMatches.length > 0) {
          answers.resolved = resolvedMatches;
        }
        return {
          host,
          answers,
        };
      });

      return {
        results: silentRecords,
        rawOutput,
        domainCount: domainCount,
        recordCount: silentRecords.length,
        recordTypes,
        resolvers: resolverList,
        resolvedHosts: ensureUnique(
          silentRecords
            .map((record) => record.host)
            .filter((host): host is string => typeof host === 'string' && host.length > 0),
        ),
      };
    };

    if (typeof rawPayload === 'string') {
      if (outputMode === 'silent') {
        return buildSilentOutput(rawPayload);
      }
      const rawOutput = rawPayload;
      const trimmed = rawOutput.trim();

      if (trimmed.length === 0) {
        return {
          results: [],
          rawOutput,
          domainCount: domainCount,
          recordCount: 0,
          recordTypes,
          resolvers: resolverList,
          resolvedHosts: [],
        };
      }

      const lines: string[] = trimmed
        .split(/\r?\n/g)
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0);

      const parseErrors: string[] = [];
      const parsedRecords: Array<z.infer<typeof dnsxLineSchema>> = [];

      for (const line of lines) {
        try {
          const parsedLine = JSON.parse(line) as Record<string, unknown>;
          if (parsedLine && parsedLine.__error__ === true) {
            const message =
              typeof parsedLine.message === 'string'
                ? parsedLine.message
                : 'dnsx returned an error without details.';
            parseErrors.push(message);
            continue;
          }

          const validation = dnsxLineSchema.safeParse(parsedLine);
          if (validation.success) {
            parsedRecords.push(validation.data);
          } else {
            parseErrors.push(validation.error.message);
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          parseErrors.push(`Failed to parse dnsx output line: ${reason}`);
        }
      }

      if (parsedRecords.length === 0) {
        context.logger.error('[DNSX] No valid JSON lines returned from dnsx; falling back to raw output.');
        const fallbackLines: string[] = lines.length > 0 ? lines : trimmed.split('\n');
        const fallbackResults: DnsxRecord[] = fallbackLines.map((line: string) => {
          const tokens = line.split(/\s+/).filter((token) => token.length > 0);
          const host = tokens.length > 0 ? tokens[0] : line;
          return {
            host,
            answers: { raw: [line] },
          };
        });

        return {
          results: fallbackResults,
          rawOutput,
          domainCount: domainCount,
          recordCount: fallbackResults.length,
          recordTypes,
          resolvers: resolverList,
          resolvedHosts: ensureUnique(
            fallbackResults
              .map((record) => record.host)
              .filter((host): host is string => typeof host === 'string' && host.length > 0),
          ),
          errors:
            parseErrors.length > 0
              ? parseErrors
              : ['dnsx output was not valid JSON; returned raw lines.'],
        };
      }

      return buildOutput({
        records: parsedRecords,
        rawOutput,
        domainCount: domainCount,
        recordCount: parsedRecords.length,
        recordTypes,
        resolvers,
        errors: parseErrors,
      });
    }

    const safeResult = outputSchema.safeParse(rawPayload);

    if (!safeResult.success) {
      context.logger.error(`[DNSX] Output validation failed: ${safeResult.error.message}`);

      const rawOutput =
        typeof rawPayload === 'string'
          ? rawPayload
          : JSON.stringify(rawPayload, null, 2).slice(0, 5000);

      return {
        results: [],
        rawOutput,
        domainCount: domainCount,
        recordCount: 0,
        recordTypes,
        resolvers: resolverList,
        resolvedHosts: [],
        errors: ['dnsx output failed schema validation.'],
      };
    }

    return buildOutput({
      records: safeResult.data.results as Array<z.infer<typeof dnsxLineSchema>>,
      rawOutput: safeResult.data.rawOutput,
      domainCount: safeResult.data.domainCount ?? domainCount,
      recordCount: safeResult.data.recordCount ?? safeResult.data.results.length,
      recordTypes: safeResult.data.recordTypes,
      resolvers: safeResult.data.resolvers,
      errors: safeResult.data.errors,
    });
  },
};

componentRegistry.register(definition);

export type { Input as DnsxInput, Output as DnsxOutput };

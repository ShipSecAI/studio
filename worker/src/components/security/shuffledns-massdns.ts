import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ContainerError,
  ValidationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  generateFindingHash,
  analyticsResultSchema,
  type AnalyticsResult,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const DEFAULT_RESOLVERS = ['1.1.1.1', '8.8.8.8'] as const;

// Input schema for Shuffledns + MassDNS component
const inputSchema = inputs({
  domains: port(
    z
      .array(
        z
          .string()
          .min(1)
          .regex(
            /^[\w.-]+$/,
            'Domains may only include letters, numbers, dots, underscores, and hyphens.',
          ),
      )
      .min(1, 'Provide at least one domain.'),
    {
      label: 'Domains',
      description: 'Root domains to enumerate.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
  words: port(
    z.array(z.string().min(1)).optional().describe('Wordlist entries for bruteforce mode'),
    {
      label: 'Wordlist',
      description: 'Wordlist entries for bruteforce mode.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
  seeds: port(z.array(z.string().min(1)).optional().describe('Seed subdomains for resolve mode'), {
    label: 'Seeds',
    description: 'Seed subdomains for resolve mode.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  resolvers: port(
    z
      .array(
        z
          .string()
          .min(1)
          .regex(
            /^[\w.:+-]+$/,
            'Resolver should be a hostname/IP, optionally with port (e.g. 1.1.1.1).',
          ),
      )
      .default([...DEFAULT_RESOLVERS]),
    {
      label: 'Resolvers',
      description: 'DNS resolvers to use for enumeration.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
  trustedResolvers: port(
    z
      .array(
        z
          .string()
          .min(1)
          .regex(
            /^[\w.:+-]+$/,
            'Resolver should be a hostname/IP, optionally with port (e.g. 1.1.1.1).',
          ),
      )
      .default([]),
    {
      label: 'Trusted Resolvers',
      description: 'Trusted DNS resolvers for wildcard detection.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const parameterSchema = parameters({
  mode: param(
    z
      .enum(['bruteforce', 'resolve'])
      .default('resolve')
      .describe('Execution mode: bruteforce with a wordlist or resolve a list of seeds'),
    {
      label: 'Mode',
      editor: 'select',
      description:
        'Choose how shuffledns operates. Resolve mode validates existing subdomains (default), Bruteforce generates permutations from a wordlist.',
      options: [
        { label: 'Resolve (from seeds)', value: 'resolve' },
        { label: 'Bruteforce (with wordlist)', value: 'bruteforce' },
      ],
    },
  ),
  threads: param(
    z.number().int().positive().max(20000).optional().describe('Concurrent massdns resolves (-t)'),
    {
      label: 'Threads (-t)',
      editor: 'number',
      min: 1,
      max: 20000,
    },
  ),
  retries: param(
    z.number().int().min(1).max(20).default(5).describe('Retries for DNS enumeration'),
    {
      label: 'Retries',
      editor: 'number',
      min: 1,
      max: 20,
    },
  ),
  wildcardStrict: param(z.boolean().default(false).describe('Strict wildcard checking (-sw)'), {
    label: 'Strict Wildcard (-sw)',
    editor: 'boolean',
  }),
  wildcardThreads: param(
    z.number().int().positive().max(2000).optional().describe('Concurrent wildcard checks (-wt)'),
    {
      label: 'Wildcard Threads (-wt)',
      editor: 'number',
      min: 1,
      max: 2000,
    },
  ),
  massdnsCmd: param(
    z.string().optional().describe("Optional massdns commands passed via '-mcmd' (e.g. '-i 10')"),
    {
      label: 'MassDNS Extra Cmd (-mcmd)',
      editor: 'text',
    },
  ),
});

const outputSchema = outputs({
  subdomains: port(z.array(z.string()), {
    label: 'Subdomains',
    description: 'Unique subdomains discovered by Shuffledns.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw Shuffledns output for debugging.',
  }),
  domainCount: port(z.number(), {
    label: 'Domain Count',
    description: 'Number of domains enumerated.',
  }),
  subdomainCount: port(z.number(), {
    label: 'Subdomain Count',
    description: 'Number of unique subdomains discovered.',
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
  }),
});

const definition = defineComponent({
  id: 'shipsec.shuffledns.massdns',
  label: 'Shuffledns + MassDNS',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'ghcr.io/shipsecai/shuffledns-massdns:latest',
    // Do not depend on a shell in the image; we'll run the binary directly
    network: 'bridge',
    timeoutSeconds: 300,
    env: { HOME: '/root' },
    // Placeholder; real command is built dynamically in execute()
    command: ['--help'],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Bruteforce or resolve subdomains using Shuffledns with MassDNS. Supports resolvers, trusted resolvers, thread control, retries, and wildcard handling.',
  retryPolicy: {
    maxAttempts: 2,
    initialIntervalSeconds: 5,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
  } satisfies ComponentRetryPolicy,
  ui: {
    slug: 'shuffledns-massdns',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'High-performance subdomain bruteforce/resolve powered by Shuffledns and MassDNS. Accepts inline wordlists or seed lists and optional resolver tuning.',
    documentation:
      'ProjectDiscovery shuffledns with MassDNS backend. See https://github.com/projectdiscovery/shuffledns',
    icon: 'Shuffle',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
  },
  async execute({ inputs, params }, context) {
    const { domains, words, seeds, resolvers, trustedResolvers } = inputs;
    const modeText = params.mode ?? 'resolve';
    if (modeText === 'bruteforce' && (!Array.isArray(words) || words.length === 0)) {
      throw new ValidationError('Wordlist is required when using bruteforce mode', {
        fieldErrors: { words: ['Wordlist is required for bruteforce mode'] },
      });
    }
    if (modeText === 'resolve' && (!Array.isArray(seeds) || seeds.length === 0)) {
      throw new ValidationError('Seed list is required when using resolve mode', {
        fieldErrors: { seeds: ['Seed list is required for resolve mode'] },
      });
    }
    context.logger.info(
      `[Shuffledns] ${modeText} ${domains.length} domain(s) via Shuffledns + MassDNS`,
    );
    context.emitProgress(
      `Running shuffledns (${modeText}) for ${domains.length} domain${domains.length > 1 ? 's' : ''}`,
    );

    // Build command flags in TypeScript
    const flags: string[] = ['-silent'];
    for (const d of domains) {
      flags.push('-d', d);
    }

    // Prepare optional list contents via env to keep shell minimal
    const env: Record<string, string> = {};
    const mkB64 = (lines?: string[]) =>
      Array.isArray(lines) && lines.length > 0
        ? Buffer.from(
            lines
              .map((s) => s.trim())
              .filter(Boolean)
              .join('\n'),
            'utf8',
          ).toString('base64')
        : '';

    // Always specify execution mode explicitly for the image
    flags.push('-mode', modeText);

    if (modeText === 'bruteforce') {
      const wordsB64 = mkB64(words);
      if (wordsB64) env['WORDS_B64'] = wordsB64;
    } else if (modeText === 'resolve') {
      const seedsB64 = mkB64(seeds);
      if (seedsB64) env['SEEDS_B64'] = seedsB64;
    }

    const resolversB64 = mkB64(resolvers);
    const trustedB64 = mkB64(trustedResolvers);
    if (resolversB64) env['RESOLVERS_B64'] = resolversB64;
    if (trustedB64) env['TRUSTED_B64'] = trustedB64;

    if (typeof params.threads === 'number' && params.threads > 0) {
      flags.push('-t', String(params.threads));
    }
    if (typeof params.retries === 'number' && params.retries > 0) {
      flags.push('-retries', String(params.retries));
    }
    if (params.wildcardStrict) {
      flags.push('-sw');
    }
    if (typeof params.wildcardThreads === 'number' && params.wildcardThreads > 0) {
      flags.push('-wt', String(params.wildcardThreads));
    }
    if (params.massdnsCmd && params.massdnsCmd.trim().length > 0) {
      // Keep quotes around the value when passing to CLI
      flags.push('-mcmd', params.massdnsCmd.trim());
    }

    // Write lists to an isolated volume and mount into the container
    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);
    const WORDS = 'words.txt';
    const SEEDS = 'seeds.txt';
    const RESOLVERS = 'resolvers.txt';
    const TRUSTED = 'trusted.txt';

    const writeIfAny = (values: string[] | undefined, filename: string) => {
      if (Array.isArray(values) && values.length > 0) {
        return {
          filename,
          contents: values
            .map((s) => s.trim())
            .filter(Boolean)
            .join('\n'),
        };
      }
      return null;
    };

    const filesToWrite: Record<string, string> = {};
    const wroteWords = writeIfAny(words, WORDS);
    const wroteSeeds = writeIfAny(seeds, SEEDS);
    const wroteResolvers = writeIfAny(resolvers, RESOLVERS);
    const wroteTrusted = writeIfAny(trustedResolvers, TRUSTED);

    [wroteWords, wroteSeeds, wroteResolvers, wroteTrusted].forEach((file) => {
      if (file) {
        filesToWrite[file.filename] = file.contents;
      }
    });

    await volume.initialize(filesToWrite);
    context.logger.info(`[ShufflednsMassdns] Created isolated volume: ${volume.getVolumeName()}`);

    // Attach file flags if present
    if (wroteWords) {
      flags.push('-w', `/input/${WORDS}`);
    }
    if (wroteSeeds) {
      flags.push('-list', `/input/${SEEDS}`);
    }
    if (wroteResolvers) {
      flags.push('-r', `/input/${RESOLVERS}`);
    }
    if (wroteTrusted) {
      flags.push('-tr', `/input/${TRUSTED}`);
    }

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Shuffledns runner must be docker', {
        details: { reason: 'runner_type_mismatch', expected: 'docker', actual: baseRunner.kind },
      });
    }

    const runnerConfig: DockerRunnerConfig = {
      kind: 'docker',
      image: baseRunner.image,
      network: baseRunner.network,
      timeoutSeconds: baseRunner.timeoutSeconds,
      env: { ...(baseRunner.env ?? {}), ...env },
      // Run the binary directly; pass flags as the command args
      entrypoint: 'shuffledns',
      command: flags,
      volumes: [volume.getVolumeConfig('/input', true)],
    };

    let resultUnknown: unknown;
    try {
      const runnerPayload = { ...params, ...inputs };
      resultUnknown = (await runComponentWithRunner(
        runnerConfig,
        async () => ({}) as Output,
        runnerPayload,
        context,
      )) as unknown;
    } finally {
      await volume.cleanup();
      context.logger.info('[ShufflednsMassdns] Cleaned up isolated volume');
    }

    // Shuffledns with -silent prints hostnames (plain text). Normalise string output.
    if (typeof resultUnknown === 'string') {
      const rawOutput = resultUnknown;
      const subdomains = rawOutput
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const deduped = Array.from(new Set(subdomains));

      // Build analytics-ready results with scanner metadata
      const analyticsResults: AnalyticsResult[] = deduped.map((subdomain) => ({
        scanner: 'shuffledns',
        finding_hash: generateFindingHash('subdomain-discovery', subdomain, domains.join(',')),
        severity: 'info' as const,
        asset_key: subdomain,
        subdomain,
        parent_domains: domains,
      }));

      return outputSchema.parse({
        subdomains: deduped,
        results: analyticsResults,
        rawOutput,
        domainCount: domains.length,
        subdomainCount: deduped.length,
      });
    }

    // If container returned an object (e.g., JSON), try to validate/normalise
    if (resultUnknown && typeof resultUnknown === 'object') {
      const parsed = outputSchema.safeParse(resultUnknown);
      if (parsed.success) {
        return parsed.data;
      }

      const maybeRaw =
        'rawOutput' in (resultUnknown as any) ? String((resultUnknown as any).rawOutput ?? '') : '';
      const subdomainsValue = Array.isArray((resultUnknown as any).subdomains)
        ? ((resultUnknown as any).subdomains as unknown[])
            .map((v) => (typeof v === 'string' ? v.trim() : String(v)))
            .filter((v) => v.length > 0)
        : maybeRaw
            .split(/\r?\n/g)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

      const deduped = Array.from(new Set(subdomainsValue));

      // Build analytics-ready results
      const analyticsResults: AnalyticsResult[] = deduped.map((subdomain) => ({
        scanner: 'shuffledns',
        finding_hash: generateFindingHash('subdomain-discovery', subdomain, domains.join(',')),
        severity: 'info' as const,
        asset_key: subdomain,
        subdomain,
        parent_domains: domains,
      }));

      return outputSchema.parse({
        subdomains: deduped,
        results: analyticsResults,
        rawOutput: maybeRaw || subdomainsValue.join('\n'),
        domainCount: domains.length,
        subdomainCount: deduped.length,
      });
    }

    // Fallback – empty
    return outputSchema.parse({
      subdomains: [],
      results: [],
      rawOutput: '',
      domainCount: domains.length,
      subdomainCount: 0,
    });
  },
});

componentRegistry.register(definition);

// Create local type aliases for internal use (inferred types)
type Input = (typeof inputSchema)['__inferred'];
type Output = (typeof outputSchema)['__inferred'];

export type ShufflednsMassdnsInput = typeof inputSchema;
export type ShufflednsMassdnsOutput = typeof outputSchema;

export type { Input as ShufflednsMassdnsInputData, Output as ShufflednsMassdnsOutputData };

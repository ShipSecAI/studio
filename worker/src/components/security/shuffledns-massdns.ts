import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  runComponentWithRunner,
  type DockerRunnerConfig,
} from '@shipsec/component-sdk';

// Input schema for Shuffledns + MassDNS component
const inputSchema = z
  .object({
    domains: z
      .array(
        z
          .string()
          .min(1)
          .regex(/^[\w.-]+$/, 'Domains may only include letters, numbers, dots, underscores, and hyphens.'),
      )
      .min(1, 'Provide at least one domain.'),
    mode: z
      .enum(['bruteforce', 'resolve'])
      .default('bruteforce')
      .describe('Execution mode: bruteforce with a wordlist or resolve a list of seeds'),
    words: z
      .array(z.string().min(1))
      .optional()
      .describe('Wordlist entries for bruteforce mode'),
    seeds: z
      .array(z.string().min(1))
      .optional()
      .describe('Seed subdomains for resolve mode'),
    resolvers: z
      .array(
        z
          .string()
          .min(1)
          .regex(/^[\w.:+-]+$/, 'Resolver should be a hostname/IP, optionally with port (e.g. 1.1.1.1:53).'),
      )
      .default([]),
    trustedResolvers: z
      .array(
        z
          .string()
          .min(1)
          .regex(/^[\w.:+-]+$/, 'Resolver should be a hostname/IP, optionally with port (e.g. 1.1.1.1:53).'),
      )
      .default([]),
    threads: z.number().int().positive().max(20000).optional().describe('Concurrent massdns resolves (-t)'),
    retries: z.number().int().min(1).max(20).default(5).describe('Retries for DNS enumeration'),
    wildcardStrict: z.boolean().default(false).describe('Strict wildcard checking (-sw)'),
    wildcardThreads: z
      .number()
      .int()
      .positive()
      .max(2000)
      .optional()
      .describe('Concurrent wildcard checks (-wt)'),
    massdnsCmd: z
      .string()
      .optional()
      .describe("Optional massdns commands passed via '-mcmd' (e.g. '-i 10')"),
  })
  .refine(
    (val) => (val.mode === 'bruteforce' ? Array.isArray(val.words) && val.words.length > 0 : true),
    { message: 'words are required for bruteforce mode', path: ['words'] },
  )
  .refine(
    (val) => (val.mode === 'resolve' ? Array.isArray(val.seeds) && val.seeds.length > 0 : true),
    { message: 'seeds are required for resolve mode', path: ['seeds'] },
  );

type Input = z.infer<typeof inputSchema>;

type Output = {
  subdomains: string[];
  rawOutput: string;
  domainCount: number;
  subdomainCount: number;
};

const outputSchema: z.ZodType<Output> = z.object({
  subdomains: z.array(z.string()),
  rawOutput: z.string(),
  domainCount: z.number(),
  subdomainCount: z.number(),
});

const definition: ComponentDefinition<Input, Output> = {
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
  inputSchema,
  outputSchema,
  docs:
    'Bruteforce or resolve subdomains using Shuffledns with MassDNS. Supports resolvers, trusted resolvers, thread control, retries, and wildcard handling.',
  metadata: {
    slug: 'shuffledns-massdns',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'High-performance subdomain bruteforce/resolve powered by Shuffledns and MassDNS. Accepts inline wordlists or seed lists and optional resolver tuning.',
    documentation: 'ProjectDiscovery shuffledns with MassDNS backend. See https://github.com/projectdiscovery/shuffledns',
    icon: 'Shuffle',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      { id: 'domains', label: 'Target Domains', dataType: port.list(port.text()), required: true },
      { id: 'words', label: 'Wordlist (bruteforce)', dataType: port.list(port.text()), required: false },
      { id: 'seeds', label: 'Seeds (resolve)', dataType: port.list(port.text()), required: false },
      { id: 'resolvers', label: 'Resolvers', dataType: port.list(port.text()), required: false },
      { id: 'trustedResolvers', label: 'Trusted Resolvers', dataType: port.list(port.text()), required: false },
    ],
    outputs: [
      { id: 'subdomains', label: 'Discovered Subdomains', dataType: port.list(port.text()) },
      { id: 'rawOutput', label: 'Raw Output', dataType: port.text() },
    ],
    parameters: [
      {
        id: 'mode',
        label: 'Mode',
        type: 'select',
        default: 'bruteforce',
        description: 'Choose how shuffledns operates.',
        options: [
          { label: 'Bruteforce (with wordlist)', value: 'bruteforce' },
          { label: 'Resolve (from seeds)', value: 'resolve' },
        ],
      },
      { id: 'threads', label: 'Threads (-t)', type: 'number', min: 1, max: 20000 },
      { id: 'retries', label: 'Retries', type: 'number', min: 1, max: 20, default: 5 },
      { id: 'wildcardStrict', label: 'Strict Wildcard (-sw)', type: 'boolean', default: false },
      { id: 'wildcardThreads', label: 'Wildcard Threads (-wt)', type: 'number', min: 1, max: 2000 },
      { id: 'massdnsCmd', label: 'MassDNS Extra Cmd (-mcmd)', type: 'text' },
    ],
  },
  async execute(input, context) {
    const { domains, mode } = input;
    const modeText = mode ?? 'bruteforce';
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
        ? Buffer.from(lines.map((s) => s.trim()).filter(Boolean).join('\n'), 'utf8').toString('base64')
        : '';

    // Always specify execution mode explicitly for the image
    flags.push('-mode', modeText);

    if (modeText === 'bruteforce') {
      const wordsB64 = mkB64(input.words);
      if (wordsB64) env['WORDS_B64'] = wordsB64;
    } else if (modeText === 'resolve') {
      const seedsB64 = mkB64(input.seeds);
      if (seedsB64) env['SEEDS_B64'] = seedsB64;
    }

    const resolversB64 = mkB64(input.resolvers);
    const trustedB64 = mkB64(input.trustedResolvers);
    if (resolversB64) env['RESOLVERS_B64'] = resolversB64;
    if (trustedB64) env['TRUSTED_B64'] = trustedB64;

    if (typeof input.threads === 'number' && input.threads > 0) {
      flags.push('-t', String(input.threads));
    }
    if (typeof input.retries === 'number' && input.retries > 0) {
      flags.push('-retries', String(input.retries));
    }
    if (input.wildcardStrict) {
      flags.push('-sw');
    }
    if (typeof input.wildcardThreads === 'number' && input.wildcardThreads > 0) {
      flags.push('-wt', String(input.wildcardThreads));
    }
    if (input.massdnsCmd && input.massdnsCmd.trim().length > 0) {
      // Keep quotes around the value when passing to CLI
      flags.push('-mcmd', input.massdnsCmd.trim());
    }

    // Write any provided lists to host temp dir and mount into the container.
    // This avoids requiring a shell inside the image.
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');

    const hostInputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shuffledns-input-'));
    const WORDS = '/input/words.txt';
    const SEEDS = '/input/seeds.txt';
    const RESOLVERS = '/input/resolvers.txt';
    const TRUSTED = '/input/trusted.txt';

    const writeIfAny = async (values: string[] | undefined, file: string) => {
      if (Array.isArray(values) && values.length > 0) {
        const contents = values.map((s) => s.trim()).filter(Boolean).join('\n');
        await fs.writeFile(path.join(hostInputDir, path.basename(file)), contents, 'utf8');
        return true;
      }
      return false;
    };

    const wroteWords = await writeIfAny(input.words, WORDS);
    const wroteSeeds = await writeIfAny(input.seeds, SEEDS);
    const wroteResolvers = await writeIfAny(input.resolvers, RESOLVERS);
    const wroteTrusted = await writeIfAny(input.trustedResolvers, TRUSTED);

    // Attach file flags if present
    if (wroteWords) {
      flags.push('-w', WORDS);
    }
    if (wroteSeeds) {
      flags.push('-list', SEEDS);
    }
    if (wroteResolvers) {
      flags.push('-r', RESOLVERS);
    }
    if (wroteTrusted) {
      flags.push('-tr', TRUSTED);
    }

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new Error('Shuffledns runner must be docker');
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
      volumes: [
        { source: hostInputDir, target: '/input', readOnly: true },
      ],
    };

    let resultUnknown: unknown;
    try {
      resultUnknown = (await runComponentWithRunner(
        runnerConfig,
        async () => ({} as Output),
        input,
        context,
      )) as unknown;
    } finally {
      try {
        await fs.rm(hostInputDir, { recursive: true, force: true });
      } catch {}
    }

    // Shuffledns with -silent prints hostnames (plain text). Normalise string output.
    if (typeof resultUnknown === 'string') {
      const rawOutput = resultUnknown;
      const subdomains = rawOutput
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const deduped = Array.from(new Set(subdomains));

      return outputSchema.parse({
        subdomains: deduped,
        rawOutput,
        domainCount: input.domains.length,
        subdomainCount: deduped.length,
      });
    }

    // If container returned an object (e.g., JSON), try to validate/normalise
    if (resultUnknown && typeof resultUnknown === 'object') {
      const parsed = outputSchema.safeParse(resultUnknown);
      if (parsed.success) {
        return parsed.data;
      }

      const maybeRaw = 'rawOutput' in (resultUnknown as any) ? String((resultUnknown as any).rawOutput ?? '') : '';
      const subdomainsValue = Array.isArray((resultUnknown as any).subdomains)
        ? ((resultUnknown as any).subdomains as unknown[])
            .map((v) => (typeof v === 'string' ? v.trim() : String(v)))
            .filter((v) => v.length > 0)
        : maybeRaw
            .split(/\r?\n/g)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

      return outputSchema.parse({
        subdomains: Array.from(new Set(subdomainsValue)),
        rawOutput: maybeRaw || subdomainsValue.join('\n'),
        domainCount: input.domains.length,
        subdomainCount: subdomainsValue.length,
      });
    }

    // Fallback – empty
    return outputSchema.parse({
      subdomains: [],
      rawOutput: '',
      domainCount: input.domains.length,
      subdomainCount: 0,
    });
  },
};

componentRegistry.register(definition);

export type { Input as ShufflednsMassdnsInput, Output as ShufflednsMassdnsOutput };

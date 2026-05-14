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
  generateFindingHash,
  analyticsResultSchema,
  type AnalyticsResult,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const KATANA_IMAGE = 'ghcr.io/shipsecai/katana:latest';
const KATANA_TIMEOUT_SECONDS = 1800; // 30 minutes
const INPUT_MOUNT_NAME = 'inputs';
const CONTAINER_INPUT_DIR = `/${INPUT_MOUNT_NAME}`;
const TARGET_FILE_NAME = 'targets.txt';
const HEADERS_FILE_NAME = 'headers.txt';

const targetValueSchema = z.preprocess(
  (val) => (typeof val === 'string' ? [val] : val),
  z.array(z.string().min(1)),
);

const inputSchema = inputs({
  urls: port(targetValueSchema.describe('Array of target URLs'), {
    label: 'Target URLs',
    description: 'Array of URLs to crawl.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  headers: port(z.array(z.string()).optional().describe('Custom headers to send with requests'), {
    label: 'Custom Headers',
    description: 'Array of custom headers (e.g. "Authorization: Bearer token").',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
});

const parameterSchema = parameters({
  depth: param(z.number().int().min(1).max(10).default(3), {
    label: 'Crawl Depth',
    editor: 'number',
    min: 1,
    max: 10,
    description: 'Maximum depth to crawl.',
  }),
  jsCrawl: param(z.boolean().default(false), {
    label: 'JS Crawl',
    editor: 'boolean',
    description: 'Enable JS parsing and crawling.',
  }),
  headless: param(z.boolean().default(false), {
    label: 'Headless Mode',
    editor: 'boolean',
    description: 'Enable headless browser for crawling.',
  }),
  threads: param(z.number().int().min(1).max(100).default(10), {
    label: 'Threads',
    editor: 'number',
    min: 1,
    max: 100,
    description: 'Number of concurrent threads for crawling.',
  }),
  timeout: param(z.number().int().min(1).max(300).default(10), {
    label: 'Timeout (seconds)',
    editor: 'number',
    min: 1,
    max: 300,
    description: 'Timeout for requests in seconds.',
  }),
  customFlags: param(
    z.string().trim().optional().describe('Raw CLI flags to append to the katana command'),
    {
      label: 'Custom CLI Flags',
      editor: 'textarea',
      rows: 3,
      placeholder: '-jc -hl',
      description: 'Paste additional katana CLI options exactly as you would on the command line.',
      helpText: 'Flags are appended after the generated options.',
    },
  ),
});

const outputSchema = outputs({
  crawledUrls: port(z.array(z.string()), {
    label: 'Crawled URLs',
    description: 'Array of all URLs discovered during crawling.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw tool output for debugging.',
  }),
  targetCount: port(z.number(), {
    label: 'Target Count',
    description: 'Number of targets scanned.',
  }),
  urlCount: port(z.number(), {
    label: 'URL Count',
    description: 'Number of URLs discovered.',
  }),
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

interface BuildKatanaArgsOptions {
  targetFile: string;
  headersFile?: string;
  depth?: number;
  jsCrawl: boolean;
  headless: boolean;
  threads?: number;
  timeout?: number;
  customFlags: string[];
}

const buildKatanaArgs = (options: BuildKatanaArgsOptions): string[] => {
  const args: string[] = [];

  // Always use silent mode for clean output
  args.push('-silent');

  // Target list file input
  args.push('-list', options.targetFile);

  // Headers file
  if (options.headersFile) {
    args.push('-H', options.headersFile);
  }

  // Depth
  if (typeof options.depth === 'number' && options.depth >= 1) {
    args.push('-d', String(options.depth));
  }

  // Thread count
  if (typeof options.threads === 'number' && options.threads >= 1) {
    args.push('-c', String(options.threads));
  }

  // Timeout
  if (typeof options.timeout === 'number' && options.timeout >= 1) {
    args.push('-timeout', String(options.timeout));
  }

  // JS Crawl
  if (options.jsCrawl) {
    args.push('-jc');
  }

  // Headless mode
  if (options.headless) {
    args.push('-hl');
  }

  // Custom flags
  for (const flag of options.customFlags) {
    if (flag.length > 0) {
      args.push(flag);
    }
  }

  return args;
};

const katanaRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'shipsec.katana.crawl',
  label: 'Katana Web Crawler',
  category: 'security',
  retryPolicy: katanaRetryPolicy,
  runner: {
    kind: 'docker',
    image: KATANA_IMAGE,
    network: 'bridge',
    timeoutSeconds: KATANA_TIMEOUT_SECONDS,
    env: {
      HOME: '/tmp',
    },
    command: [],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs ProjectDiscovery katana to crawl targets and discover URLs.',
  ui: {
    slug: 'katana',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'A next-generation crawling and spidering framework.',
    documentation: 'ProjectDiscovery Katana documentation details configuration and usage.',
    documentationUrl: 'https://github.com/projectdiscovery/katana',
    icon: 'Spider',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: '`katana -list targets.txt -silent`',
    examples: [
      'Crawl discovered subdomains to find endpoints.',
      'Use headless mode for SPA crawling.',
    ],
  },
  toolProvider: {
    kind: 'component',
    name: 'web_crawler',
    description: 'Web crawling and spidering framework (Katana).',
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const { depth, jsCrawl, headless, threads, timeout, customFlags } = parsedParams;

    const trimmedCustomFlags =
      typeof customFlags === 'string' && customFlags.length > 0 ? customFlags : null;
    const customFlagArgs = trimmedCustomFlags ? splitCliArgs(trimmedCustomFlags) : [];

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

    addValue(inputs.urls);
    const targets = Array.from(values);
    const targetCount = targets.length;

    if (targetCount === 0) {
      context.logger.info('[Katana] Skipping execution because no targets were provided.');
      return {
        crawledUrls: [],
        results: [],
        rawOutput: '',
        targetCount: 0,
        urlCount: 0,
      };
    }

    context.logger.info(`[Katana] Crawling ${targetCount} target(s)`);
    context.emitProgress({
      message: `Launching Katana for ${targetCount} target(s)`,
      level: 'info',
      data: { targets },
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Katana runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput: string;
    try {
      const inputFiles: Record<string, string> = {
        [TARGET_FILE_NAME]: targets.join('\n'),
      };

      if (inputs.headers && inputs.headers.length > 0) {
        inputFiles[HEADERS_FILE_NAME] = inputs.headers.join('\n');
      }

      await volume.initialize(inputFiles);

      const katanaArgs = buildKatanaArgs({
        targetFile: `${CONTAINER_INPUT_DIR}/${TARGET_FILE_NAME}`,
        headersFile:
          inputs.headers && inputs.headers.length > 0
            ? `${CONTAINER_INPUT_DIR}/${HEADERS_FILE_NAME}`
            : undefined,
        depth: depth ?? 3,
        jsCrawl: jsCrawl ?? false,
        headless: headless ?? false,
        threads: threads ?? 10,
        timeout: timeout ?? 10,
        customFlags: customFlagArgs,
      });

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds ?? KATANA_TIMEOUT_SECONDS,
        env: { ...(baseRunner.env ?? {}) },
        command: [...(baseRunner.command ?? []), ...katanaArgs],
        volumes: [volume.getVolumeConfig(CONTAINER_INPUT_DIR, true)],
      };

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { targets },
          context,
        );

        if (typeof result === 'string') {
          rawOutput = result;
        } else if (result && typeof result === 'object' && 'rawOutput' in result) {
          rawOutput = String((result as any).rawOutput ?? '');
        } else {
          rawOutput = '';
        }
      } catch (error) {
        if (error instanceof ContainerError) {
          const details = (error as any).details as Record<string, unknown> | undefined;
          const capturedStdout = details?.stdout;
          if (typeof capturedStdout === 'string' && capturedStdout.trim().length > 0) {
            context.logger.warn(
              `[Katana] Container exited non-zero but produced output. Preserving partial results.`,
            );
            rawOutput = capturedStdout;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    } finally {
      await volume.cleanup();
    }

    const lines = rawOutput
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const crawledUrlsSet = new Set(lines);
    const crawledUrls = Array.from(crawledUrlsSet);
    const urlCount = crawledUrls.length;

    context.logger.info(`[Katana] Discovered ${urlCount} URLs across ${targetCount} target(s)`);

    const analyticsResults: AnalyticsResult[] = crawledUrls.map((url) => ({
      scanner: 'katana',
      finding_hash: generateFindingHash('crawled-url', url, targets.join(',')),
      severity: 'info' as const,
      asset_key: url,
      url,
      parent_targets: targets,
    }));

    return {
      crawledUrls,
      rawOutput,
      targetCount,
      urlCount,
      results: analyticsResults,
    };
  },
});

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];

export type KatanaInput = typeof inputSchema;
export type KatanaOutput = typeof outputSchema;

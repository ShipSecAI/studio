import { z } from 'zod';
import {
  ComponentRetryPolicy,
  ServiceError,
  analyticsResultSchema,
  componentRegistry,
  defineComponent,
  generateFindingHash,
  inputs,
  outputs,
  param,
  parameters,
  port,
  runComponentWithRunner,
  type AnalyticsResult,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const KATANA_IMAGE = 'projectdiscovery/katana:latest';
const KATANA_TIMEOUT_SECONDS = (() => {
  const raw = process.env.KATANA_TIMEOUT_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return 600;
  }
  return parsed;
})();

const INPUT_MOUNT_NAME = 'inputs';
const CONTAINER_INPUT_DIR = `/${INPUT_MOUNT_NAME}`;
const TARGET_FILE_NAME = 'targets.txt';

const strategyEnum = z.enum(['depth-first', 'breadth-first']);
const fieldScopeEnum = z.enum(['rdn', 'fqdn', 'dn']);
const knownFileEnum = z.enum(['robotstxt', 'sitemapxml']);

const inputSchema = inputs({
  targets: port(
    z
      .array(z.string().trim().min(1, 'Target cannot be empty'))
      .describe('URLs to crawl with Katana'),
    {
      label: 'Targets',
      description: 'URLs to crawl. Katana accepts HTTP(S) targets and target lists.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const parameterSchema = parameters({
  depth: param(z.number().int().min(1).max(20).default(3), {
    label: 'Depth',
    editor: 'number',
    min: 1,
    max: 20,
    description: 'Maximum crawl depth.',
  }),
  strategy: param(strategyEnum.default('depth-first'), {
    label: 'Strategy',
    editor: 'select',
    description: 'URL visit strategy.',
    options: [
      { label: 'Depth first', value: 'depth-first' },
      { label: 'Breadth first', value: 'breadth-first' },
    ],
  }),
  fieldScope: param(fieldScopeEnum.default('rdn'), {
    label: 'Field Scope',
    editor: 'select',
    description: 'Default scope field for limiting crawled URLs.',
    options: [
      { label: 'Root domain', value: 'rdn' },
      { label: 'FQDN', value: 'fqdn' },
      { label: 'Domain name', value: 'dn' },
    ],
  }),
  noScope: param(z.boolean().default(false), {
    label: 'Disable Scope',
    editor: 'boolean',
    description: 'Disable host-based default scope.',
  }),
  displayOutOfScope: param(z.boolean().default(false), {
    label: 'Display Out-of-scope URLs',
    editor: 'boolean',
    description: 'Include external endpoints found during scoped crawling.',
  }),
  jsCrawl: param(z.boolean().default(false), {
    label: 'JavaScript Crawl',
    editor: 'boolean',
    description: 'Enable endpoint parsing and crawling inside JavaScript files.',
  }),
  formExtraction: param(z.boolean().default(false), {
    label: 'Form Extraction',
    editor: 'boolean',
    description: 'Extract form, input, textarea, and select elements in JSONL output.',
  }),
  xhrExtraction: param(z.boolean().default(false), {
    label: 'XHR Extraction',
    editor: 'boolean',
    description: 'Extract XHR request URL and method details in JSONL output.',
  }),
  knownFiles: param(z.array(knownFileEnum).default(['robotstxt', 'sitemapxml']), {
    label: 'Known Files',
    editor: 'multi-select',
    description: 'Crawl known files such as robots.txt and sitemap.xml.',
    options: [
      { label: 'robots.txt', value: 'robotstxt' },
      { label: 'sitemap.xml', value: 'sitemapxml' },
    ],
  }),
  concurrency: param(z.number().int().min(1).max(500).default(10), {
    label: 'Concurrency',
    editor: 'number',
    min: 1,
    max: 500,
    description: 'Number of concurrent fetchers.',
  }),
  parallelism: param(z.number().int().min(1).max(500).default(10), {
    label: 'Parallelism',
    editor: 'number',
    min: 1,
    max: 500,
    description: 'Number of concurrent inputs to process.',
  }),
  rateLimit: param(z.number().int().min(1).max(1000).default(150), {
    label: 'Rate Limit',
    editor: 'number',
    min: 1,
    max: 1000,
    description: 'Maximum requests per second.',
  }),
  timeout: param(z.number().int().min(1).max(300).default(10), {
    label: 'Request Timeout',
    editor: 'number',
    min: 1,
    max: 300,
    description: 'Request timeout in seconds.',
  }),
  retries: param(z.number().int().min(0).max(10).default(1), {
    label: 'Retries',
    editor: 'number',
    min: 0,
    max: 10,
    description: 'Retry count for failed requests.',
  }),
  crawlDuration: param(
    z
      .string()
      .trim()
      .regex(/^\d+[smhd]$/, 'Use a Katana duration such as 30s, 5m, 1h, or 1d.')
      .optional(),
    {
      label: 'Crawl Duration',
      editor: 'text',
      placeholder: '5m',
      description: 'Maximum duration to crawl each target.',
    },
  ),
  maxResponseSize: param(z.number().int().min(1).optional(), {
    label: 'Max Response Size',
    editor: 'number',
    min: 1,
    description: 'Maximum response size to read, in bytes.',
  }),
  headers: param(
    z
      .array(z.string().trim().min(1))
      .default([])
      .describe('Custom headers in "Header: value" format'),
    {
      label: 'Headers',
      editor: 'json',
      description: 'Custom headers or cookies to include with each request.',
    },
  ),
  matchRegex: param(z.array(z.string().trim().min(1)).default([]), {
    label: 'Match Regex',
    editor: 'json',
    description: 'Only keep URLs matching these regular expressions.',
  }),
  filterRegex: param(z.array(z.string().trim().min(1)).default([]), {
    label: 'Filter Regex',
    editor: 'json',
    description: 'Drop URLs matching these regular expressions.',
  }),
  extensionMatch: param(z.array(z.string().trim().min(1)).default([]), {
    label: 'Extension Match',
    editor: 'json',
    description: 'Only keep URLs with these extensions, e.g. ["php", "js"].',
  }),
  extensionFilter: param(z.array(z.string().trim().min(1)).default([]), {
    label: 'Extension Filter',
    editor: 'json',
    description: 'Drop URLs with these extensions, e.g. ["png", "css"].',
  }),
  proxy: param(z.string().trim().optional(), {
    label: 'Proxy',
    editor: 'text',
    placeholder: 'socks5://127.0.0.1:9050',
    description: 'HTTP or SOCKS proxy to use for crawling.',
  }),
  omitRaw: param(z.boolean().default(true), {
    label: 'Omit Raw HTTP',
    editor: 'boolean',
    description: 'Omit raw requests and responses from JSONL output.',
  }),
  omitBody: param(z.boolean().default(true), {
    label: 'Omit Body',
    editor: 'boolean',
    description: 'Omit response bodies from JSONL output.',
  }),
  customFlags: param(
    z.string().trim().optional().describe('Raw CLI flags appended to the Katana invocation'),
    {
      label: 'Custom CLI Flags',
      editor: 'textarea',
      rows: 3,
      placeholder: '-headless -automatic-form-fill',
      description: 'Paste additional Katana CLI options exactly as you would on the command line.',
    },
  ),
});

const endpointSchema = z.object({
  url: z.string(),
  source: z.string().nullable(),
  tag: z.string().nullable(),
  attribute: z.string().nullable(),
  method: z.string().nullable(),
  host: z.string().nullable(),
  path: z.string().nullable(),
  fqdn: z.string().nullable(),
  statusCode: z.number().nullable(),
  contentLength: z.number().nullable(),
  timestamp: z.string().nullable(),
  raw: z.record(z.string(), z.unknown()).nullable(),
});

type Endpoint = z.infer<typeof endpointSchema>;

const outputSchema = outputs({
  endpoints: port(z.array(endpointSchema), {
    label: 'Crawled Endpoints',
    description: 'Structured Katana crawl results.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  urls: port(z.array(z.string()), {
    label: 'URLs',
    description: 'Deduplicated crawled URLs.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw Katana JSONL/plain output.',
  }),
  targetCount: port(z.number(), {
    label: 'Target Count',
    description: 'Number of crawl targets supplied.',
  }),
  endpointCount: port(z.number(), {
    label: 'Endpoint Count',
    description: 'Number of endpoints returned after deduplication.',
  }),
  options: port(
    z.object({
      depth: z.number(),
      strategy: strategyEnum,
      fieldScope: fieldScopeEnum,
      noScope: z.boolean(),
      displayOutOfScope: z.boolean(),
      jsCrawl: z.boolean(),
      formExtraction: z.boolean(),
      xhrExtraction: z.boolean(),
      knownFiles: z.array(knownFileEnum),
      concurrency: z.number(),
      parallelism: z.number(),
      rateLimit: z.number(),
      timeout: z.number(),
      retries: z.number(),
      crawlDuration: z.string().nullable(),
      maxResponseSize: z.number().nullable(),
      omitRaw: z.boolean(),
      omitBody: z.boolean(),
    }),
    {
      label: 'Options',
      description: 'Effective Katana options applied during the crawl.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
  }),
});

type Output = z.infer<typeof outputSchema>;
type Params = z.infer<typeof parameterSchema>;

const katanaRunnerOutputSchema = z.object({
  stdout: z.string().optional().default(''),
  raw: z.string().optional().default(''),
  stderr: z.string().optional().default(''),
  exitCode: z.number().optional().default(0),
});

const katanaRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'shipsec.katana.crawl',
  label: 'Katana Web Crawler',
  category: 'security',
  retryPolicy: katanaRetryPolicy,
  runner: {
    kind: 'docker',
    image: KATANA_IMAGE,
    entrypoint: 'katana',
    network: 'bridge',
    timeoutSeconds: KATANA_TIMEOUT_SECONDS,
    env: {
      HOME: '/tmp',
    },
    command: ['-version'],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run ProjectDiscovery Katana to crawl web applications and collect discovered endpoints for downstream security workflows.',
  ui: {
    slug: 'katana',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Crawl web applications and collect discovered endpoints using ProjectDiscovery Katana.',
    documentation:
      'ProjectDiscovery Katana documentation covers crawl scope, JavaScript parsing, JSONL output, and filtering flags.',
    documentationUrl: 'https://github.com/projectdiscovery/katana',
    icon: 'Network',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Crawl HTTPx live URLs before passing discovered endpoints into Nuclei.',
      'Extract forms and XHR endpoints from in-scope applications during recon workflows.',
    ],
  },
  toolProvider: {
    kind: 'component',
    name: 'web_crawler',
    description: 'Web crawling and endpoint discovery tool (Katana).',
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const targets = Array.from(
      new Set(inputs.targets.map((target) => target.trim()).filter((target) => target.length > 0)),
    );

    if (targets.length === 0) {
      context.logger.info('[Katana] Skipping crawl because no targets were provided.');
      return outputSchema.parse(createOutput([], '', [], parsedParams));
    }

    context.logger.info(
      `[Katana] Crawling ${targets.length} target(s) with depth=${parsedParams.depth}, strategy=${parsedParams.strategy}, jsCrawl=${parsedParams.jsCrawl}`,
    );
    context.emitProgress({
      message: 'Launching Katana crawl...',
      level: 'info',
      data: { targets: targets.slice(0, 5) },
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    try {
      await volume.initialize({
        [TARGET_FILE_NAME]: targets.join('\n'),
      });

      const katanaArgs = buildKatanaArgs(parsedParams);
      const runnerConfig = {
        ...definition.runner,
        entrypoint: 'katana',
        command: katanaArgs,
        volumes: [volume.getVolumeConfig(CONTAINER_INPUT_DIR, true)],
      };

      const rawRunnerResult = await runComponentWithRunner(
        runnerConfig,
        async () => ({}) as Output,
        { targets, ...parsedParams },
        context,
      );

      let runnerOutput = '';

      if (rawRunnerResult && typeof rawRunnerResult === 'object') {
        const parsedOutput = outputSchema.safeParse(rawRunnerResult);
        if (parsedOutput.success) {
          return parsedOutput.data;
        }

        const parsedRunnerResult = katanaRunnerOutputSchema.safeParse(rawRunnerResult);
        if (parsedRunnerResult.success) {
          const { exitCode, stderr, stdout, raw } = parsedRunnerResult.data;
          if (exitCode !== 0) {
            const message = stderr
              ? `Katana exited with code ${exitCode}: ${stderr}`
              : `Katana exited with code ${exitCode}`;
            throw new ServiceError(message, {
              details: { exitCode, stderr, tool: 'katana' },
            });
          }
          runnerOutput = raw || stdout || '';
        } else {
          runnerOutput =
            'rawOutput' in rawRunnerResult
              ? String((rawRunnerResult as Record<string, unknown>).rawOutput ?? '')
              : JSON.stringify(rawRunnerResult);
        }
      } else if (typeof rawRunnerResult === 'string') {
        runnerOutput = rawRunnerResult;
      }

      const endpoints = parseKatanaOutput(runnerOutput);
      context.logger.info(
        `[Katana] Completed crawl with ${endpoints.length} endpoint(s) from ${targets.length} target(s).`,
      );

      return outputSchema.parse(createOutput(targets, runnerOutput, endpoints, parsedParams));
    } finally {
      await volume.cleanup();
      context.logger.info('[Katana] Cleaned up isolated volume.');
    }
  },
});

function createOutput(
  targets: string[],
  rawOutput: string,
  endpoints: Endpoint[],
  params: Params,
): Output {
  const urls = Array.from(new Set(endpoints.map((endpoint) => endpoint.url)));
  const results: AnalyticsResult[] = endpoints.map((endpoint) => ({
    scanner: 'katana',
    finding_hash: generateFindingHash('web-crawl-endpoint', endpoint.url, endpoint.source ?? ''),
    severity: 'info' as const,
    asset_key: endpoint.url,
    url: endpoint.url,
    host: endpoint.host,
    path: endpoint.path,
    source: endpoint.source,
    tag: endpoint.tag,
    attribute: endpoint.attribute,
    method: endpoint.method,
    status_code: endpoint.statusCode,
  }));

  return {
    endpoints,
    urls,
    rawOutput,
    targetCount: targets.length,
    endpointCount: endpoints.length,
    options: {
      depth: params.depth,
      strategy: params.strategy,
      fieldScope: params.fieldScope,
      noScope: params.noScope,
      displayOutOfScope: params.displayOutOfScope,
      jsCrawl: params.jsCrawl,
      formExtraction: params.formExtraction,
      xhrExtraction: params.xhrExtraction,
      knownFiles: params.knownFiles,
      concurrency: params.concurrency,
      parallelism: params.parallelism,
      rateLimit: params.rateLimit,
      timeout: params.timeout,
      retries: params.retries,
      crawlDuration: params.crawlDuration ?? null,
      maxResponseSize: params.maxResponseSize ?? null,
      omitRaw: params.omitRaw,
      omitBody: params.omitBody,
    },
    results,
  };
}

function buildKatanaArgs(params: Params): string[] {
  const args = [
    '-list',
    `${CONTAINER_INPUT_DIR}/${TARGET_FILE_NAME}`,
    '-jsonl',
    '-silent',
    '-no-color',
    '-depth',
    String(params.depth),
    '-strategy',
    params.strategy,
    '-concurrency',
    String(params.concurrency),
    '-parallelism',
    String(params.parallelism),
    '-rate-limit',
    String(params.rateLimit),
    '-timeout',
    String(params.timeout),
    '-retry',
    String(params.retries),
  ];

  if (params.noScope) {
    args.push('-no-scope');
  } else {
    args.push('-field-scope', params.fieldScope);
  }

  if (params.displayOutOfScope) {
    args.push('-display-out-scope');
  }
  if (params.jsCrawl) {
    args.push('-js-crawl');
  }
  if (params.formExtraction) {
    args.push('-form-extraction');
  }
  if (params.xhrExtraction) {
    args.push('-xhr-extraction');
  }
  if (params.knownFiles.length > 0) {
    args.push('-known-files', params.knownFiles.join(','));
  }
  if (params.crawlDuration) {
    args.push('-crawl-duration', params.crawlDuration);
  }
  if (typeof params.maxResponseSize === 'number') {
    args.push('-max-response-size', String(params.maxResponseSize));
  }
  if (params.proxy) {
    args.push('-proxy', params.proxy);
  }
  if (params.omitRaw) {
    args.push('-omit-raw');
  }
  if (params.omitBody) {
    args.push('-omit-body');
  }

  for (const header of params.headers) {
    args.push('-headers', header);
  }
  for (const regex of params.matchRegex) {
    args.push('-match-regex', regex);
  }
  for (const regex of params.filterRegex) {
    args.push('-filter-regex', regex);
  }
  for (const extension of params.extensionMatch) {
    args.push('-extension-match', extension);
  }
  for (const extension of params.extensionFilter) {
    args.push('-extension-filter', extension);
  }

  const customArgs = params.customFlags ? splitCliArgs(params.customFlags) : [];
  args.push(...customArgs);

  return args;
}

function splitCliArgs(input: string): string[] {
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
      quote = ch;
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
}

function parseKatanaOutput(raw: string): Endpoint[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const endpoints: Endpoint[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let parsed: Record<string, unknown> | null = null;
    try {
      const payload = JSON.parse(trimmed) as unknown;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        parsed = payload as Record<string, unknown>;
      }
    } catch {
      parsed = null;
    }

    const endpoint = parsed ? endpointFromRecord(parsed) : endpointFromPlainLine(trimmed);
    if (!endpoint) {
      continue;
    }

    const key = [
      endpoint.url,
      endpoint.source ?? '',
      endpoint.tag ?? '',
      endpoint.attribute ?? '',
    ].join('\u0000');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    endpoints.push(endpoint);
  }

  return endpoints;
}

function endpointFromPlainLine(line: string): Endpoint | null {
  if (!/^https?:\/\//i.test(line)) {
    return null;
  }

  return {
    url: line,
    source: null,
    tag: null,
    attribute: null,
    method: null,
    host: hostFromUrl(line),
    path: pathFromUrl(line),
    fqdn: hostFromUrl(line),
    statusCode: null,
    contentLength: null,
    timestamp: null,
    raw: null,
  };
}

function endpointFromRecord(payload: Record<string, unknown>): Endpoint | null {
  const url = firstString(
    payload.url,
    payload.endpoint,
    payload.request_url,
    payload.requestUrl,
    payload.raw,
  );
  if (!url) {
    return null;
  }

  const candidate: Endpoint = {
    url,
    source: normaliseString(payload.source),
    tag: normaliseString(payload.tag),
    attribute: normaliseString(payload.attribute),
    method: normaliseString(payload.method),
    host: normaliseString(payload.host) ?? hostFromUrl(url),
    path: normaliseString(payload.path) ?? pathFromUrl(url),
    fqdn: normaliseString(payload.fqdn) ?? hostFromUrl(url),
    statusCode: normaliseNumber(
      payload.status_code ?? payload.statusCode ?? payload['status-code'],
    ),
    contentLength: normaliseNumber(
      payload.content_length ?? payload.contentLength ?? payload['content-length'],
    ),
    timestamp: normaliseString(payload.timestamp),
    raw: payload,
  };

  const parsed = endpointSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalised = normaliseString(value);
    if (normalised) {
      return normalised;
    }
  }
  return null;
}

function normaliseString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normaliseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hostFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function pathFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

componentRegistry.register(definition);

export type KatanaInput = typeof inputSchema;
export type KatanaOutput = typeof outputSchema;
export type KatanaEndpoint = Endpoint;

export { buildKatanaArgs, parseKatanaOutput };

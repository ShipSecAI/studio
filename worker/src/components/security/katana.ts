import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  runComponentWithRunner,
  ServiceError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const inputSchema = inputs({
  targets: port(
    z
      .array(z.string().min(1, 'Target URL cannot be empty'))
      .describe('URLs to crawl for endpoint discovery'),
    {
      label: 'Target URLs',
      description: 'URLs to crawl for endpoint and asset discovery.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const parameterSchema = parameters({
  depth: param(
    z.number().int().positive().max(10).optional().default(3).describe('Maximum depth to crawl'),
    {
      label: 'Crawl Depth',
      editor: 'number',
      min: 1,
      max: 10,
      description: 'Maximum depth to crawl (default: 3).',
    },
  ),
  jsCrawl: param(
    z
      .boolean()
      .optional()
      .default(false)
      .describe('Enable endpoint parsing/crawling in JavaScript files'),
    {
      label: 'JS Crawl',
      editor: 'boolean',
      description: 'Enable endpoint parsing and crawling in JavaScript files.',
    },
  ),
  headless: param(
    z.boolean().optional().default(false).describe('Enable headless browser crawling'),
    {
      label: 'Headless Mode',
      editor: 'boolean',
      description: 'Enable headless hybrid crawling for JavaScript-heavy sites.',
    },
  ),
  concurrency: param(
    z.number().int().positive().max(50).optional().describe('Number of concurrent fetchers'),
    {
      label: 'Concurrency',
      editor: 'number',
      min: 1,
      max: 50,
      description: 'Number of concurrent fetchers to use (default: 10).',
    },
  ),
  parallelism: param(
    z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .describe('Number of concurrent inputs to process'),
    {
      label: 'Parallelism',
      editor: 'number',
      min: 1,
      max: 50,
      description: 'Number of concurrent inputs to process (default: 10).',
    },
  ),
  rateLimit: param(
    z.number().int().positive().max(500).optional().describe('Maximum requests per second'),
    {
      label: 'Rate Limit',
      editor: 'number',
      min: 1,
      max: 500,
      description: 'Maximum requests to send per second (default: 150).',
    },
  ),
  timeout: param(
    z.number().int().positive().max(120).optional().describe('Request timeout in seconds'),
    {
      label: 'Timeout',
      editor: 'number',
      min: 1,
      max: 120,
      description: 'Time to wait for request in seconds (default: 10).',
    },
  ),
  crawlDuration: param(
    z.string().trim().optional().describe('Maximum duration to crawl (e.g., "5m", "1h")'),
    {
      label: 'Crawl Duration',
      editor: 'text',
      placeholder: '5m',
      description: 'Maximum duration to crawl the target (s, m, h, d).',
    },
  ),
  knownFiles: param(
    z
      .enum(['all', 'robotstxt', 'sitemapxml'])
      .optional()
      .describe('Enable crawling of known files'),
    {
      label: 'Known Files',
      editor: 'select',
      options: [
        { label: 'All', value: 'all' },
        { label: 'robots.txt', value: 'robotstxt' },
        { label: 'sitemap.xml', value: 'sitemapxml' },
      ],
      description: 'Enable crawling of known files (robots.txt, sitemap.xml).',
    },
  ),
  extensionMatch: param(
    z
      .string()
      .trim()
      .optional()
      .describe('Comma-separated extensions to match (e.g., "php,html,js")'),
    {
      label: 'Extension Match',
      editor: 'text',
      placeholder: 'php,html,js',
      description: 'Match output for given extensions.',
    },
  ),
  extensionFilter: param(
    z
      .string()
      .trim()
      .optional()
      .describe('Comma-separated extensions to filter out (e.g., "png,css,jpg")'),
    {
      label: 'Extension Filter',
      editor: 'text',
      placeholder: 'png,css,jpg',
      description: 'Filter output for given extensions.',
    },
  ),
  scope: param(
    z
      .string()
      .trim()
      .optional()
      .describe('Scope field: dn (domain), rdn (root domain), fqdn (full domain)'),
    {
      label: 'Field Scope',
      editor: 'select',
      options: [
        { label: 'Root Domain (rdn)', value: 'rdn' },
        { label: 'Domain (dn)', value: 'dn' },
        { label: 'Full Domain (fqdn)', value: 'fqdn' },
      ],
      description: 'Pre-defined scope field (default: rdn).',
    },
  ),
  ignoreQueryParams: param(
    z
      .boolean()
      .optional()
      .default(false)
      .describe('Ignore crawling same path with different query parameters'),
    {
      label: 'Ignore Query Params',
      editor: 'boolean',
      description: 'Ignore crawling same path with different query-param values.',
    },
  ),
  formExtraction: param(
    z.boolean().optional().default(false).describe('Extract form elements in output'),
    {
      label: 'Form Extraction',
      editor: 'boolean',
      description: 'Extract form, input, textarea & select elements in output.',
    },
  ),
  xhrExtraction: param(
    z.boolean().optional().default(false).describe('Extract XHR request URLs and methods'),
    {
      label: 'XHR Extraction',
      editor: 'boolean',
      description: 'Extract XHR request URL and method in output (headless only).',
    },
  ),
});

const endpointSchema = z.object({
  url: z.string(),
  method: z.string().nullable(),
  endpoint: z.string().nullable(),
  source: z.string().nullable(),
  tag: z.string().nullable(),
  attribute: z.string().nullable(),
  timestamp: z.string().nullable(),
});

type Endpoint = z.infer<typeof endpointSchema>;

const outputSchema = outputs({
  endpoints: port(z.array(endpointSchema), {
    label: 'Discovered Endpoints',
    description: 'Structured endpoint data from crawling.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  urls: port(z.array(z.string()), {
    label: 'URLs',
    description: 'List of discovered URLs.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw katana JSON lines for downstream processing.',
  }),
  targetCount: port(z.number(), {
    label: 'Target Count',
    description: 'Number of targets crawled.',
  }),
  endpointCount: port(z.number(), {
    label: 'Endpoint Count',
    description: 'Number of endpoints discovered.',
  }),
  options: port(
    z.object({
      depth: z.number(),
      jsCrawl: z.boolean(),
      headless: z.boolean(),
      concurrency: z.number().nullable(),
      parallelism: z.number().nullable(),
      rateLimit: z.number().nullable(),
      timeout: z.number().nullable(),
      crawlDuration: z.string().nullable(),
      knownFiles: z.string().nullable(),
      extensionMatch: z.string().nullable(),
      extensionFilter: z.string().nullable(),
      scope: z.string().nullable(),
      ignoreQueryParams: z.boolean(),
      formExtraction: z.boolean(),
      xhrExtraction: z.boolean(),
    }),
    {
      label: 'Options',
      description: 'Effective katana options applied during the run.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
});

const katanaRunnerOutputSchema = z.object({
  results: z.array(z.unknown()).optional().default([]),
  raw: z.string().optional().default(''),
  stderr: z.string().optional().default(''),
  exitCode: z.number().optional().default(0),
});

const dockerTimeoutSeconds = (() => {
  const raw = process.env.KATANA_TIMEOUT_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return 600; // 10 minutes default
  }
  return parsed;
})();

const definition = defineComponent({
  id: 'shipsec.katana.crawl',
  label: 'Katana Web Crawler',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'projectdiscovery/katana:v1.4.0',
    entrypoint: 'katana',
    network: 'bridge',
    timeoutSeconds: dockerTimeoutSeconds,
    command: ['-version'],
    env: {
      HOME: '/root',
    },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run ProjectDiscovery Katana to crawl websites and discover endpoints, assets, and JavaScript files.',
  retryPolicy: {
    maxAttempts: 2,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
  } satisfies ComponentRetryPolicy,
  ui: {
    slug: 'katana',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Crawl websites to discover endpoints and assets using ProjectDiscovery Katana.',
    documentation:
      'ProjectDiscovery Katana documentation details CLI flags for web crawling, JavaScript parsing, and headless browsing.',
    documentationUrl: 'https://github.com/projectdiscovery/katana',
    icon: 'Globe',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`katana -u https://example.com -jc -d 3 -jsonl` - Crawl a website with JavaScript parsing enabled.',
    examples: [
      'Discover hidden endpoints and API routes from JavaScript files.',
      'Map application structure before security testing.',
      'Extract forms and input fields for parameter fuzzing.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);

    const runnerParams = {
      targets: inputs.targets,
      depth: parsedParams.depth ?? 3,
      jsCrawl: parsedParams.jsCrawl ?? false,
      headless: parsedParams.headless ?? false,
      concurrency: parsedParams.concurrency,
      parallelism: parsedParams.parallelism,
      rateLimit: parsedParams.rateLimit,
      timeout: parsedParams.timeout,
      crawlDuration: parsedParams.crawlDuration?.trim() || undefined,
      knownFiles: parsedParams.knownFiles,
      extensionMatch: parsedParams.extensionMatch?.trim() || undefined,
      extensionFilter: parsedParams.extensionFilter?.trim() || undefined,
      scope: parsedParams.scope,
      ignoreQueryParams: parsedParams.ignoreQueryParams ?? false,
      formExtraction: parsedParams.formExtraction ?? false,
      xhrExtraction: parsedParams.xhrExtraction ?? false,
    };

    if (runnerParams.targets.length === 0) {
      context.logger.info('[katana] Skipping crawl because no targets were provided.');
      const emptyOutput: Output = {
        endpoints: [],
        urls: [],
        rawOutput: '',
        targetCount: 0,
        endpointCount: 0,
        options: {
          depth: runnerParams.depth,
          jsCrawl: runnerParams.jsCrawl,
          headless: runnerParams.headless,
          concurrency: runnerParams.concurrency ?? null,
          parallelism: runnerParams.parallelism ?? null,
          rateLimit: runnerParams.rateLimit ?? null,
          timeout: runnerParams.timeout ?? null,
          crawlDuration: runnerParams.crawlDuration ?? null,
          knownFiles: runnerParams.knownFiles ?? null,
          extensionMatch: runnerParams.extensionMatch ?? null,
          extensionFilter: runnerParams.extensionFilter ?? null,
          scope: runnerParams.scope ?? null,
          ignoreQueryParams: runnerParams.ignoreQueryParams,
          formExtraction: runnerParams.formExtraction,
          xhrExtraction: runnerParams.xhrExtraction,
        },
      };
      return outputSchema.parse(emptyOutput);
    }

    context.logger.info(
      `[katana] Crawling ${runnerParams.targets.length} target(s) with depth=${runnerParams.depth}, jsCrawl=${runnerParams.jsCrawl}, headless=${runnerParams.headless}`,
    );

    context.emitProgress({
      message: 'Launching Katana crawler…',
      level: 'info',
      data: { targets: runnerParams.targets.slice(0, 5) },
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    try {
      const targets = Array.from(
        new Set(
          runnerParams.targets.map((target) => target.trim()).filter((target) => target.length > 0),
        ),
      );

      await volume.initialize({
        'targets.txt': targets.join('\n'),
      });

      const katanaArgs: string[] = ['-jsonl', '-silent', '-list', '/inputs/targets.txt'];

      katanaArgs.push('-depth', String(runnerParams.depth));

      if (runnerParams.jsCrawl) {
        katanaArgs.push('-jc');
      }
      if (runnerParams.headless) {
        katanaArgs.push('-headless', '-no-sandbox');
      }
      if (typeof runnerParams.concurrency === 'number') {
        katanaArgs.push('-concurrency', String(runnerParams.concurrency));
      }
      if (typeof runnerParams.parallelism === 'number') {
        katanaArgs.push('-parallelism', String(runnerParams.parallelism));
      }
      if (typeof runnerParams.rateLimit === 'number') {
        katanaArgs.push('-rate-limit', String(runnerParams.rateLimit));
      }
      if (typeof runnerParams.timeout === 'number') {
        katanaArgs.push('-timeout', String(runnerParams.timeout));
      }
      if (runnerParams.crawlDuration) {
        katanaArgs.push('-crawl-duration', runnerParams.crawlDuration);
      }
      if (runnerParams.knownFiles) {
        katanaArgs.push('-known-files', runnerParams.knownFiles);
      }
      if (runnerParams.extensionMatch) {
        katanaArgs.push('-extension-match', runnerParams.extensionMatch);
      }
      if (runnerParams.extensionFilter) {
        katanaArgs.push('-extension-filter', runnerParams.extensionFilter);
      }
      if (runnerParams.scope) {
        katanaArgs.push('-field-scope', runnerParams.scope);
      }
      if (runnerParams.ignoreQueryParams) {
        katanaArgs.push('-ignore-query-params');
      }
      if (runnerParams.formExtraction) {
        katanaArgs.push('-form-extraction');
      }
      if (runnerParams.xhrExtraction && runnerParams.headless) {
        katanaArgs.push('-xhr-extraction');
      }

      const runnerConfig = {
        ...definition.runner,
        entrypoint: 'katana',
        command: katanaArgs,
        volumes: [volume.getVolumeConfig('/inputs', true)],
      };

      const rawRunnerResult = await runComponentWithRunner(
        runnerConfig,
        async () => ({}) as Output,
        runnerParams,
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
          const exitCode = parsedRunnerResult.data.exitCode ?? 0;
          const stderr = parsedRunnerResult.data.stderr ?? '';

          if (exitCode !== 0) {
            const errorMessage = stderr
              ? `katana exited with code ${exitCode}: ${stderr}`
              : `katana exited with code ${exitCode}`;
            throw new ServiceError(errorMessage, {
              details: { exitCode, stderr, tool: 'katana' },
            });
          }

          runnerOutput = parsedRunnerResult.data.raw ?? '';
        } else {
          runnerOutput =
            'rawOutput' in rawRunnerResult
              ? String((rawRunnerResult as Record<string, unknown>).rawOutput ?? '')
              : JSON.stringify(rawRunnerResult);
        }
      } else if (typeof rawRunnerResult === 'string') {
        runnerOutput = rawRunnerResult;
      }

      const { endpoints, urls } = parseKatanaOutput(runnerOutput);

      context.logger.info(
        `[katana] Completed crawl with ${endpoints.length} endpoint(s) from ${runnerParams.targets.length} target(s)`,
      );

      const output: Output = {
        endpoints,
        urls,
        rawOutput: runnerOutput,
        targetCount: runnerParams.targets.length,
        endpointCount: endpoints.length,
        options: {
          depth: runnerParams.depth,
          jsCrawl: runnerParams.jsCrawl,
          headless: runnerParams.headless,
          concurrency: runnerParams.concurrency ?? null,
          parallelism: runnerParams.parallelism ?? null,
          rateLimit: runnerParams.rateLimit ?? null,
          timeout: runnerParams.timeout ?? null,
          crawlDuration: runnerParams.crawlDuration ?? null,
          knownFiles: runnerParams.knownFiles ?? null,
          extensionMatch: runnerParams.extensionMatch ?? null,
          extensionFilter: runnerParams.extensionFilter ?? null,
          scope: runnerParams.scope ?? null,
          ignoreQueryParams: runnerParams.ignoreQueryParams,
          formExtraction: runnerParams.formExtraction,
          xhrExtraction: runnerParams.xhrExtraction,
        },
      };

      return outputSchema.parse(output);
    } finally {
      await volume.cleanup();
      context.logger.info('[katana] Cleaned up isolated volume.');
    }
  },
});

function parseKatanaOutput(raw: string): { endpoints: Endpoint[]; urls: string[] } {
  if (!raw || raw.trim().length === 0) {
    return { endpoints: [], urls: [] };
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const endpoints: Endpoint[] = [];
  const urls: string[] = [];

  for (const line of lines) {
    let payload: any = null;
    try {
      payload = JSON.parse(line);
    } catch {
      // If not JSON, treat as plain URL
      if (line.startsWith('http://') || line.startsWith('https://')) {
        urls.push(line);
        endpoints.push({
          url: line,
          method: null,
          endpoint: null,
          source: null,
          tag: null,
          attribute: null,
          timestamp: null,
        });
      }
      continue;
    }

    if (!payload || typeof payload !== 'object') {
      continue;
    }

    const urlValue = (() => {
      if (typeof payload.request?.endpoint === 'string' && payload.request.endpoint.length > 0) {
        return payload.request.endpoint;
      }
      if (typeof payload.endpoint === 'string' && payload.endpoint.length > 0) {
        return payload.endpoint;
      }
      if (typeof payload.url === 'string' && payload.url.length > 0) {
        return payload.url;
      }
      return null;
    })();

    if (!urlValue) {
      continue;
    }

    urls.push(urlValue);

    const endpoint: Endpoint = {
      url: urlValue,
      method: normaliseString(payload.request?.method ?? payload.method),
      endpoint: normaliseString(payload.request?.endpoint ?? payload.endpoint),
      source: normaliseString(payload.request?.source ?? payload.source),
      tag: normaliseString(payload.request?.tag ?? payload.tag),
      attribute: normaliseString(payload.request?.attribute ?? payload.attribute),
      timestamp: normaliseString(payload.timestamp),
    };

    const parsedEndpoint = endpointSchema.safeParse(endpoint);
    if (parsedEndpoint.success) {
      endpoints.push(parsedEndpoint.data);
    }
  }

  return { endpoints, urls: Array.from(new Set(urls)) };
}

function normaliseString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];

export type InputShape = typeof inputSchema;
export type OutputShape = typeof outputSchema;
export type KatanaInput = (typeof inputSchema)['__inferred'];
export type KatanaOutput = Output;

export { parseKatanaOutput };

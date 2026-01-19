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
      .array(z.string().min(1, 'Target cannot be empty'))
      .describe('Hostnames or URLs to probe for HTTP services'),
    {
      label: 'Targets',
      description: 'Hostnames or URLs to probe for HTTP services.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const parameterSchema = parameters({
  ports: param(
    z
      .string()
      .trim()
      .min(1, 'Ports value cannot be empty')
      .optional()
      .describe('Comma-separated list of ports to probe (e.g. "80,443,8080")'),
    {
      label: 'Ports',
      editor: 'text',
      placeholder: '80,443,8080',
      description: 'Comma-separated ports to probe instead of the default httpx list.',
    },
  ),
  statusCodes: param(
    z
      .string()
      .trim()
      .min(1, 'Status codes cannot be empty')
      .optional()
      .describe('Comma-separated list of acceptable HTTP status codes (e.g. "200,301,302")'),
    {
      label: 'Status Codes',
      editor: 'text',
      placeholder: '200,301,302',
      description: 'Return only results whose HTTP status codes match the provided list.',
    },
  ),
  threads: param(
    z
      .number()
      .int()
      .positive()
      .max(1000)
      .optional()
      .describe('Number of concurrent threads to use when probing'),
    {
      label: 'Threads',
      editor: 'number',
      min: 1,
      max: 1000,
      description: 'Concurrency level for probes.',
    },
  ),
  followRedirects: param(
    z
      .boolean()
      .optional()
      .default(false)
      .describe('Follow HTTP redirects when probing each target'),
    {
      label: 'Follow Redirects',
      editor: 'boolean',
      description: 'Request redirect targets and return the final destination metadata.',
    },
  ),
  tlsProbe: param(
    z
      .boolean()
      .optional()
      .default(false)
      .describe('Probe TLS endpoints for HTTPS support even if not explicitly specified'),
    {
      label: 'TLS Probe',
      editor: 'boolean',
      description: 'Probe TLS endpoints for HTTPS even if a scheme is not specified.',
    },
  ),
  preferHttps: param(
    z
      .boolean()
      .optional()
      .default(false)
      .describe('Prefer HTTPS scheme when both HTTP and HTTPS are available'),
    {
      label: 'Prefer HTTPS',
      editor: 'boolean',
      description: 'Prefer HTTPS scheme when both HTTP and HTTPS respond.',
    },
  ),
  path: param(
    z
      .string()
      .trim()
      .min(1, 'Path cannot be empty')
      .optional()
      .describe('Specific path to append to each target during probing (e.g. "/admin")'),
    {
      label: 'Path',
      editor: 'text',
      placeholder: '/admin',
      description: 'Append a specific path to each target during probing.',
    },
  ),
});

const findingSchema = z.object({
  url: z.string(),
  host: z.string().nullable(),
  input: z.string().nullable(),
  statusCode: z.number().nullable(),
  title: z.string().nullable(),
  webserver: z.string().nullable(),
  contentLength: z.number().nullable(),
  responseTime: z.number().nullable(),
  port: z.number().nullable(),
  scheme: z.string().nullable(),
  finalUrl: z.string().nullable(),
  location: z.string().nullable(),
  ip: z.string().nullable(),
  technologies: z.array(z.string()),
  chainStatus: z.array(z.number()),
  timestamp: z.string().nullable(),
});

type Finding = z.infer<typeof findingSchema>;

const outputSchema = outputs({
  results: port(z.array(findingSchema), {
    label: 'HTTP Responses',
    description: 'Structured metadata for each responsive endpoint.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw httpx JSON lines for downstream processing.',
  }),
  targetCount: port(z.number(), {
    label: 'Target Count',
    description: 'Number of targets scanned.',
  }),
  resultCount: port(z.number(), {
    label: 'Result Count',
    description: 'Number of responsive endpoints returned.',
  }),
  options: port(
    z.object({
      followRedirects: z.boolean(),
      tlsProbe: z.boolean(),
      preferHttps: z.boolean(),
      ports: z.string().nullable(),
      statusCodes: z.string().nullable(),
      threads: z.number().nullable(),
      path: z.string().nullable(),
    }),
    {
      label: 'Options',
      description: 'Effective httpx options applied during the run.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
});

const httpxRunnerOutputSchema = z.object({
  results: z.array(z.unknown()).optional().default([]),
  raw: z.string().optional().default(''),
  stderr: z.string().optional().default(''),
  exitCode: z.number().optional().default(0),
});

const dockerTimeoutSeconds = (() => {
  const raw = process.env.HTTPX_TIMEOUT_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return 240;
  }
  return parsed;
})();

const definition = defineComponent({
  id: 'shipsec.httpx.scan',
  label: 'httpx Web Probe',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'projectdiscovery/httpx:v1.7.4',
    entrypoint: 'httpx',
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
  docs: 'Run ProjectDiscovery httpx to probe hosts for live HTTP services, capturing metadata like status codes and titles.',
  retryPolicy: {
    maxAttempts: 2,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
  } satisfies ComponentRetryPolicy,
  ui: {
    slug: 'httpx',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Identify live HTTP endpoints and collect response metadata using ProjectDiscovery httpx.',
    documentation:
      'ProjectDiscovery httpx documentation details CLI flags for probing hosts, extracting metadata, and filtering responses.',
    documentationUrl: 'https://github.com/projectdiscovery/httpx',
    icon: 'Globe',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`httpx -l targets.txt -json -status-code 200,301` - Probe discovered hosts and capture responsive endpoints with matching status codes.',
    examples: [
      'Validate Subfinder or Amass discoveries by probing for live web services.',
      'Filter Naabu results to identify hosts exposing HTTP/S services on uncommon ports.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);

    const trimmedPorts = parsedParams.ports?.trim();
    const trimmedStatusCodes = parsedParams.statusCodes?.trim();
    const trimmedPath = parsedParams.path?.trim();

    const runnerParams = {
      ...parsedParams,
      targets: inputs.targets,
      ports: trimmedPorts && trimmedPorts.length > 0 ? trimmedPorts : undefined,
      statusCodes:
        trimmedStatusCodes && trimmedStatusCodes.length > 0 ? trimmedStatusCodes : undefined,
      path: trimmedPath && trimmedPath.length > 0 ? trimmedPath : undefined,
      followRedirects: parsedParams.followRedirects ?? false,
      tlsProbe: parsedParams.tlsProbe ?? false,
      preferHttps: parsedParams.preferHttps ?? false,
    };

    if (runnerParams.targets.length === 0) {
      context.logger.info('[httpx] Skipping httpx probe because no targets were provided.');
      const emptyOutput: Output = {
        results: [],
        rawOutput: '',
        targetCount: 0,
        resultCount: 0,
        options: {
          followRedirects: runnerParams.followRedirects ?? false,
          tlsProbe: runnerParams.tlsProbe ?? false,
          preferHttps: runnerParams.preferHttps ?? false,
          ports: runnerParams.ports ?? null,
          statusCodes: runnerParams.statusCodes ?? null,
          threads: runnerParams.threads ?? null,
          path: runnerParams.path ?? null,
        },
      };

      return outputSchema.parse(emptyOutput);
    }

    context.logger.info(
      `[httpx] Probing ${runnerParams.targets.length} target(s) with options: ports=${runnerParams.ports ?? 'default'}, statusCodes=${runnerParams.statusCodes ?? 'any'}, threads=${runnerParams.threads ?? 'auto'}, followRedirects=${runnerParams.followRedirects}, tlsProbe=${runnerParams.tlsProbe}, preferHttps=${runnerParams.preferHttps}, path=${runnerParams.path ?? 'none'}`,
    );

    context.emitProgress({
      message: 'Launching httpx probe…',
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

      const httpxArgs: string[] = ['-json', '-silent', '-l', '/inputs/targets.txt', '-stream'];

      if (runnerParams.ports) {
        httpxArgs.push('-ports', runnerParams.ports);
      }
      if (runnerParams.statusCodes) {
        httpxArgs.push('-status-code', runnerParams.statusCodes);
      }
      if (typeof runnerParams.threads === 'number') {
        httpxArgs.push('-threads', String(runnerParams.threads));
      }
      if (runnerParams.path) {
        httpxArgs.push('-path', runnerParams.path);
      }
      if (runnerParams.followRedirects) {
        httpxArgs.push('-follow-redirects');
      }
      if (runnerParams.tlsProbe) {
        httpxArgs.push('-tls-probe');
      }
      if (runnerParams.preferHttps) {
        httpxArgs.push('-prefer-https');
      }

      const runnerConfig = {
        ...definition.runner,
        entrypoint: 'httpx',
        command: httpxArgs,
        volumes: [volume.getVolumeConfig('/inputs', true)],
      };

      const rawRunnerResult = await runComponentWithRunner(
        runnerConfig,
        async () => ({}) as Output,
        runnerParams,
        context,
      );

      let runnerOutput = '';

      // First, check if it's already a valid Output (from docker runner normalization)
      if (rawRunnerResult && typeof rawRunnerResult === 'object') {
        const parsedOutput = outputSchema.safeParse(rawRunnerResult);
        if (parsedOutput.success) {
          return parsedOutput.data;
        }

        // Check if it's a runner output format (with exitCode)
        const parsedRunnerResult = httpxRunnerOutputSchema.safeParse(rawRunnerResult);
        if (parsedRunnerResult.success) {
          const exitCode = parsedRunnerResult.data.exitCode ?? 0;
          const stderr = parsedRunnerResult.data.stderr ?? '';

          // Check exit code and throw if non-zero
          if (exitCode !== 0) {
            const errorMessage = stderr
              ? `httpx exited with code ${exitCode}: ${stderr}`
              : `httpx exited with code ${exitCode}`;
            throw new ServiceError(errorMessage, {
              details: { exitCode, stderr, tool: 'httpx' },
            });
          }

          runnerOutput = parsedRunnerResult.data.raw ?? '';
        } else {
          // Extract raw output from object
          runnerOutput =
            'rawOutput' in rawRunnerResult
              ? String((rawRunnerResult as Record<string, unknown>).rawOutput ?? '')
              : JSON.stringify(rawRunnerResult);
        }
      } else if (typeof rawRunnerResult === 'string') {
        runnerOutput = rawRunnerResult;
      }

      const findings = parseHttpxOutput(runnerOutput);

      context.logger.info(
        `[httpx] Completed probe with ${findings.length} result(s) from ${runnerParams.targets.length} target(s)`,
      );

      const output: Output = {
        results: findings,
        rawOutput: runnerOutput,
        targetCount: runnerParams.targets.length,
        resultCount: findings.length,
        options: {
          followRedirects: runnerParams.followRedirects,
          tlsProbe: runnerParams.tlsProbe,
          preferHttps: runnerParams.preferHttps,
          ports: runnerParams.ports ?? null,
          statusCodes: runnerParams.statusCodes ?? null,
          threads: runnerParams.threads ?? null,
          path: runnerParams.path ?? null,
        },
      };

      return outputSchema.parse(output);
    } finally {
      await volume.cleanup();
      context.logger.info('[httpx] Cleaned up isolated volume.');
    }
  },
});

function parseHttpxOutput(raw: string): Finding[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const findings: Finding[] = [];

  for (const line of lines) {
    let payload: any = null;
    try {
      payload = JSON.parse(line);
    } catch {
      payload = null;
    }

    if (!payload || typeof payload !== 'object') {
      continue;
    }

    const urlValue = (() => {
      if (typeof payload.url === 'string' && payload.url.length > 0) {
        return payload.url;
      }
      if (typeof payload['final-url'] === 'string' && payload['final-url'].length > 0) {
        return payload['final-url'];
      }
      if (typeof payload.final_url === 'string' && payload.final_url.length > 0) {
        return payload.final_url;
      }
      if (typeof payload.input === 'string' && payload.input.length > 0) {
        return payload.input;
      }
      if (typeof payload.host === 'string' && payload.host.length > 0) {
        return payload.host;
      }
      return null;
    })();

    if (!urlValue) {
      continue;
    }

    const technologies = Array.isArray(payload.tech)
      ? payload.tech.filter(
          (item: unknown): item is string => typeof item === 'string' && item.length > 0,
        )
      : [];

    const chainStatus = Array.isArray(payload['chain-status'])
      ? payload['chain-status']
          .map((value: unknown) => {
            if (typeof value === 'number' && Number.isFinite(value)) {
              return value;
            }
            if (typeof value === 'string' && value.trim().length > 0) {
              const parsed = Number.parseInt(value, 10);
              return Number.isFinite(parsed) ? parsed : null;
            }
            return null;
          })
          .filter((value: number | null): value is number => value !== null)
      : [];

    const findingCandidate: Finding = {
      url: urlValue,
      host: typeof payload.host === 'string' && payload.host.length > 0 ? payload.host : null,
      input: typeof payload.input === 'string' && payload.input.length > 0 ? payload.input : null,
      statusCode: normaliseNumber(payload['status-code'] ?? payload.status_code),
      title: normaliseString(payload.title),
      webserver: normaliseString(payload.webserver),
      contentLength: normaliseNumber(payload['content-length'] ?? payload.content_length),
      responseTime: normaliseNumber(payload['response-time'] ?? payload.response_time),
      port: normaliseNumber(payload.port),
      scheme: normaliseString(payload.scheme),
      finalUrl: normaliseString(payload['final-url'] ?? payload.final_url),
      location: normaliseString(payload.location),
      ip: normaliseString(payload.ip),
      technologies,
      chainStatus,
      timestamp: normaliseString(payload.timestamp),
    };

    const parsedFinding = findingSchema.safeParse(findingCandidate);
    if (parsedFinding.success) {
      findings.push(parsedFinding.data);
    }
  }

  return findings;
}

function normaliseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normaliseString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

componentRegistry.register(definition);

// Create local type aliases for backward compatibility
type Input = (typeof inputSchema)['__inferred'];
type Output = (typeof outputSchema)['__inferred'];

export type InputShape = typeof inputSchema;
export type OutputShape = typeof outputSchema;
export type { Input as HttpxInput, Output as HttpxOutput };

export { parseHttpxOutput };

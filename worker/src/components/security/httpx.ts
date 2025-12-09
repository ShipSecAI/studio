import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  runComponentWithRunner,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const inputSchema = z.object({
  targets: z
    .array(z.string().min(1, 'Target cannot be empty'))
    .describe('Hostnames or URLs to probe for HTTP services'),
  followRedirects: z
    .boolean()
    .optional()
    .default(false)
    .describe('Follow HTTP redirects when probing each target'),
  tlsProbe: z
    .boolean()
    .optional()
    .default(false)
    .describe('Probe TLS endpoints for HTTPS support even if not explicitly specified'),
  preferHttps: z
    .boolean()
    .optional()
    .default(false)
    .describe('Prefer HTTPS scheme when both HTTP and HTTPS are available'),
  ports: z
    .string()
    .trim()
    .min(1, 'Ports value cannot be empty')
    .optional()
    .describe('Comma-separated list of ports to probe (e.g. "80,443,8080")'),
  statusCodes: z
    .string()
    .trim()
    .min(1, 'Status codes cannot be empty')
    .optional()
    .describe('Comma-separated list of acceptable HTTP status codes (e.g. "200,301,302")'),
  threads: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .describe('Number of concurrent threads to use when probing'),
  path: z
    .string()
    .trim()
    .min(1, 'Path cannot be empty')
    .optional()
    .describe('Specific path to append to each target during probing (e.g. "/admin")'),
});

type Input = z.infer<typeof inputSchema>;

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

const outputSchema = z.object({
  results: z.array(findingSchema),
  rawOutput: z.string(),
  targetCount: z.number(),
  resultCount: z.number(),
  options: z.object({
    followRedirects: z.boolean(),
    tlsProbe: z.boolean(),
    preferHttps: z.boolean(),
    ports: z.string().nullable(),
    statusCodes: z.string().nullable(),
    threads: z.number().nullable(),
    path: z.string().nullable(),
  }),
});

type Output = z.infer<typeof outputSchema>;

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

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.httpx.scan',
  label: 'httpx Web Probe',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'projectdiscovery/httpx:latest',
    entrypoint: 'httpx',
    network: 'bridge',
    timeoutSeconds: dockerTimeoutSeconds,
    command: ['-version'],
    env: {
      HOME: '/root',
    },
  },
  inputSchema,
  outputSchema,
  docs: 'Run ProjectDiscovery httpx to probe hosts for live HTTP services, capturing metadata like status codes and titles.',
  metadata: {
    slug: 'httpx',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Identify live HTTP endpoints and collect response metadata using ProjectDiscovery httpx.',
    documentation: 'ProjectDiscovery httpx documentation details CLI flags for probing hosts, extracting metadata, and filtering responses.',
    documentationUrl: 'https://github.com/projectdiscovery/httpx',
    icon: 'Globe',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: '`httpx -l targets.txt -json -status-code 200,301` - Probe discovered hosts and capture responsive endpoints with matching status codes.',
    inputs: [
      {
        id: 'targets',
        label: 'Targets',
        dataType: port.list(port.text()),
        required: true,
        description: 'Hostnames or URLs to probe for HTTP services.',
      },
    ],
    outputs: [
      {
        id: 'results',
        label: 'HTTP Responses',
        dataType: port.list(port.json()),
        description: 'Structured metadata for each responsive endpoint.',
      },
      {
        id: 'rawOutput',
        label: 'Raw Output',
        dataType: port.text(),
        description: 'Raw httpx JSON lines for downstream processing.',
      },
    ],
    examples: [
      'Validate Subfinder or Amass discoveries by probing for live web services.',
      'Filter Naabu results to identify hosts exposing HTTP/S services on uncommon ports.',
    ],
    parameters: [
      {
        id: 'ports',
        label: 'Ports',
        type: 'text',
        placeholder: '80,443,8080',
        description: 'Comma-separated ports to probe instead of the default httpx list.',
      },
      {
        id: 'statusCodes',
        label: 'Status Codes',
        type: 'text',
        placeholder: '200,301,302',
        description: 'Return only results whose HTTP status codes match the provided list.',
      },
      {
        id: 'threads',
        label: 'Threads',
        type: 'number',
        min: 1,
        max: 1000,
        description: 'Concurrency level for probes.',
      },
      {
        id: 'followRedirects',
        label: 'Follow Redirects',
        type: 'boolean',
        default: false,
        description: 'Request redirect targets and return the final destination metadata.',
      },
      {
        id: 'tlsProbe',
        label: 'TLS Probe',
        type: 'boolean',
        default: false,
        description: 'Probe TLS endpoints for HTTPS even if a scheme is not specified.',
      },
      {
        id: 'preferHttps',
        label: 'Prefer HTTPS',
        type: 'boolean',
        default: false,
        description: 'Prefer HTTPS scheme when both HTTP and HTTPS respond.',
      },
      {
        id: 'path',
        label: 'Path',
        type: 'text',
        placeholder: '/admin',
        description: 'Append a specific path to each target during probing.',
      },
    ],
  },
  async execute(rawInput, context) {
    const parsedInput = inputSchema.parse(rawInput);

    const trimmedPorts = parsedInput.ports?.trim();
    const trimmedStatusCodes = parsedInput.statusCodes?.trim();
    const trimmedPath = parsedInput.path?.trim();

    const runnerParams: Input = {
      ...parsedInput,
      ports: trimmedPorts && trimmedPorts.length > 0 ? trimmedPorts : undefined,
      statusCodes: trimmedStatusCodes && trimmedStatusCodes.length > 0 ? trimmedStatusCodes : undefined,
      path: trimmedPath && trimmedPath.length > 0 ? trimmedPath : undefined,
      followRedirects: parsedInput.followRedirects ?? false,
      tlsProbe: parsedInput.tlsProbe ?? false,
      preferHttps: parsedInput.preferHttps ?? false,
    };

    if (runnerParams.targets.length === 0) {
      context.logger.info('[httpx] Skipping httpx probe because no targets were provided.');
      const emptyOutput: Output = {
        results: [],
        rawOutput: '',
        targetCount: 0,
        resultCount: 0,
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
          runnerParams.targets
            .map(target => target.trim())
            .filter(target => target.length > 0),
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

      if (typeof rawRunnerResult === 'string') {
        runnerOutput = rawRunnerResult;
      } else if (rawRunnerResult && typeof rawRunnerResult === 'object') {
        const parsedOutput = outputSchema.safeParse(rawRunnerResult);
        if (parsedOutput.success) {
          return parsedOutput.data;
        }

        runnerOutput =
          'rawOutput' in rawRunnerResult
            ? String((rawRunnerResult as Record<string, unknown>).rawOutput ?? '')
            : JSON.stringify(rawRunnerResult);
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
};

function parseHttpxOutput(raw: string): Finding[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

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
      ? payload.tech.filter((item: unknown): item is string => typeof item === 'string' && item.length > 0)
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

export type { Input as HttpxInput, Output as HttpxOutput };

export { parseHttpxOutput };

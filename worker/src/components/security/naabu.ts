import { z } from 'zod';
import {
  componentRegistry,
  runComponentWithRunner,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  generateFindingHash,
  analyticsResultSchema,
  type AnalyticsResult,
  type DockerRunnerConfig,
  ContainerError,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const NAABU_IMAGE = 'ghcr.io/shipsecai/naabu:latest';
const INPUT_MOUNT_NAME = 'inputs';
const CONTAINER_INPUT_DIR = `/${INPUT_MOUNT_NAME}`;
const TARGETS_FILE_NAME = 'targets.txt';

const inputSchema = inputs({
  targets: port(
    z
      .array(z.string().min(1, 'Target cannot be empty'))
      .min(1, 'Provide at least one target')
      .describe('Hostnames or IP addresses to scan for open ports'),
    {
      label: 'Targets',
      description: 'Hostnames or IP addresses to scan for open ports.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const parameterSchema = parameters({
  ports: param(
    z
      .string()
      .trim()
      .min(1, 'Port list cannot be empty')
      .optional()
      .describe('Specific ports or ranges to scan (e.g. "80,443,1000-2000")'),
    {
      label: 'Ports',
      editor: 'text',
      placeholder: '80,443,1000-2000',
      description: 'Custom ports or ranges to scan (comma-separated).',
    },
  ),
  topPorts: param(
    z.number().int().positive().max(65535).optional().describe('Scan the top N most common ports'),
    {
      label: 'Top Ports',
      editor: 'number',
      min: 1,
      max: 65535,
      description: 'Scan the top N most common ports.',
      helpText: 'Leave blank to scan Naabu default port set.',
    },
  ),
  excludePorts: param(
    z
      .string()
      .trim()
      .min(1, 'Exclude ports cannot be empty')
      .optional()
      .describe('Comma-separated list of ports to exclude'),
    {
      label: 'Exclude Ports',
      editor: 'text',
      placeholder: '21,22,25',
      description: 'Ports that should be excluded from the scan.',
    },
  ),
  rate: param(
    z
      .number()
      .int()
      .positive()
      .max(1_000_000)
      .optional()
      .describe('Maximum number of packets per second'),
    {
      label: 'Rate (pps)',
      editor: 'number',
      min: 1,
      max: 1000000,
      description: 'Maximum packets per second to send during scanning.',
      helpText: 'Tune to match available bandwidth. Defaults to Naabu managed rate.',
    },
  ),
  retries: param(
    z.number().int().min(0).max(10).optional().default(1).describe('Number of retries per port'),
    {
      label: 'Retries',
      editor: 'number',
      min: 0,
      max: 10,
      description: 'Number of retry attempts per port.',
    },
  ),
  enablePing: param(
    z
      .boolean()
      .optional()
      .default(false)
      .describe('Use ICMP/SYN ping probe to discover live hosts before scanning'),
    {
      label: 'Ping Probes',
      editor: 'boolean',
      description: 'Send ICMP/SYN probes to detect live hosts before scanning.',
    },
  ),
  interface: param(
    z
      .string()
      .trim()
      .min(1, 'Interface cannot be empty')
      .optional()
      .describe('Network interface to use from inside the container'),
    {
      label: 'Interface',
      editor: 'text',
      description: 'Specific network interface to use inside the container.',
      placeholder: 'eth0',
    },
  ),
});

const findingSchema = z.object({
  host: z.string(),
  ip: z.string().nullable(),
  port: z.number(),
  protocol: z.string(),
});

const outputSchema = outputs({
  findings: port(z.array(findingSchema), {
    label: 'Findings',
    description: 'List of open ports discovered by Naabu.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw Naabu console output.',
  }),
  targetCount: port(z.number(), {
    label: 'Target Count',
    description: 'Number of targets scanned.',
  }),
  openPortCount: port(z.number(), {
    label: 'Open Port Count',
    description: 'Total number of open ports discovered.',
  }),
  options: port(
    z.object({
      ports: z.string().nullable(),
      topPorts: z.number().nullable(),
      excludePorts: z.string().nullable(),
      rate: z.number().nullable(),
      retries: z.number(),
      enablePing: z.boolean(),
      interface: z.string().nullable(),
    }),
    {
      label: 'Options',
      description: 'Effective Naabu scan options applied for the run.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
  }),
});

type Finding = z.infer<typeof findingSchema>;

const dockerTimeoutSeconds = (() => {
  const raw = process.env.NAABU_TIMEOUT_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return 180;
  }
  return parsed;
})();

interface BuildNaabuArgsOptions {
  targetFile: string;
  ports?: string;
  topPorts?: number;
  excludePorts?: string;
  rate?: number;
  retries?: number;
  enablePing: boolean;
  interface?: string;
}

/**
 * Build Naabu CLI arguments in TypeScript.
 * Follows the Dynamic Args Pattern from component-development.mdx
 */
const buildNaabuArgs = (options: BuildNaabuArgsOptions): string[] => {
  const args: string[] = [];

  // Target list file
  args.push('-list', options.targetFile);

  // JSON output for structured parsing
  args.push('-json');

  // Silent mode for clean output
  args.push('-silent');

  // Stream mode to prevent output buffering (critical for PTY)
  args.push('-stream');

  // Port configuration
  if (options.ports) {
    args.push('-p', options.ports);
  }
  if (typeof options.topPorts === 'number' && options.topPorts >= 1) {
    args.push('-top-ports', String(options.topPorts));
  }
  if (options.excludePorts) {
    args.push('-exclude-ports', options.excludePorts);
  }

  // Rate and retries
  if (typeof options.rate === 'number' && options.rate >= 1) {
    args.push('-rate', String(options.rate));
  }
  if (typeof options.retries === 'number') {
    args.push('-retries', String(options.retries));
  }

  // Ping probes
  if (options.enablePing) {
    args.push('-ping');
  }

  // Network interface
  if (options.interface) {
    args.push('-interface', options.interface);
  }

  return args;
};

const definition = defineComponent({
  id: 'shipsec.naabu.scan',
  label: 'Naabu Port Scan',
  category: 'security',
  runner: {
    kind: 'docker',
    image: NAABU_IMAGE,
    // The naabu image is distroless (no shell available).
    // Use the image's default entrypoint directly and pass args via command.
    network: 'bridge',
    timeoutSeconds: dockerTimeoutSeconds,
    env: {
      // Image runs as nonroot — /root is not writable.
      // Use /tmp so naabu can create its config dir.
      HOME: '/tmp',
    },
    command: [],
    stdinJson: false,
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run ProjectDiscovery Naabu to identify open TCP ports across a list of targets.',
  ui: {
    slug: 'naabu',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Fast active port scanning using ProjectDiscovery Naabu.',
    documentation:
      'ProjectDiscovery Naabu documentation covers usage, CLI flags, and configuration examples.',
    documentationUrl: 'https://github.com/projectdiscovery/naabu',
    icon: 'Radar',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`naabu -host scanme.sh -top-ports 100` - Quickly identifies the most common open TCP ports on a target host.',
    examples: [
      'Scan Amass or Subfinder discoveries to identify exposed services.',
      'Target a custom list of IPs with tuned rate and retries for stealth scans.',
    ],
  },
  toolProvider: {
    kind: 'component',
    name: 'port_scan',
    description: 'Fast TCP port scanner (Naabu).',
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const trimmedPorts = parsedParams.ports?.trim();
    const trimmedExclude = parsedParams.excludePorts?.trim();
    const trimmedInterface = parsedParams.interface?.trim();

    const effectiveOptions = {
      ports: trimmedPorts && trimmedPorts.length > 0 ? trimmedPorts : undefined,
      topPorts: parsedParams.topPorts,
      excludePorts: trimmedExclude && trimmedExclude.length > 0 ? trimmedExclude : undefined,
      rate: parsedParams.rate,
      retries: parsedParams.retries ?? 1,
      enablePing: parsedParams.enablePing ?? false,
      interface: trimmedInterface && trimmedInterface.length > 0 ? trimmedInterface : undefined,
    };

    context.logger.info(
      `[Naabu] Scanning ${inputs.targets.length} target(s) with options: ports=${effectiveOptions.ports ?? 'default'}, topPorts=${effectiveOptions.topPorts ?? 'default'}, rate=${effectiveOptions.rate ?? 'auto'}, retries=${effectiveOptions.retries}`,
    );

    context.emitProgress({
      message: 'Launching Naabu port scan…',
      level: 'info',
      data: { targets: inputs.targets.slice(0, 5) },
    });

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);
    const baseRunner = definition.runner;

    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Naabu runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    let rawOutput: string;
    try {
      // Write targets to input file
      const inputFiles: Record<string, string> = {
        [TARGETS_FILE_NAME]: inputs.targets.join('\n'),
      };

      const volumeName = await volume.initialize(inputFiles);
      context.logger.info(`[Naabu] Created isolated volume: ${volumeName}`);

      // Build naabu CLI arguments in TypeScript
      const naabuArgs = buildNaabuArgs({
        targetFile: `${CONTAINER_INPUT_DIR}/${TARGETS_FILE_NAME}`,
        ...effectiveOptions,
      });

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds ?? dockerTimeoutSeconds,
        env: { ...(baseRunner.env ?? {}) },
        stdinJson: false,
        // Pass naabu CLI args directly (image default entrypoint is naabu)
        command: [...(baseRunner.command ?? []), ...naabuArgs],
        volumes: [volume.getVolumeConfig(CONTAINER_INPUT_DIR, true)],
      };

      try {
        const result = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          {},
          context,
        );
        rawOutput = typeof result === 'string' ? result : '';
      } catch (error) {
        // Naabu can exit non-zero when some probes fail,
        // but may still have produced valid output. Preserve partial results.
        if (error instanceof ContainerError) {
          const details = (error as any).details as Record<string, unknown> | undefined;
          const capturedStdout = details?.stdout;
          if (typeof capturedStdout === 'string' && capturedStdout.trim().length > 0) {
            context.logger.warn(
              `[Naabu] Container exited non-zero but produced output. Preserving partial results.`,
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
      context.logger.info('[Naabu] Cleaned up isolated volume');
    }

    // Parse naabu JSON output
    const findings = parseNaabuOutput(rawOutput);

    // Build analytics-ready results
    const analyticsResults: AnalyticsResult[] = findings.map((finding) => ({
      scanner: 'naabu',
      finding_hash: generateFindingHash('open-port', finding.host, String(finding.port)),
      severity: 'info' as const,
      asset_key: `${finding.host}:${finding.port}`,
      host: finding.host,
      port: finding.port,
      protocol: finding.protocol,
      ip: finding.ip,
    }));

    context.logger.info(
      `[Naabu] Found ${findings.length} open ports across ${inputs.targets.length} targets`,
    );

    const output: Output = {
      findings,
      results: analyticsResults,
      rawOutput,
      targetCount: inputs.targets.length,
      openPortCount: findings.length,
      options: {
        ports: effectiveOptions.ports ?? null,
        topPorts: effectiveOptions.topPorts ?? null,
        excludePorts: effectiveOptions.excludePorts ?? null,
        rate: effectiveOptions.rate ?? null,
        retries: effectiveOptions.retries,
        enablePing: effectiveOptions.enablePing,
        interface: effectiveOptions.interface ?? null,
      },
    };

    return outputSchema.parse(output);
  },
});

function parseNaabuOutput(raw: string): Finding[] {
  if (!raw.trim()) {
    return [];
  }

  const findings: Finding[] = [];

  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line) => {
      let payload: any = null;
      try {
        payload = JSON.parse(line);
      } catch {
        payload = null;
      }

      if (payload && typeof payload === 'object') {
        const host =
          typeof payload.host === 'string' && payload.host.length > 0
            ? payload.host
            : typeof payload.ip === 'string'
              ? payload.ip
              : '';
        const portValue = Number(payload.port);
        if (!host || !Number.isFinite(portValue)) {
          return;
        }

        const protocol =
          typeof payload.proto === 'string'
            ? payload.proto
            : typeof payload.protocol === 'string'
              ? payload.protocol
              : 'tcp';

        const finding: Finding = {
          host,
          ip: typeof payload.ip === 'string' && payload.ip.length > 0 ? payload.ip : null,
          port: portValue,
          protocol,
        };
        findings.push(finding);
        return;
      }

      const parts = line.split(':');
      if (parts.length === 2) {
        const portValue = Number(parts[1]);
        if (Number.isFinite(portValue)) {
          findings.push({
            host: parts[0],
            ip: null,
            port: portValue,
            protocol: 'tcp',
          });
        }
      }
    });

  return findings;
}

componentRegistry.register(definition);

// Create local type aliases for internal use (inferred types)
type Input = (typeof inputSchema)['__inferred'];
type Output = (typeof outputSchema)['__inferred'];

// Export schema types for the registry
export type NaabuInput = typeof inputSchema;
export type NaabuOutput = typeof outputSchema;

export type { Input as NaabuInputData, Output as NaabuOutputData };

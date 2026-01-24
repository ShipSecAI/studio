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
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const NMAP_IMAGE = 'securecodebox/nmap:latest';
const NMAP_TIMEOUT_SECONDS = 600;

const scanTypeEnum = z.enum([
  'default',
  'syn',
  'connect',
  'udp',
  'ack',
  'window',
  'maimon',
  'null',
  'fin',
  'xmas',
]);

const timingTemplateEnum = z.enum(['T0', 'T1', 'T2', 'T3', 'T4', 'T5']);

const inputSchema = inputs({
  targets: port(
    z.array(z.string().min(1, 'Target cannot be empty')).min(1, 'At least one target is required'),
    {
      label: 'Targets',
      description: 'Hostnames, IP addresses, or CIDR ranges to scan.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const parameterSchema = parameters({
  ports: param(
    z
      .string()
      .trim()
      .optional()
      .describe('Specific ports or ranges to scan (e.g. "22,80,443" or "1-1000")'),
    {
      label: 'Ports',
      editor: 'text',
      placeholder: '22,80,443,8080',
      description: 'Custom ports or ranges to scan. Leave empty for default nmap port selection.',
    },
  ),
  topPorts: param(z.number().int().positive().max(65535).optional(), {
    label: 'Top Ports',
    editor: 'number',
    min: 1,
    max: 65535,
    description: 'Scan the top N most common ports.',
  }),
  scanType: param(scanTypeEnum.default('default'), {
    label: 'Scan Type',
    editor: 'select',
    options: [
      { label: 'Default', value: 'default' },
      { label: 'SYN Scan (-sS)', value: 'syn' },
      { label: 'Connect Scan (-sT)', value: 'connect' },
      { label: 'UDP Scan (-sU)', value: 'udp' },
      { label: 'ACK Scan (-sA)', value: 'ack' },
      { label: 'Window Scan (-sW)', value: 'window' },
      { label: 'Maimon Scan (-sM)', value: 'maimon' },
      { label: 'Null Scan (-sN)', value: 'null' },
      { label: 'FIN Scan (-sF)', value: 'fin' },
      { label: 'Xmas Scan (-sX)', value: 'xmas' },
    ],
    description: 'Type of port scan to perform.',
  }),
  serviceDetection: param(z.boolean().default(false), {
    label: 'Service Detection',
    editor: 'boolean',
    description: 'Enable service/version detection (-sV).',
  }),
  osDetection: param(z.boolean().default(false), {
    label: 'OS Detection',
    editor: 'boolean',
    description: 'Enable OS detection (-O). May require elevated privileges.',
  }),
  scriptScan: param(z.boolean().default(false), {
    label: 'Default Scripts',
    editor: 'boolean',
    description: 'Run default NSE scripts (-sC).',
  }),
  aggressiveScan: param(z.boolean().default(false), {
    label: 'Aggressive Scan',
    editor: 'boolean',
    description: 'Enable OS detection, version detection, script scanning, and traceroute (-A).',
  }),
  timing: param(timingTemplateEnum.default('T3'), {
    label: 'Timing Template',
    editor: 'select',
    options: [
      { label: 'T0 - Paranoid (slowest)', value: 'T0' },
      { label: 'T1 - Sneaky', value: 'T1' },
      { label: 'T2 - Polite', value: 'T2' },
      { label: 'T3 - Normal (default)', value: 'T3' },
      { label: 'T4 - Aggressive', value: 'T4' },
      { label: 'T5 - Insane (fastest)', value: 'T5' },
    ],
    description: 'Timing template for scan speed vs stealth tradeoff.',
  }),
  pingDiscovery: param(z.boolean().default(true), {
    label: 'Ping Discovery',
    editor: 'boolean',
    description: 'Perform host discovery before scanning. Disable with -Pn for no ping.',
  }),
  dnsResolution: param(z.boolean().default(true), {
    label: 'DNS Resolution',
    editor: 'boolean',
    description: 'Perform DNS resolution. Disable with -n for faster scans.',
  }),
  scripts: param(z.string().trim().optional(), {
    label: 'NSE Scripts',
    editor: 'text',
    placeholder: 'vuln,safe',
    description: 'Comma-separated NSE scripts or categories to run (--script).',
  }),
  excludeTargets: param(z.string().trim().optional(), {
    label: 'Exclude Targets',
    editor: 'text',
    placeholder: '192.168.1.1,10.0.0.0/8',
    description: 'Comma-separated hosts/networks to exclude from scanning.',
  }),
  customFlags: param(z.string().trim().optional(), {
    label: 'Custom Flags',
    editor: 'textarea',
    rows: 2,
    placeholder: '--max-retries 2 --host-timeout 30m',
    description: 'Additional nmap CLI flags to append.',
  }),
});

const hostSchema = z.object({
  ip: z.string(),
  hostname: z.string().nullable(),
  state: z.string(),
  ports: z.array(
    z.object({
      port: z.number(),
      protocol: z.string(),
      state: z.string(),
      service: z.string().nullable(),
      version: z.string().nullable(),
      product: z.string().nullable(),
      extraInfo: z.string().nullable(),
    }),
  ),
  os: z.string().nullable(),
  osAccuracy: z.number().nullable(),
});

type Host = z.infer<typeof hostSchema>;

const outputSchema = outputs({
  hosts: port(z.array(hostSchema), {
    label: 'Hosts',
    description: 'Discovered hosts with their open ports and services.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw nmap XML output.',
  }),
  targetCount: port(z.number(), {
    label: 'Target Count',
    description: 'Number of targets scanned.',
  }),
  hostCount: port(z.number(), {
    label: 'Host Count',
    description: 'Number of hosts discovered.',
  }),
  openPortCount: port(z.number(), {
    label: 'Open Port Count',
    description: 'Total number of open ports found.',
  }),
  scanInfo: port(
    z.object({
      scanType: z.string(),
      timing: z.string(),
      serviceDetection: z.boolean(),
      osDetection: z.boolean(),
      scriptScan: z.boolean(),
    }),
    {
      label: 'Scan Info',
      description: 'Scan configuration used.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
});

type Output = z.infer<typeof outputSchema>;

const nmapRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const scanTypeFlags: Record<z.infer<typeof scanTypeEnum>, string[]> = {
  default: [],
  syn: ['-sS'],
  connect: ['-sT'],
  udp: ['-sU'],
  ack: ['-sA'],
  window: ['-sW'],
  maimon: ['-sM'],
  null: ['-sN'],
  fin: ['-sF'],
  xmas: ['-sX'],
};

const definition = defineComponent({
  id: 'shipsec.nmap.scan',
  label: 'Nmap Scanner',
  category: 'security',
  retryPolicy: nmapRetryPolicy,
  runner: {
    kind: 'docker',
    image: NMAP_IMAGE,
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: NMAP_TIMEOUT_SECONDS,
    command: ['-c', 'nmap "$@"', '--'],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run Nmap network scanner to discover hosts, open ports, services, and OS information. Supports various scan types, timing templates, and NSE scripts.',
  ui: {
    slug: 'nmap',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Network exploration and security auditing using Nmap.',
    documentation: 'https://nmap.org/book/man.html',
    documentationUrl: 'https://nmap.org/',
    icon: 'Radar',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: 'nmap -sV -sC -T4 scanme.nmap.org',
    examples: [
      'Quick scan: Use T4 timing with top 100 ports for fast results.',
      'Service detection: Enable service detection to identify running services.',
      'Vulnerability scan: Use NSE scripts like "vuln" to check for known vulnerabilities.',
      'Stealth scan: Use SYN scan with T2 timing for less detectable scanning.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const { targets } = inputs;

    const normalizedTargets = targets
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0);

    if (normalizedTargets.length === 0) {
      context.logger.info('[Nmap] No targets provided, skipping execution.');
      return outputSchema.parse({
        hosts: [],
        rawOutput: '',
        targetCount: 0,
        hostCount: 0,
        openPortCount: 0,
        scanInfo: {
          scanType: parsedParams.scanType,
          timing: parsedParams.timing,
          serviceDetection: parsedParams.serviceDetection,
          osDetection: parsedParams.osDetection,
          scriptScan: parsedParams.scriptScan,
        },
      });
    }

    context.logger.info(`[Nmap] Scanning ${normalizedTargets.length} target(s)`);
    context.emitProgress(`Starting Nmap scan on ${normalizedTargets.length} target(s)`);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Nmap runner must be docker', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    try {
      await volume.initialize({
        'targets.txt': normalizedTargets.join('\n'),
      });

      const nmapArgs: string[] = [];

      // Scan type flags
      const scanFlags = scanTypeFlags[parsedParams.scanType];
      nmapArgs.push(...scanFlags);

      // Timing template
      nmapArgs.push(`-${parsedParams.timing}`);

      // Port specification
      if (parsedParams.ports) {
        nmapArgs.push('-p', parsedParams.ports);
      } else if (parsedParams.topPorts) {
        nmapArgs.push('--top-ports', String(parsedParams.topPorts));
      }

      // Service/version detection
      if (parsedParams.serviceDetection) {
        nmapArgs.push('-sV');
      }

      // OS detection
      if (parsedParams.osDetection) {
        nmapArgs.push('-O');
      }

      // Script scan
      if (parsedParams.scriptScan) {
        nmapArgs.push('-sC');
      }

      // Aggressive scan (overrides individual options)
      if (parsedParams.aggressiveScan) {
        nmapArgs.push('-A');
      }

      // Ping discovery
      if (!parsedParams.pingDiscovery) {
        nmapArgs.push('-Pn');
      }

      // DNS resolution
      if (!parsedParams.dnsResolution) {
        nmapArgs.push('-n');
      }

      // Custom scripts
      if (parsedParams.scripts) {
        nmapArgs.push('--script', parsedParams.scripts);
      }

      // Exclude targets
      if (parsedParams.excludeTargets) {
        nmapArgs.push('--exclude', parsedParams.excludeTargets);
      }

      // Custom flags
      if (parsedParams.customFlags) {
        const customArgs = parsedParams.customFlags.split(/\s+/).filter((arg) => arg.length > 0);
        nmapArgs.push(...customArgs);
      }

      // Output format: XML for structured parsing (write to same volume as input)
      nmapArgs.push('-oX', '/data/scan.xml');

      // Input file
      nmapArgs.push('-iL', '/data/targets.txt');

      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds ?? NMAP_TIMEOUT_SECONDS,
        entrypoint: baseRunner.entrypoint,
        command: [...(baseRunner.command ?? []), ...nmapArgs],
        volumes: [volume.getVolumeConfig('/data', false)],
      };

      context.logger.info(`[Nmap] Running with args: ${nmapArgs.join(' ')}`);

      await runComponentWithRunner(
        runnerConfig,
        async () => ({}) as Output,
        { ...inputs, ...parsedParams },
        context,
      );

      // Read the XML output
      const outputFiles = await volume.readFiles(['scan.xml']);
      const xmlOutput = outputFiles['scan.xml'] ?? '';
      const hosts = parseNmapXml(xmlOutput);

      const openPortCount = hosts.reduce(
        (sum, host) => sum + host.ports.filter((p) => p.state === 'open').length,
        0,
      );

      context.logger.info(
        `[Nmap] Scan complete: ${hosts.length} host(s), ${openPortCount} open port(s)`,
      );

      return outputSchema.parse({
        hosts,
        rawOutput: xmlOutput,
        targetCount: normalizedTargets.length,
        hostCount: hosts.length,
        openPortCount,
        scanInfo: {
          scanType: parsedParams.scanType,
          timing: parsedParams.timing,
          serviceDetection: parsedParams.serviceDetection || parsedParams.aggressiveScan,
          osDetection: parsedParams.osDetection || parsedParams.aggressiveScan,
          scriptScan: parsedParams.scriptScan || parsedParams.aggressiveScan,
        },
      });
    } finally {
      await volume.cleanup();
      context.logger.info('[Nmap] Cleaned up isolated volume.');
    }
  },
});

function parseNmapXml(xml: string): Host[] {
  if (!xml || xml.trim().length === 0) {
    return [];
  }

  const hosts: Host[] = [];

  // Simple XML parsing for nmap output
  const hostMatches = xml.match(/<host[^>]*>[\s\S]*?<\/host>/g) || [];

  for (const hostXml of hostMatches) {
    // Extract IP address
    const addrMatch = hostXml.match(/<address addr="([^"]+)" addrtype="ipv4"/);
    const ip = addrMatch?.[1] ?? '';
    if (!ip) continue;

    // Extract hostname
    const hostnameMatch = hostXml.match(/<hostname name="([^"]+)"/);
    const hostname = hostnameMatch?.[1] ?? null;

    // Extract host state
    const stateMatch = hostXml.match(/<status state="([^"]+)"/);
    const state = stateMatch?.[1] ?? 'unknown';

    // Extract ports
    const ports: Host['ports'] = [];
    const portMatches = hostXml.match(/<port[^>]*>[\s\S]*?<\/port>/g) || [];

    for (const portXml of portMatches) {
      const portNumMatch = portXml.match(/portid="(\d+)"/);
      const protocolMatch = portXml.match(/protocol="([^"]+)"/);
      const portStateMatch = portXml.match(/<state state="([^"]+)"/);
      const serviceMatch = portXml.match(/<service name="([^"]*)"/);
      const productMatch = portXml.match(/product="([^"]*)"/);
      const versionMatch = portXml.match(/version="([^"]*)"/);
      const extraInfoMatch = portXml.match(/extrainfo="([^"]*)"/);

      if (portNumMatch) {
        ports.push({
          port: parseInt(portNumMatch[1], 10),
          protocol: protocolMatch?.[1] ?? 'tcp',
          state: portStateMatch?.[1] ?? 'unknown',
          service: serviceMatch?.[1] || null,
          product: productMatch?.[1] || null,
          version: versionMatch?.[1] || null,
          extraInfo: extraInfoMatch?.[1] || null,
        });
      }
    }

    // Extract OS detection
    const osMatch = hostXml.match(/<osmatch name="([^"]+)"[^>]*accuracy="(\d+)"/);
    const os = osMatch?.[1] ?? null;
    const osAccuracy = osMatch?.[2] ? parseInt(osMatch[2], 10) : null;

    hosts.push({
      ip,
      hostname,
      state,
      ports,
      os,
      osAccuracy,
    });
  }

  return hosts;
}

componentRegistry.register(definition);

export type NmapInput = typeof inputSchema;
export type NmapOutput = typeof outputSchema;
export type { Output as NmapOutputData, Host as NmapHost };

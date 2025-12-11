import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  runComponentWithRunner,
} from '@shipsec/component-sdk';

const inputSchema = z.object({
  targets: z
    .array(z.string().min(1, 'Target cannot be empty'))
    .min(1, 'Provide at least one target')
    .describe('Hostnames or IP addresses to scan for open ports'),
  ports: z
    .string()
    .trim()
    .min(1, 'Port list cannot be empty')
    .optional()
    .describe('Specific ports or ranges to scan (e.g. "80,443,1000-2000")'),
  topPorts: z
    .number()
    .int()
    .positive()
    .max(65535)
    .optional()
    .describe('Scan the top N most common ports'),
  excludePorts: z
    .string()
    .trim()
    .min(1, 'Exclude ports cannot be empty')
    .optional()
    .describe('Comma-separated list of ports to exclude'),
  rate: z
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .optional()
    .describe('Maximum number of packets per second'),
  retries: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .default(1)
    .describe('Number of retries per port'),
  enablePing: z
    .boolean()
    .optional()
    .default(false)
    .describe('Use ICMP/SYN ping probe to discover live hosts before scanning'),
  interface: z
    .string()
    .trim()
    .min(1, 'Interface cannot be empty')
    .optional()
    .describe('Network interface to use from inside the container'),
});

const findingSchema = z.object({
  host: z.string(),
  ip: z.string().nullable(),
  port: z.number(),
  protocol: z.string(),
});

const outputSchema = z.object({
  findings: z.array(findingSchema),
  rawOutput: z.string(),
  targetCount: z.number(),
  openPortCount: z.number(),
  options: z.object({
    ports: z.string().nullable(),
    topPorts: z.number().nullable(),
    excludePorts: z.string().nullable(),
    rate: z.number().nullable(),
    retries: z.number(),
    enablePing: z.boolean(),
    interface: z.string().nullable(),
  }),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;
type Finding = z.infer<typeof findingSchema>;

const dockerTimeoutSeconds = (() => {
  const raw = process.env.NAABU_TIMEOUT_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return 180;
  }
  return parsed;
})();

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.naabu.scan',
  label: 'Naabu Port Scan',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'projectdiscovery/naabu:v2.3.7',
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: dockerTimeoutSeconds,
    command: [
      '-c',
      String.raw`set -eo pipefail

INPUT=$(cat)

TARGETS_SECTION=$(printf "%s" "$INPUT" | tr -d '\n' | sed -n 's/.*"targets":[[:space:]]*\[\([^]]*\)\].*/\1/p')

if [ -z "$TARGETS_SECTION" ]; then
  exit 0
fi

TARGETS=$(printf "%s" "$TARGETS_SECTION" | tr ',' '\n' | sed 's/"//g; s/^[[:space:]]*//; s/[[:space:]]*$//' | sed '/^$/d')

if [ -z "$TARGETS" ]; then
  exit 0
fi

extract_string() {
  key="$1"
  printf "%s" "$INPUT" | tr -d '\n' | grep -o "\"$key\":[[:space:]]*\"[^\"]*\"" | head -n1 | sed "s/.*\"$key\":[[:space:]]*\"\([^\"]*\)\".*/\1/"
}

extract_number() {
  key="$1"
  printf "%s" "$INPUT" | tr -d '\n' | grep -o "\"$key\":[[:space:]]*[0-9][0-9]*" | head -n1 | sed 's/[^0-9]//g'
}

extract_bool() {
  key="$1"
  default="$2"
  value=$(printf "%s" "$INPUT" | tr -d '\n' | grep -o "\"$key\":[[:space:]]*\\(true\\|false\\)" | head -n1 | sed 's/.*://; s/[[:space:]]//g')
  if [ -z "$value" ]; then
    echo "$default"
  elif [ "$value" = "true" ]; then
    echo "true"
  else
    echo "false"
  fi
}

PORTS=$(extract_string "ports" | tr -d ' ')
EXCLUDE_PORTS=$(extract_string "excludePorts" | tr -d ' ')
INTERFACE=$(extract_string "interface")
TOP_PORTS=$(extract_number "topPorts")
RATE=$(extract_number "rate")
RETRIES=$(extract_number "retries")
ENABLE_PING=$(extract_bool "enablePing" "false")

LIST_FILE=$(mktemp)
trap 'rm -f "$LIST_FILE"' EXIT

printf "%s\n" "$TARGETS" > "$LIST_FILE"

CMD="naabu -list $LIST_FILE -json -silent"

if [ -n "$PORTS" ]; then
  CMD="$CMD -p $PORTS"
fi
if [ -n "$TOP_PORTS" ]; then
  CMD="$CMD -top-ports $TOP_PORTS"
fi
if [ -n "$EXCLUDE_PORTS" ]; then
  CMD="$CMD -exclude-ports $EXCLUDE_PORTS"
fi
if [ -n "$RATE" ]; then
  CMD="$CMD -rate $RATE"
fi
if [ -n "$RETRIES" ]; then
  CMD="$CMD -retries $RETRIES"
fi
if [ "$ENABLE_PING" = "true" ]; then
  CMD="$CMD -ping"
fi
if [ -n "$INTERFACE" ]; then
  CMD="$CMD -interface $INTERFACE"
fi

# CRITICAL: Enable stream mode to prevent output buffering
# ProjectDiscovery tools buffer output by default, causing containers to appear hung
# -stream flag: Disables buffering + forces immediate output flush
# Without this, naabu buffers up to 8KB before flushing, causing timeout failures
# See docs/component-development.md "Output Buffering" section for details
CMD="$CMD -stream"

eval "$CMD"
`,
    ],
    env: {
      HOME: '/root',
    },
  },
  inputSchema,
  outputSchema,
  docs: 'Run ProjectDiscovery Naabu to identify open TCP ports across a list of targets.',
  metadata: {
    slug: 'naabu',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Fast active port scanning using ProjectDiscovery Naabu.',
    documentation: 'ProjectDiscovery Naabu documentation covers usage, CLI flags, and configuration examples.',
    documentationUrl: 'https://github.com/projectdiscovery/naabu',
    icon: 'Radar',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: '`naabu -host scanme.sh -top-ports 100` - Quickly identifies the most common open TCP ports on a target host.',
    inputs: [
      {
        id: 'targets',
        label: 'Targets',
        dataType: port.list(port.text()),
        required: true,
        description: 'Hostnames or IP addresses to scan for open ports.',
      },
    ],
    outputs: [
      {
        id: 'findings',
        label: 'Open Ports',
        dataType: port.list(port.json()),
        description: 'List of open ports discovered per target.',
      },
      {
        id: 'rawOutput',
        label: 'Raw Output',
        dataType: port.text(),
        description: 'Raw Naabu output lines (JSON per host:port).',
      },
    ],
    examples: [
      'Scan Amass or Subfinder discoveries to identify exposed services.',
      'Target a custom list of IPs with tuned rate and retries for stealth scans.',
    ],
    parameters: [
      {
        id: 'ports',
        label: 'Ports',
        type: 'text',
        placeholder: '80,443,1000-2000',
        description: 'Custom ports or ranges to scan (comma-separated).',
      },
      {
        id: 'topPorts',
        label: 'Top Ports',
        type: 'number',
        min: 1,
        max: 65535,
        description: 'Scan the top N most common ports.',
        helpText: 'Leave blank to scan Naabu default port set.',
      },
      {
        id: 'excludePorts',
        label: 'Exclude Ports',
        type: 'text',
        placeholder: '21,22,25',
        description: 'Ports that should be excluded from the scan.',
      },
      {
        id: 'rate',
        label: 'Rate (pps)',
        type: 'number',
        min: 1,
        max: 1000000,
        description: 'Maximum packets per second to send during scanning.',
        helpText: 'Tune to match available bandwidth. Defaults to Naabu managed rate.',
      },
      {
        id: 'retries',
        label: 'Retries',
        type: 'number',
        min: 0,
        max: 10,
        default: 1,
        description: 'Number of retry attempts per port.',
      },
      {
        id: 'enablePing',
        label: 'Ping Probes',
        type: 'boolean',
        default: false,
        description: 'Send ICMP/SYN probes to detect live hosts before scanning.',
      },
      {
        id: 'interface',
        label: 'Interface',
        type: 'text',
        description: 'Specific network interface to use inside the container.',
        placeholder: 'eth0',
      },
    ],
  },
  async execute(input, context) {
    const trimmedPorts = input.ports?.trim();
    const trimmedExclude = input.excludePorts?.trim();
    const trimmedInterface = input.interface?.trim();

    const runnerParams: Input = {
      ...input,
      ports: trimmedPorts && trimmedPorts.length > 0 ? trimmedPorts : undefined,
      excludePorts: trimmedExclude && trimmedExclude.length > 0 ? trimmedExclude : undefined,
      interface: trimmedInterface && trimmedInterface.length > 0 ? trimmedInterface : undefined,
    };

    context.logger.info(
      `[Naabu] Scanning ${runnerParams.targets.length} target(s) with options: ports=${runnerParams.ports ?? 'default'}, topPorts=${runnerParams.topPorts ?? 'default'}, excludePorts=${runnerParams.excludePorts ?? 'none'}, rate=${runnerParams.rate ?? 'auto'}, retries=${runnerParams.retries}, enablePing=${runnerParams.enablePing ?? false}`,
    );

    context.emitProgress({
      message: 'Launching Naabu port scan…',
      level: 'info',
      data: { targets: runnerParams.targets.slice(0, 5) },
    });

    const result = await runComponentWithRunner(
      this.runner,
      async () => ({}) as Output,
      runnerParams,
      context,
    );

    if (typeof result === 'string') {
      const findings = parseNaabuOutput(result);
      const output: Output = {
        findings,
        rawOutput: result,
        targetCount: runnerParams.targets.length,
        openPortCount: findings.length,
        options: {
          ports: runnerParams.ports ?? null,
          topPorts: runnerParams.topPorts ?? null,
          excludePorts: runnerParams.excludePorts ?? null,
          rate: runnerParams.rate ?? null,
          retries: runnerParams.retries ?? 1,
          enablePing: runnerParams.enablePing ?? false,
          interface: runnerParams.interface ?? null,
        },
      };
      return outputSchema.parse(output);
    }

    if (result && typeof result === 'object') {
      const parsed = outputSchema.safeParse(result);
      if (parsed.success) {
        return parsed.data;
      }
    }

    return {
      findings: [],
      rawOutput: typeof result === 'string' ? result : '',
      targetCount: runnerParams.targets.length,
      openPortCount: 0,
      options: {
        ports: runnerParams.ports ?? null,
        topPorts: runnerParams.topPorts ?? null,
        excludePorts: runnerParams.excludePorts ?? null,
        rate: runnerParams.rate ?? null,
        retries: runnerParams.retries ?? 1,
        enablePing: runnerParams.enablePing ?? false,
        interface: runnerParams.interface ?? null,
      },
    };
  },
};

function parseNaabuOutput(raw: string): Finding[] {
  if (!raw.trim()) {
    return [];
  }

  const findings: Finding[] = [];

  raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .forEach(line => {
      let payload: any = null;
      try {
        payload = JSON.parse(line);
      } catch {
        payload = null;
      }

      if (payload && typeof payload === 'object') {
        const host = typeof payload.host === 'string' && payload.host.length > 0
          ? payload.host
          : typeof payload.ip === 'string'
            ? payload.ip
            : '';
        const portValue = Number(payload.port);
        if (!host || !Number.isFinite(portValue)) {
          return;
        }

        const protocol = typeof payload.proto === 'string'
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

export type { Input as NaabuInput, Output as NaabuOutput };

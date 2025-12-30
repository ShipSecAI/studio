import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  ComponentRetryPolicy,
  port,
  runComponentWithRunner,
  ServiceError,
  ValidationError,
} from '@shipsec/component-sdk';

const inputSchema = z.object({
  domains: z
    .array(z.string().min(1, 'Domain cannot be empty'))
    .min(1, 'Provide at least one domain')
    .describe('Array of root domains to enumerate'),
  active: z
    .boolean()
    .optional()
    .default(false)
    .describe('Attempt active techniques (zone transfers, certificate name grabs)'),
  bruteForce: z
    .boolean()
    .optional()
    .default(false)
    .describe('Enable DNS brute forcing after passive enumeration'),
  includeIps: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include discovered IP addresses alongside hostnames'),
  customFlags: z
    .string()
    .trim()
    .optional()
    .describe('Raw CLI flags to append to the Amass command'),
  enableAlterations: z
    .boolean()
    .optional()
    .default(false)
    .describe('Enable Amass alterations engine for mutated hostnames'),
  recursive: z
    .boolean()
    .optional()
    .default(true)
    .describe('Allow recursive brute forcing when enough labels are discovered'),
  minForRecursive: z
    .number()
    .int()
    .positive()
    .max(10, 'Recursive threshold above 10 is not supported')
    .optional()
    .describe('Labels required before recursive brute forcing starts'),
  maxDepth: z
    .number()
    .int()
    .min(1)
    .max(10, 'Maximum depth above 10 is not supported')
    .optional()
    .describe('Maximum number of subdomain labels during brute forcing'),
  dnsQueryRate: z
    .number()
    .int()
    .positive()
    .max(1000, 'DNS query rate above 1000 QPS is not supported')
    .optional()
    .describe('Maximum DNS queries per second across all resolvers'),
  verbose: z
    .boolean()
    .optional()
    .default(false)
    .describe('Emit verbose Amass logging output'),
  demoMode: z
    .boolean()
    .optional()
    .default(false)
    .describe('Censor sensitive data in the Amass output (demo mode)'),
  timeoutMinutes: z
    .number()
    .int()
    .positive()
    .max(360, 'Timeout larger than 6 hours is not supported')
    .optional()
    .describe('Maximum enumeration runtime before Amass exits'),
});

type Input = z.infer<typeof inputSchema>;

type Output = {
  subdomains: string[];
  rawOutput: string;
  domainCount: number;
  subdomainCount: number;
  options: {
    active: boolean;
    bruteForce: boolean;
    includeIps: boolean;
    enableAlterations: boolean;
    recursive: boolean;
    verbose: boolean;
    demoMode: boolean;
    timeoutMinutes: number | null;
    minForRecursive: number | null;
    maxDepth: number | null;
    dnsQueryRate: number | null;
    customFlags: string | null;
  };
};

const outputSchema = z.object({
  subdomains: z.array(z.string()),
  rawOutput: z.string(),
  domainCount: z.number(),
  subdomainCount: z.number(),
  options: z.object({
    active: z.boolean(),
    bruteForce: z.boolean(),
    includeIps: z.boolean(),
    enableAlterations: z.boolean(),
    recursive: z.boolean(),
    verbose: z.boolean(),
    demoMode: z.boolean(),
    timeoutMinutes: z.number().nullable(),
    minForRecursive: z.number().nullable(),
    maxDepth: z.number().nullable(),
    dnsQueryRate: z.number().nullable(),
    customFlags: z.string().nullable(),
  }),
});

const dockerTimeoutSeconds = (() => {
  const raw = process.env.AMASS_TIMEOUT_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return 600;
  }
  return parsed;
})();

// Retry policy for Amass - long-running subdomain enumeration
const amassRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 10,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 1.5,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.amass.enum',
  label: 'Amass Enumeration',
  category: 'security',
  retryPolicy: amassRetryPolicy,
  runner: {
    kind: 'docker',
    image: 'owaspamass/amass:v4.2.0',
    entrypoint: 'sh',
    network: 'bridge',
    timeoutSeconds: dockerTimeoutSeconds,
    command: [
      '-c',
      String.raw`set -eo pipefail

export HOME=/tmp
mkdir -p "$HOME/.config/amass"

INPUT=$(cat)

DOMAINS_SECTION=$(printf "%s" "$INPUT" | tr -d '\n' | sed -n 's/.*"domains":[[:space:]]*\[\([^]]*\)\].*/\1/p')

if [ -z "$DOMAINS_SECTION" ]; then
  printf '{"subdomains":[],"rawOutput":"","domainCount":0,"subdomainCount":0,"options":{"active":false,"bruteForce":false,"includeIps":false,"enableAlterations":false,"recursive":true,"verbose":false,"demoMode":false,"timeoutMinutes":null,"minForRecursive":null,"maxDepth":null,"dnsQueryRate":null,"customFlags":null}}'
  exit 0
fi

DOMAIN_LIST=$(printf "%s" "$DOMAINS_SECTION" | tr ',' '\n' | sed 's/"//g; s/^[[:space:]]*//; s/[[:space:]]*$//' | sed '/^$/d')

if [ -z "$DOMAIN_LIST" ]; then
  printf '{"subdomains":[],"rawOutput":"","domainCount":0,"subdomainCount":0,"options":{"active":false,"bruteForce":false,"includeIps":false,"enableAlterations":false,"recursive":true,"verbose":false,"demoMode":false,"timeoutMinutes":null,"minForRecursive":null,"maxDepth":null,"dnsQueryRate":null,"customFlags":null}}'
  exit 0
fi

extract_bool() {
  key="$1"
  default="$2"
  value=$(printf "%s" "$INPUT" | tr -d '\n' | grep -o "\"$key\":[[:space:]]*\\(true\\|false\\)" | head -n1 | sed 's/.*://; s/[[:space:]]//g')
  if [ -z "$value" ]; then
    value="$default"
  fi
  if [ "$value" = "true" ]; then
    echo "true"
  else
    echo "false"
  fi
}

extract_number() {
  key="$1"
  value=$(printf "%s" "$INPUT" | tr -d '\n' | grep -o "\"$key\":[[:space:]]*[0-9][0-9]*" | head -n1 | sed 's/[^0-9]//g')
  if [ -z "$value" ]; then
    echo ""
  else
    echo "$value"
  fi
}

extract_string() {
  key="$1"
  printf "%s" "$INPUT" | tr '\n' ' ' | sed -n "s/.*\"$key\":[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n1
}

ACTIVE=$(extract_bool "active" "false")
BRUTE=$(extract_bool "bruteForce" "false")
INCLUDE_IPS=$(extract_bool "includeIps" "false")
ALTERATIONS=$(extract_bool "enableAlterations" "false")
RECURSIVE=$(extract_bool "recursive" "true")
VERBOSE=$(extract_bool "verbose" "false")
DEMO=$(extract_bool "demoMode" "false")
TIMEOUT=$(extract_number "timeoutMinutes")
MIN_FOR_RECUR=$(extract_number "minForRecursive")
MAX_DEPTH=$(extract_number "maxDepth")
DNS_QPS=$(extract_number "dnsQueryRate")
CUSTOM_FLAGS=$(extract_string "customFlags")

if [ -n "$TIMEOUT" ]; then
  TIMEOUT_JSON="$TIMEOUT"
else
  TIMEOUT_JSON=null
fi

if [ -n "$MIN_FOR_RECUR" ]; then
  MIN_FOR_RECUR_JSON="$MIN_FOR_RECUR"
else
  MIN_FOR_RECUR_JSON=null
fi

if [ -n "$MAX_DEPTH" ]; then
  MAX_DEPTH_JSON="$MAX_DEPTH"
else
  MAX_DEPTH_JSON=null
fi

if [ -n "$DNS_QPS" ]; then
  DNS_QPS_JSON="$DNS_QPS"
else
  DNS_QPS_JSON=null
fi

if [ -n "$CUSTOM_FLAGS" ]; then
  CUSTOM_FLAGS_JSON=$(printf '"%s"' "$(printf '%s' "$CUSTOM_FLAGS" | sed 's/\\/\\\\/g; s/"/\\"/g')")
else
  CUSTOM_FLAGS_JSON=null
fi

AMASS_FLAGS=""
if [ "$ACTIVE" = "true" ]; then
  AMASS_FLAGS="$AMASS_FLAGS -active"
fi
if [ "$BRUTE" = "true" ]; then
  AMASS_FLAGS="$AMASS_FLAGS -brute"
fi
if [ "$INCLUDE_IPS" = "true" ]; then
  AMASS_FLAGS="$AMASS_FLAGS -ip"
fi
if [ "$ALTERATIONS" = "true" ]; then
  AMASS_FLAGS="$AMASS_FLAGS -alts"
fi
if [ "$RECURSIVE" = "false" ]; then
  AMASS_FLAGS="$AMASS_FLAGS -norecursive"
else
  if [ -n "$MIN_FOR_RECUR" ]; then
    AMASS_FLAGS="$AMASS_FLAGS -min-for-recursive $MIN_FOR_RECUR"
  fi
fi
if [ -n "$TIMEOUT" ]; then
  AMASS_FLAGS="$AMASS_FLAGS -timeout $TIMEOUT"
fi
if [ -n "$MAX_DEPTH" ]; then
  AMASS_FLAGS="$AMASS_FLAGS -max-depth $MAX_DEPTH"
fi
if [ -n "$DNS_QPS" ]; then
  AMASS_FLAGS="$AMASS_FLAGS -dns-qps $DNS_QPS"
fi
if [ "$VERBOSE" = "true" ]; then
  AMASS_FLAGS="$AMASS_FLAGS -v"
fi
if [ "$DEMO" = "true" ]; then
  AMASS_FLAGS="$AMASS_FLAGS -demo"
fi

DOMAIN_ARGS=""
DOMAIN_COUNT=0
for DOMAIN in $DOMAIN_LIST; do
  if [ -n "$DOMAIN" ]; then
    DOMAIN_ARGS="$DOMAIN_ARGS -d $DOMAIN"
    DOMAIN_COUNT=$((DOMAIN_COUNT + 1))
  fi
done

RAW_FILE=$(mktemp)
DEDUP_FILE=$(mktemp)
trap 'rm -f "$RAW_FILE" "$DEDUP_FILE"' EXIT

if [ "$DOMAIN_COUNT" -eq 0 ]; then
  printf '{"subdomains":[],"rawOutput":"","domainCount":0,"subdomainCount":0,"options":{"active":%s,"bruteForce":%s,"includeIps":%s,"enableAlterations":%s,"recursive":%s,"verbose":%s,"demoMode":%s,"timeoutMinutes":%s,"minForRecursive":%s,"maxDepth":%s,"dnsQueryRate":%s,"customFlags":%s}}' \
    "$ACTIVE" \
    "$BRUTE" \
    "$INCLUDE_IPS" \
    "$ALTERATIONS" \
    "$RECURSIVE" \
    "$VERBOSE" \
    "$DEMO" \
    "$TIMEOUT_JSON" \
    "$MIN_FOR_RECUR_JSON" \
    "$MAX_DEPTH_JSON" \
    "$DNS_QPS_JSON" \
    "$CUSTOM_FLAGS_JSON"
  exit 0
fi

AMASS_COMMAND="/bin/amass enum $AMASS_FLAGS $DOMAIN_ARGS"
if [ -n "$CUSTOM_FLAGS" ]; then
  AMASS_COMMAND="$AMASS_COMMAND $CUSTOM_FLAGS"
fi

set +e
eval "$AMASS_COMMAND" >"$RAW_FILE"
STATUS=$?
set -e

if [ $STATUS -ne 0 ] && [ ! -s "$RAW_FILE" ]; then
  exit $STATUS
fi

sed -e 's/\r//g' "$RAW_FILE" | grep -v '^\[' | awk '{print $1}' | sed '/^$/d' | sort -u > "$DEDUP_FILE"

SUBDOMAIN_COUNT=$(wc -l < "$DEDUP_FILE" | tr -d ' ')

if [ "$SUBDOMAIN_COUNT" -eq 0 ]; then
  SUBDOMAIN_JSON="[]"
else
  SUBDOMAIN_JSON=$(awk 'NR==1{printf("[\"%s\"", $0); next} {printf(",\"%s\"", $0)} END {if (NR==0) printf("[]"); else printf("]");}' "$DEDUP_FILE")
fi

RAW_OUTPUT_ESCAPED=$(printf '%s' "$(cat "$RAW_FILE")" | sed ':a;N;$!ba;s/\\/\\\\/g; s/"/\\"/g; s/\n/\\n/g')

printf '{"subdomains":%s,"rawOutput":"%s","domainCount":%d,"subdomainCount":%d,"options":{"active":%s,"bruteForce":%s,"includeIps":%s,"enableAlterations":%s,"recursive":%s,"verbose":%s,"demoMode":%s,"timeoutMinutes":%s,"minForRecursive":%s,"maxDepth":%s,"dnsQueryRate":%s,"customFlags":%s}}' \
  "$SUBDOMAIN_JSON" \
  "$RAW_OUTPUT_ESCAPED" \
  "$DOMAIN_COUNT" \
  "$SUBDOMAIN_COUNT" \
  "$ACTIVE" \
  "$BRUTE" \
  "$INCLUDE_IPS" \
  "$ALTERATIONS" \
  "$RECURSIVE" \
  "$VERBOSE" \
  "$DEMO" \
  "$TIMEOUT_JSON" \
  "$MIN_FOR_RECUR_JSON" \
  "$MAX_DEPTH_JSON" \
  "$DNS_QPS_JSON" \
  "$CUSTOM_FLAGS_JSON"
`,
    ],
    env: {
      HOME: '/root',
    },
  },
  inputSchema,
  outputSchema,
  docs: 'Enumerate subdomains with OWASP Amass. Supports active techniques, brute forcing, alterations, recursion tuning, and DNS throttling.',
  metadata: {
    slug: 'amass',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'OWASP Amass powered subdomain enumeration with optional brute force, alterations, and recursion controls.',
    documentation: 'OWASP Amass is a comprehensive attack surface mapping toolkit. Adjust enumeration depth, mutation behaviour, and DNS query rates to match your engagement.',
    documentationUrl: 'https://github.com/owasp-amass/amass',
    icon: 'Network',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: '`amass enum -d example.com -brute -alts` - Aggressively enumerates subdomains with brute force and alteration engines enabled.',
    inputs: [
      {
        id: 'domains',
        label: 'Target Domains',
        dataType: port.list(port.text()),
        required: true,
        description: 'Root domains to enumerate using Amass.',
      },
    ],
    outputs: [
      {
        id: 'subdomains',
        label: 'Discovered Subdomains',
        dataType: port.list(port.text()),
        description: 'Unique list of subdomains discovered by Amass.',
      },
      {
        id: 'rawOutput',
        label: 'Raw Output',
        dataType: port.text(),
        description: 'Raw Amass console output for deeper inspection.',
      },
    ],
    examples: [
      'Run full-depth enumeration with brute force and alterations on a scope domain.',
      'Perform quick passive reconnaissance using custom CLI flags like --passive.',
    ],
    parameters: [
      {
        id: 'active',
        label: 'Active Enumeration',
        type: 'boolean',
        default: false,
        description: 'Enable active techniques (zone transfers, certificate name grabs).',
        helpText: 'Requires network reachability for authoritative DNS and may be noisy.',
      },
      {
        id: 'bruteForce',
        label: 'DNS Brute Force',
        type: 'boolean',
        default: false,
        description: 'Perform DNS brute forcing after passive enumeration.',
        helpText: 'Increases runtime and query volume but uncovers additional hosts.',
      },
      {
        id: 'enableAlterations',
        label: 'Enable Alterations',
        type: 'boolean',
        default: false,
        description: 'Generate altered hostnames derived from known discoveries.',
        helpText: 'Pairs well with brute forcing when exploring complex environments.',
      },
      {
        id: 'recursive',
        label: 'Recursive Brute Force',
        type: 'boolean',
        default: true,
        description: 'Allow recursive brute forcing when sufficient labels are discovered.',
        helpText: 'Disable to keep enumeration shallow when DNS infrastructure is fragile.',
      },
      {
        id: 'minForRecursive',
        label: 'Labels Before Recursion',
        type: 'number',
        min: 1,
        max: 10,
        description: 'Minimum number of labels before recursion begins.',
        helpText: 'Only used when recursive brute forcing is enabled.',
      },
      {
        id: 'maxDepth',
        label: 'Maximum Depth',
        type: 'number',
        min: 1,
        max: 10,
        description: 'Limit brute forcing depth (number of labels).',
      },
      {
        id: 'dnsQueryRate',
        label: 'DNS QPS Limit',
        type: 'number',
        min: 1,
        max: 1000,
        description: 'Throttle the maximum DNS queries per second across resolvers.',
        helpText: 'Helpful when respecting rate limits or protecting monitored DNS.',
      },
      {
        id: 'customFlags',
        label: 'Custom CLI Flags',
        type: 'textarea',
        rows: 3,
        placeholder: '--passive --config /work/config.yaml',
        description: 'Paste additional Amass CLI options exactly as you would on the command line.',
        helpText: 'Flags are appended after the generated options; avoid duplicating -d domain arguments.',
      },
      {
        id: 'includeIps',
        label: 'Include IP Addresses',
        type: 'boolean',
        default: false,
        description: 'Return discovered IPs alongside hostnames in the raw output.',
      },
      {
        id: 'verbose',
        label: 'Verbose Output',
        type: 'boolean',
        default: false,
        description: 'Emit verbose Amass logs in the workflow output.',
      },
      {
        id: 'demoMode',
        label: 'Demo Mode',
        type: 'boolean',
        default: false,
        description: 'Censor sensitive values in the console output.',
      },
      {
        id: 'timeoutMinutes',
        label: 'Timeout (minutes)',
        type: 'number',
        min: 1,
        max: 360,
        description: 'Stop Amass after the specified number of minutes.',
        placeholder: '15',
        helpText: 'Leave blank to allow Amass to run to completion.',
      },
    ],
  },
  async execute(input, context) {
    const customFlags =
      input.customFlags && input.customFlags.length > 0 ? input.customFlags : null;

    const optionsSummary = {
      active: input.active ?? false,
      bruteForce: input.bruteForce ?? false,
      enableAlterations: input.enableAlterations ?? false,
      includeIps: input.includeIps ?? false,
      recursive: input.recursive ?? true,
      minForRecursive: input.minForRecursive ?? null,
      maxDepth: input.maxDepth ?? null,
      dnsQueryRate: input.dnsQueryRate ?? null,
      verbose: input.verbose ?? false,
      demoMode: input.demoMode ?? false,
      timeoutMinutes: input.timeoutMinutes ?? null,
      customFlags,
    };

    context.logger.info(
      `[Amass] Enumerating ${input.domains.length} domain(s) with options: ${JSON.stringify(optionsSummary)}`,
    );

    context.emitProgress({
      message: 'Launching Amass enumeration container…',
      level: 'info',
      data: { domains: input.domains, options: optionsSummary },
    });

    const normalizedInput: Input = {
      ...input,
      customFlags: customFlags ?? undefined,
    };

    const result = await runComponentWithRunner(
      this.runner,
      async () => ({}) as Output,
      normalizedInput,
      context,
    );

    if (typeof result === 'string') {
      try {
        const parsed = JSON.parse(result);
        return outputSchema.parse(parsed);
      } catch (error) {
        context.logger.error(`[Amass] Failed to parse raw output: ${(error as Error).message}`);
        throw new ServiceError('Amass returned unexpected raw output format', {
          cause: error as Error,
          details: { outputType: typeof result },
        });
      }
    }

    const parsed = outputSchema.safeParse(result);
    if (!parsed.success) {
      context.logger.error('[Amass] Output validation failed', parsed.error);
      throw new ValidationError('Amass output validation failed', {
        cause: parsed.error,
        details: { issues: parsed.error.issues },
      });
    }

    context.logger.info(
      `[Amass] Found ${parsed.data.subdomainCount} unique subdomains across ${parsed.data.domainCount} domains`,
    );

    if (parsed.data.subdomainCount === 0) {
      context.emitProgress({
        message: 'No subdomains discovered by Amass',
        level: 'warn',
      });
    } else {
      context.emitProgress({
        message: `Amass discovered ${parsed.data.subdomainCount} subdomains`,
        level: 'info',
        data: { subdomains: parsed.data.subdomains.slice(0, 10) },
      });
    }

    return parsed.data;
  },
};

componentRegistry.register(definition);

export type { Input as AmassInput, Output as AmassOutput };

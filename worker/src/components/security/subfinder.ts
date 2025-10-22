import { z } from 'zod';
import { componentRegistry, ComponentDefinition, runComponentWithRunner, type DockerRunnerConfig } from '@shipsec/component-sdk';

const domainValueSchema = z.union([z.string(), z.array(z.string())]);

const inputSchema = z
  .object({
    domains: domainValueSchema.optional().describe('Array of target domains'),
    domain: domainValueSchema.optional().describe('Legacy single domain input'),
    providerConfigSecretId: z
      .string()
      .uuid()
      .optional()
      .describe('Secret containing provider-config.yaml for authenticated data sources'),
  })
  .transform(({ domains, domain, providerConfigSecretId }) => {
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

    addValue(domains);
    addValue(domain);

    return {
      domains: Array.from(values),
      providerConfigSecretId,
    };
  });

type Input = z.infer<typeof inputSchema>;

type Output = {
  subdomains: string[];
  rawOutput: string;
  domainCount: number;
  subdomainCount: number;
};

const outputSchema = z.object({
  subdomains: z.array(z.string()),
  rawOutput: z.string(),
  domainCount: z.number(),
  subdomainCount: z.number(),
});

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.subfinder.run',
  label: 'Subfinder',
  category: 'discovery',
  runner: {
    kind: 'docker',
    image: 'projectdiscovery/subfinder:latest',
    entrypoint: 'sh',
    network: 'bridge',
    command: [
      '-c',
      String.raw`set -eo pipefail

if [ -n "$SUBFINDER_PROVIDER_CONFIG_B64" ]; then
  CONFIG_DIR="$HOME/.config/subfinder"
  mkdir -p "$CONFIG_DIR"
  printf '%s' "$SUBFINDER_PROVIDER_CONFIG_B64" | base64 -d > "$CONFIG_DIR/provider-config.yaml"
fi

INPUT=$(cat)

DOMAINS=$(
  printf "%s" "$INPUT" |
  tr '"[],{}' '\n' |
  grep -E '^[A-Za-z0-9.-]+$' |
  grep -v '^domains$' |
  sed '/^$/d' || true
)

if [ -z "$DOMAINS" ]; then
  printf '{"subdomains":[],"rawOutput":"","domainCount":0,"subdomainCount":0}'
  exit 0
fi

RAW_FILE=$(mktemp)
DEDUP_FILE=$(mktemp)
trap 'rm -f "$RAW_FILE" "$DEDUP_FILE"' EXIT

DOMAIN_COUNT=0

for DOMAIN in $DOMAINS; do
  if [ -n "$DOMAIN" ]; then
    DOMAIN_COUNT=$((DOMAIN_COUNT + 1))
    (
      subfinder -silent -d "$DOMAIN" 2>/dev/null |
      sed 's/\r//g' |
      sed '/^$/d'
    ) >> "$RAW_FILE" || true
  fi
done

if [ ! -s "$RAW_FILE" ]; then
  printf '{"subdomains":[],"rawOutput":"","domainCount":%d,"subdomainCount":0}' "$DOMAIN_COUNT"
  exit 0
fi

sort -u "$RAW_FILE" > "$DEDUP_FILE"
SUBDOMAIN_COUNT=$(wc -l < "$DEDUP_FILE" | tr -d ' ')

SUBDOMAIN_JSON=$(awk 'NR==1{printf("[\"%s\"", $0); next} {printf(",\"%s\"", $0)} END {if (NR==0) printf("[]"); else printf("]");}' "$DEDUP_FILE")

RAW_OUTPUT_ESCAPED=$(printf '%s' "$(cat "$RAW_FILE")" | sed ':a;N;$!ba;s/\\/\\\\/g; s/"/\\"/g; s/\n/\\n/g')

printf '{"subdomains":%s,"rawOutput":"%s","domainCount":%d,"subdomainCount":%d}' \
  "$SUBDOMAIN_JSON" \
  "$RAW_OUTPUT_ESCAPED" \
  "$DOMAIN_COUNT" \
  "$SUBDOMAIN_COUNT"
`,
    ],
    timeoutSeconds: 120,
    env: {
      HOME: '/root',
    },
  },
  inputSchema,
  outputSchema,
  docs: 'Runs projectdiscovery/subfinder to discover subdomains for a given domain. Optionally accepts a provider config secret to enable authenticated sources.',
  metadata: {
    slug: 'subfinder',
    version: '1.0.0',
    type: 'scan',
    category: 'security-tool',
    description: 'Discover subdomains for a target domain using ProjectDiscovery subfinder.',
    documentation: 'ProjectDiscovery Subfinder documentation details configuration, data sources, and usage examples.',
    documentationUrl: 'https://github.com/projectdiscovery/subfinder',
    icon: 'Radar',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: '`subfinder -d example.com -silent` - Passively gathers subdomains before chaining into deeper discovery tools.',
    inputs: [
      {
        id: 'domains',
        label: 'Target Domains',
        type: 'array',
        required: true,
        description: 'Array of domain names to enumerate for subdomains.',
      },
    ],
    outputs: [
      {
        id: 'subdomains',
        label: 'Discovered Subdomains',
        type: 'array',
        description: 'Array of all subdomain hostnames discovered.',
      },
      {
        id: 'rawOutput',
        label: 'Raw Output',
        type: 'string',
        description: 'Raw tool output for debugging.',
      },
    ],
    examples: [
      'Enumerate subdomains for a single target domain prior to Amass or Naabu.',
      'Quick passive discovery during scope triage workflows.',
    ],
    parameters: [
      {
        id: 'providerConfigSecretId',
        label: 'Provider Config Secret',
        type: 'secret',
        required: false,
        description: 'Secret containing a subfinder provider-config YAML file to enable authenticated sources.',
        helpText: 'Store the YAML contents as a secret. The worker will mount it inside the container before execution.',
      },
    ],
  },
  async execute(input, context) {
    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new Error('Subfinder runner is expected to be docker-based.');
    }

    const runnerConfig: DockerRunnerConfig = {
      ...baseRunner,
      env: { ...(baseRunner.env ?? {}) },
    };

    if (input.providerConfigSecretId) {
      if (!context.secrets) {
        throw new Error('Subfinder component requires the secrets service to load provider credentials.');
      }
      context.emitProgress('Loading provider configuration secret for subfinder...');
      const secret = await context.secrets.get(input.providerConfigSecretId);
      if (!secret) {
        throw new Error(`Secret ${input.providerConfigSecretId} not found or has no active version.`);
      }

      const encoded = Buffer.from(secret.value, 'utf8').toString('base64');

      if (runnerConfig.kind === 'docker') {
        runnerConfig.env = {
          ...(runnerConfig.env ?? {}),
          SUBFINDER_PROVIDER_CONFIG_B64: encoded,
        };
      }

      context.logger.info('[Subfinder] Provider configuration secret injected into runner environment.');
    }

    const result = await runComponentWithRunner(
      runnerConfig,
      async () => ({}),
      input,
      context,
    );

    if (typeof result === 'string') {
      const rawOutput = result;
      const subdomains = rawOutput
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

      return {
        subdomains,
        rawOutput,
        domainCount: input.domains.length,
        subdomainCount: subdomains.length,
      };
    }

    if (result && typeof result === 'object') {
      const parsed = outputSchema.safeParse(result);
      if (parsed.success) {
        return parsed.data;
      }

      // Fallback: attempt to normalise unexpected object shapes
      const maybeRaw = 'rawOutput' in result ? String((result as any).rawOutput ?? '') : '';
      const subdomainsValue = Array.isArray((result as any).subdomains)
        ? ((result as any).subdomains as unknown[])
            .map(value => (typeof value === 'string' ? value.trim() : String(value)))
            .filter(value => value.length > 0)
        : maybeRaw
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

      const output: Output = {
        subdomains: subdomainsValue,
        rawOutput: maybeRaw || subdomainsValue.join('\n'),
        domainCount: typeof (result as any).domainCount === 'number'
          ? (result as any).domainCount
          : input.domains.length,
        subdomainCount: typeof (result as any).subdomainCount === 'number'
          ? (result as any).subdomainCount
          : subdomainsValue.length,
      };

      return output;
    }

    return {
      subdomains: [],
      rawOutput: '',
      domainCount: input.domains.length,
      subdomainCount: 0,
    };
  },
};

componentRegistry.register(definition);

export type { Input as SubfinderInput, Output as SubfinderOutput };

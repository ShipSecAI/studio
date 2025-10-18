import { z } from 'zod';
import { componentRegistry, ComponentDefinition, runComponentWithRunner } from '@shipsec/component-sdk';

const inputSchema = z.object({
  domains: z.array(z.string()).describe('Array of target domains'),
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

INPUT=$(cat)

DOMAINS=$(printf "%s" "$INPUT" | tr '"[],{}' '\n' | grep -E '^[A-Za-z0-9.-]+$' | grep -v '^domains$' | sed '/^$/d')

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
    subfinder -silent -d "$DOMAIN" 2>/dev/null | sed 's/\r//g' | sed '/^$/d' >> "$RAW_FILE"
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
  docs: 'Runs projectdiscovery/subfinder to discover subdomains for a given domain.',
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
    parameters: [],
  },
  async execute(input, context) {
    const result = await runComponentWithRunner(
      this.runner,
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

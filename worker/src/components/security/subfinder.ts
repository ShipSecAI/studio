import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  runComponentWithRunner,
  type DockerRunnerConfig,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const domainValueSchema = z.union([z.string(), z.array(z.string())]);

const inputSchema = z
  .object({
    domains: domainValueSchema.optional().describe('Array of target domains'),
    domain: domainValueSchema.optional().describe('Legacy single domain input'),
    providerConfig: z
      .string()
      .optional()
      .describe('Resolved provider-config.yaml content (connect via Secret Loader)'),
  })
  .transform(({ domains, domain, providerConfig }) => {
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
      providerConfig: typeof providerConfig === 'string' && providerConfig.trim().length > 0
        ? providerConfig
        : undefined,
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

const SUBFINDER_TIMEOUT_SECONDS = 1800; // 30 minutes

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.subfinder.run',
  label: 'Subfinder',
  category: 'security',
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

# NOTE: We intentionally DO NOT use the -json flag for subfinder
# Reason: Subfinder's -json outputs JSONL (one JSON per line), not a JSON array
# JSONL requires line-by-line parsing: output.split('\n').map(line => JSON.parse(line))
# Plain text is simpler: output.split('\n').filter(line => line.length > 0)
# See docs/component-development.md "Output Format Selection" for details
subfinder -silent -dL /inputs/domains.txt 2>/dev/null || true
`,
      ],
    timeoutSeconds: SUBFINDER_TIMEOUT_SECONDS,
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
    category: 'security',
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
        dataType: port.list(port.text()),
        required: true,
        description: 'Array of domain names to enumerate for subdomains.',
      },
      {
        id: 'providerConfig',
        label: 'Provider Config',
        dataType: port.secret(),
        required: false,
        description: 'Connect the provider-config.yaml contents via a Secret Loader if authenticated sources are needed.',
      },
    ],
    outputs: [
      {
        id: 'subdomains',
        label: 'Discovered Subdomains',
        dataType: port.list(port.text()),
        description: 'Array of all subdomain hostnames discovered.',
      },
      {
        id: 'rawOutput',
        label: 'Raw Output',
        dataType: port.text(),
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
    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new Error('Subfinder runner is expected to be docker-based.');
    }

    if (input.domains.length === 0) {
      return {
        subdomains: [],
        rawOutput: '',
        domainCount: 0,
        subdomainCount: 0,
      };
    }

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);

    try {
      await volume.initialize({
        'domains.txt': input.domains.join('\n'),
      });
      context.logger.info(`[Subfinder] Created isolated volume for ${input.domains.length} domain(s).`);

      const runnerConfig: DockerRunnerConfig = {
        ...baseRunner,
        env: { ...(baseRunner.env ?? {}) },
        volumes: [volume.getVolumeConfig('/inputs', true)],
      };

      if (input.providerConfig) {
        const encoded = Buffer.from(input.providerConfig, 'utf8').toString('base64');

        runnerConfig.env = {
          ...(runnerConfig.env ?? {}),
          SUBFINDER_PROVIDER_CONFIG_B64: encoded,
        };

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
        const dedupedSubdomains = Array.from(
          new Set(
            rawOutput
              .split('\n')
              .map(line => line.trim())
              .filter(line => line.length > 0),
          ),
        );

        return {
          subdomains: dedupedSubdomains,
          rawOutput,
          domainCount: input.domains.length,
          subdomainCount: dedupedSubdomains.length,
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
    } finally {
      await volume.cleanup();
      context.logger.info('[Subfinder] Cleaned up isolated volume.');
    }
  },
};

componentRegistry.register(definition);

export type { Input as SubfinderInput, Output as SubfinderOutput };

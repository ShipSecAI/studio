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

const domainValueSchema = z.preprocess(
  (val) => (typeof val === 'string' ? [val] : val),
  z.array(z.string().min(1)),
);

const inputSchema = inputs({
  domains: port(domainValueSchema.optional().describe('Array of target domains'), {
    label: 'Target Domains',
    description: 'Array of domain names to enumerate for subdomains.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
  }),
  providerConfig: port(
    z
      .string()
      .optional()
      .describe('Resolved provider-config.yaml content (connect via Secret Loader)'),
    {
      label: 'Provider Config',
      description:
        'Connect the provider-config.yaml contents via a Secret Loader if authenticated sources are needed.',
      editor: 'secret',
      connectionType: { kind: 'primitive', name: 'secret' },
    },
  ),
});

const parameterSchema = parameters({
  domain: param(z.string().optional().describe('Legacy single domain input'), {
    label: 'Legacy Domain',
    editor: 'text',
    description: 'Legacy single-domain input (prefer Target Domains).',
    visibleWhen: { __legacy: true },
  }),
});

const outputSchema = outputs({
  subdomains: port(z.array(z.string()), {
    label: 'Discovered Subdomains',
    description: 'Array of all subdomain hostnames discovered.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw tool output for debugging.',
  }),
  domainCount: port(z.number(), {
    label: 'Domain Count',
    description: 'Number of domains scanned.',
  }),
  subdomainCount: port(z.number(), {
    label: 'Subdomain Count',
    description: 'Number of subdomains discovered.',
  }),
});

const SUBFINDER_TIMEOUT_SECONDS = 1800; // 30 minutes

// Retry policy for Subfinder - long-running discovery operations
const subfinderRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2, // Only retry once for expensive scans
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2.0,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'shipsec.subfinder.run',
  label: 'Subfinder',
  category: 'security',
  retryPolicy: subfinderRetryPolicy,
  runner: {
    kind: 'docker',
    image: 'projectdiscovery/subfinder:v2.10.1',
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
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs projectdiscovery/subfinder to discover subdomains for a given domain. Optionally accepts a provider config secret to enable authenticated sources.',
  ui: {
    slug: 'subfinder',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Discover subdomains for a target domain using ProjectDiscovery subfinder.',
    documentation:
      'ProjectDiscovery Subfinder documentation details configuration, data sources, and usage examples.',
    documentationUrl: 'https://github.com/projectdiscovery/subfinder',
    icon: 'Radar',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`subfinder -d example.com -silent` - Passively gathers subdomains before chaining into deeper discovery tools.',
    examples: [
      'Enumerate subdomains for a single target domain prior to Amass or Naabu.',
      'Quick passive discovery during scope triage workflows.',
    ],
  },
  async execute({ inputs, params }, context) {
    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Subfinder runner is expected to be docker-based.', {
        details: { expectedKind: 'docker', actualKind: baseRunner.kind },
      });
    }

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

    addValue(inputs.domains);
    addValue(params.domain);

    const domains = Array.from(values);
    const providerConfig =
      typeof inputs.providerConfig === 'string' && inputs.providerConfig.trim().length > 0
        ? inputs.providerConfig
        : undefined;

    if (domains.length === 0) {
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
        'domains.txt': domains.join('\n'),
      });
      context.logger.info(`[Subfinder] Created isolated volume for ${domains.length} domain(s).`);

      const runnerConfig: DockerRunnerConfig = {
        ...baseRunner,
        env: { ...(baseRunner.env ?? {}) },
        volumes: [volume.getVolumeConfig('/inputs', true)],
      };

      if (providerConfig) {
        const encoded = Buffer.from(providerConfig, 'utf8').toString('base64');

        runnerConfig.env = {
          ...(runnerConfig.env ?? {}),
          SUBFINDER_PROVIDER_CONFIG_B64: encoded,
        };

        context.logger.info(
          '[Subfinder] Provider configuration secret injected into runner environment.',
        );
      }

      const result = await runComponentWithRunner(
        runnerConfig,
        async () => ({}),
        { domains, providerConfig },
        context,
      );

      if (typeof result === 'string') {
        const rawOutput = result;
        const dedupedSubdomains = Array.from(
          new Set(
            rawOutput
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0),
          ),
        );

        return {
          subdomains: dedupedSubdomains,
          rawOutput,
          domainCount: domains.length,
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
              .map((value) => (typeof value === 'string' ? value.trim() : String(value)))
              .filter((value) => value.length > 0)
          : maybeRaw
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0);

        const output: Output = {
          subdomains: subdomainsValue,
          rawOutput: maybeRaw || subdomainsValue.join('\n'),
          domainCount:
            typeof (result as any).domainCount === 'number'
              ? (result as any).domainCount
              : domains.length,
          subdomainCount:
            typeof (result as any).subdomainCount === 'number'
              ? (result as any).subdomainCount
              : subdomainsValue.length,
        };

        return output;
      }

      return {
        subdomains: [],
        rawOutput: '',
        domainCount: domains.length,
        subdomainCount: 0,
      };
    } finally {
      await volume.cleanup();
      context.logger.info('[Subfinder] Cleaned up isolated volume.');
    }
  },
});

componentRegistry.register(definition);

type Output = (typeof outputSchema)['__inferred'];

type SubfinderInput = typeof inputSchema;
type SubfinderOutput = typeof outputSchema;

export type { SubfinderInput, SubfinderOutput };

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

const ASSETFINDER_IMAGE = 'lotuseatersec/assetfinder:latest';
const ASSETFINDER_TIMEOUT_SECONDS = 300;

const inputSchema = inputs({
    targets: port(
        z.array(z.string().min(1)).min(1, 'At least one domain is required'),
        {
            label: 'Targets',
            description: 'Target domains to find related domains and subdomains.',
            connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
        },
    ),
});

const parameterSchema = parameters({
    subsOnly: param(z.boolean().default(false), {
        label: 'Subdomains Only',
        editor: 'boolean',
        description: 'Only return subdomains of the target domain (--subs-only flag).',
    }),
    fbAppId: param(z.string().optional(), {
        label: 'Facebook App ID',
        editor: 'text',
        description: 'Facebook App ID for additional subdomain discovery (optional).',
    }),
    fbAppSecret: param(z.string().optional(), {
        label: 'Facebook App Secret',
        editor: 'secret',
        description: 'Facebook App Secret for additional subdomain discovery (optional).',
    }),
    vtApiKey: param(z.string().optional(), {
        label: 'VirusTotal API Key',
        editor: 'secret',
        description: 'VirusTotal API key for additional subdomain discovery (optional).',
    }),
    spyseApiToken: param(z.string().optional(), {
        label: 'Spyse API Token',
        editor: 'secret',
        description: 'Spyse API token for findsubdomains source (optional).',
    }),
});

const outputSchema = outputs({
    subdomains: port(z.array(z.string()), {
        label: 'Subdomains',
        description: 'List of discovered domains and subdomains.',
        connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    }),
    rawOutput: port(z.string(), {
        label: 'Raw Output',
        description: 'Raw assetfinder output for debugging.',
    }),
    count: port(z.number(), {
        label: 'Count',
        description: 'Number of discovered subdomains.',
    }),
});

type Output = z.infer<typeof outputSchema>;

// Retry policy for Assetfinder
const assetfinderRetryPolicy: ComponentRetryPolicy = {
    maxAttempts: 3,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2.0,
    nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
    id: 'shipsec.assetfinder.run',
    label: 'Assetfinder',
    category: 'security',
    retryPolicy: assetfinderRetryPolicy,
    runner: {
        kind: 'docker',
        image: ASSETFINDER_IMAGE,
        entrypoint: 'sh',
        network: 'bridge',
        timeoutSeconds: ASSETFINDER_TIMEOUT_SECONDS,
        command: ['-c', 'assetfinder "$@"', '--'],
    },
    inputs: inputSchema,
    outputs: outputSchema,
    parameters: parameterSchema,
    docs: 'Find domains and subdomains related to a given domain using multiple sources (crt.sh, certspotter, hackertarget, wayback machine, etc.).',
    ui: {
        slug: 'assetfinder',
        version: '1.0.0',
        type: 'scan',
        category: 'security',
        description:
            'Discover subdomains and related domains using passive reconnaissance sources.',
        documentation: 'https://github.com/tomnomnom/assetfinder',
        icon: 'Search',
        author: {
            name: 'ShipSecAI',
            type: 'shipsecai',
        },
        isLatest: true,
        deprecated: false,
        example: 'assetfinder --subs-only example.com',
        examples: [
            'Basic scan: Enter target domain to discover all related domains',
            'Subdomains only: Enable "Subdomains Only" to filter results',
            'Enhanced scan: Add API keys for Facebook, VirusTotal, Spyse for more results',
        ],
    },
    async execute({ inputs, params }, context) {
        const parsedParams = parameterSchema.parse(params);
        const { targets } = inputs;
        const { subsOnly, fbAppId, fbAppSecret, vtApiKey, spyseApiToken } = parsedParams;

        const normalizedTargets = targets
            .map((t: string) => t.trim())
            .filter((t: string) => t.length > 0);

        if (normalizedTargets.length === 0) {
            context.logger.info('[Assetfinder] No targets provided, skipping execution.');
            return outputSchema.parse({
                subdomains: [],
                rawOutput: '',
                count: 0,
            });
        }

        // Assetfinder processes one domain at a time
        const domain = normalizedTargets[0];

        context.logger.info(`[Assetfinder] Finding subdomains for: ${domain}`);
        context.emitProgress(`Discovering subdomains for ${domain}`);

        const baseRunner = definition.runner;
        if (baseRunner.kind !== 'docker') {
            throw new ContainerError('Assetfinder runner must be docker', {
                details: { expectedKind: 'docker', actualKind: baseRunner.kind },
            });
        }

        // Build command arguments
        const args: string[] = [];
        if (subsOnly) {
            args.push('--subs-only');
        }
        args.push(domain);

        // Build environment variables for API keys
        const env: Record<string, string> = {};
        if (fbAppId && fbAppSecret) {
            env.FB_APP_ID = fbAppId;
            env.FB_APP_SECRET = fbAppSecret;
        }
        if (vtApiKey) {
            env.VT_API_KEY = vtApiKey;
        }
        if (spyseApiToken) {
            env.SPYSE_API_TOKEN = spyseApiToken;
        }

        const runnerConfig: DockerRunnerConfig = {
            kind: 'docker',
            image: baseRunner.image,
            network: baseRunner.network,
            timeoutSeconds: baseRunner.timeoutSeconds ?? ASSETFINDER_TIMEOUT_SECONDS,
            entrypoint: baseRunner.entrypoint,
            command: [...(baseRunner.command ?? []), ...args],
            env: Object.keys(env).length > 0 ? env : undefined,
        };

        const rawPayload = await runComponentWithRunner(
            runnerConfig,
            async () => ({}) as Output,
            { ...inputs, ...parsedParams },
            context,
        );

        // Parse output
        let rawOutput = '';
        if (typeof rawPayload === 'string') {
            rawOutput = rawPayload;
        } else if (rawPayload && typeof rawPayload === 'object') {
            const payload = rawPayload as Record<string, unknown>;
            rawOutput = typeof payload.stdout === 'string' ? payload.stdout : '';
        }

        // Parse subdomains from output (one per line)
        const subdomains = rawOutput
            .split(/\r?\n/)
            .map((line: string) => line.trim())
            .filter((line: string) => line.length > 0);

        // Remove duplicates
        const uniqueSubdomains = [...new Set(subdomains)];

        context.logger.info(
            `[Assetfinder] Found ${uniqueSubdomains.length} unique subdomain(s) for ${domain}`
        );

        return outputSchema.parse({
            subdomains: uniqueSubdomains,
            rawOutput,
            count: uniqueSubdomains.length,
        });
    },
});

componentRegistry.register(definition);

export type { Output as AssetfinderOutput };

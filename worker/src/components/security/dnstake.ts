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

const DNSTAKE_IMAGE = 'myr3p0/dnstake:latest';
const DNSTAKE_TIMEOUT_SECONDS = 300;

const inputSchema = inputs({
    targets: port(
        z.array(z.string().min(1, 'Target cannot be empty')).min(1, 'At least one target is required'),
        {
            label: 'Targets',
            description: 'Domains or subdomains to check for DNS takeover vulnerabilities.',
            connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
        },
    ),
});

const parameterSchema = parameters({
    concurrency: param(z.number().int().min(1).max(100).default(25), {
        label: 'Concurrency',
        editor: 'number',
        min: 1,
        max: 100,
        description: 'Number of concurrent checks to run.',
    }),
    silent: param(z.boolean().default(true), {
        label: 'Silent Mode',
        editor: 'boolean',
        description: 'Suppress errors and output only vulnerable domains.',
    }),
});

// Schema for vulnerable domain result
const vulnerableResultSchema = z.object({
    domain: z.string(),
    nameservers: z.array(z.string()).optional(),
    provider: z.string().optional(),
    vulnerable: z.boolean(),
});

type VulnerableResult = z.infer<typeof vulnerableResultSchema>;

const outputSchema = outputs({
    vulnerableDomains: port(z.array(vulnerableResultSchema), {
        label: 'Vulnerable Domains',
        description: 'Domains vulnerable to DNS takeover.',
        connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
    }),
    rawOutput: port(z.string(), {
        label: 'Raw Output',
        description: 'Raw dnstake output for debugging.',
    }),
    targetCount: port(z.number(), {
        label: 'Target Count',
        description: 'Number of targets checked.',
    }),
    vulnerableCount: port(z.number(), {
        label: 'Vulnerable Count',
        description: 'Number of vulnerable domains found.',
    }),
});

type Output = z.infer<typeof outputSchema>;

// Retry policy for DNSTake
const dnstakeRetryPolicy: ComponentRetryPolicy = {
    maxAttempts: 3,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2.0,
    nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
    id: 'shipsec.dnstake.scan',
    label: 'DNSTake',
    category: 'security',
    retryPolicy: dnstakeRetryPolicy,
    runner: {
        kind: 'docker',
        image: DNSTAKE_IMAGE,
        entrypoint: 'sh',
        network: 'bridge',
        timeoutSeconds: DNSTAKE_TIMEOUT_SECONDS,
        command: ['-c', 'dnstake "$@"', '--'],
    },
    inputs: inputSchema,
    outputs: outputSchema,
    parameters: parameterSchema,
    docs: 'Check for missing hosted DNS zones that can lead to subdomain takeover. Detects vulnerable domains where nameservers point to unclaimed hosted zones on cloud providers like AWS Route 53, Azure, Akamai, etc.',
    ui: {
        slug: 'dnstake',
        version: '1.0.0',
        type: 'scan',
        category: 'security',
        description:
            'Fast tool to detect DNS takeover vulnerabilities by checking for missing hosted DNS zones.',
        documentation: 'https://github.com/pwnesia/dnstake',
        icon: 'Shield',
        author: {
            name: 'ShipSecAI',
            type: 'shipsecai',
        },
        isLatest: true,
        deprecated: false,
        example: 'dnstake -t domains.txt -c 25 -s',
        examples: [
            'Check single domain: Connect Entry Point with target domain',
            'Bulk scan: Connect Subfinder output to check all discovered subdomains',
            'Pipeline: Subfinder → DNSTake to find takeover opportunities',
        ],
    },
    async execute({ inputs, params }, context) {
        const parsedParams = parameterSchema.parse(params);
        const { targets } = inputs;
        const { concurrency, silent } = parsedParams;

        const normalizedTargets = targets
            .map((t: string) => t.trim())
            .filter((t: string) => t.length > 0);

        const targetCount = normalizedTargets.length;

        if (targetCount === 0) {
            context.logger.info('[DNSTake] No targets provided, skipping execution.');
            return outputSchema.parse({
                vulnerableDomains: [],
                rawOutput: '',
                targetCount: 0,
                vulnerableCount: 0,
            });
        }

        context.logger.info(`[DNSTake] Checking ${targetCount} target(s) for DNS takeover vulnerabilities`);
        context.emitProgress(`Scanning ${targetCount} domain${targetCount === 1 ? '' : 's'} for DNS takeover`);

        const tenantId = (context as any).tenantId ?? 'default-tenant';
        const volume = new IsolatedContainerVolume(tenantId, context.runId);

        const baseRunner = definition.runner;
        if (baseRunner.kind !== 'docker') {
            throw new ContainerError('DNSTake runner must be docker', {
                details: { expectedKind: 'docker', actualKind: baseRunner.kind },
            });
        }

        let rawOutput = '';

        try {
            // Prepare input file
            const inputFiles: Record<string, string> = {
                'targets.txt': normalizedTargets.join('\n'),
            };

            const volumeName = await volume.initialize(inputFiles);
            context.logger.info(`[DNSTake] Created isolated volume: ${volumeName}`);

            // Build command arguments
            const args: string[] = [
                '-t', '/inputs/targets.txt',
                '-c', String(concurrency),
            ];

            if (silent) {
                args.push('-s');
            }

            const runnerConfig: DockerRunnerConfig = {
                kind: 'docker',
                image: baseRunner.image,
                network: baseRunner.network,
                timeoutSeconds: baseRunner.timeoutSeconds ?? DNSTAKE_TIMEOUT_SECONDS,
                entrypoint: baseRunner.entrypoint,
                command: [...(baseRunner.command ?? []), ...args],
                volumes: [volume.getVolumeConfig('/inputs', true)],
            };

            const rawPayload = await runComponentWithRunner(
                runnerConfig,
                async () => ({}) as Output,
                { ...inputs, ...parsedParams },
                context,
            );

            // Parse output
            if (typeof rawPayload === 'string') {
                rawOutput = rawPayload;
            } else if (rawPayload && typeof rawPayload === 'object') {
                const payload = rawPayload as Record<string, unknown>;
                rawOutput = typeof payload.stdout === 'string' ? payload.stdout : '';
            }

        } finally {
            await volume.cleanup();
            context.logger.info('[DNSTake] Cleaned up isolated volume');
        }

        // Parse vulnerable domains from output
        const vulnerableDomains = parseVulnerableOutput(rawOutput, context);

        context.logger.info(
            `[DNSTake] Scan complete: ${vulnerableDomains.length} vulnerable domain(s) found from ${targetCount} target(s)`
        );

        return outputSchema.parse({
            vulnerableDomains,
            rawOutput,
            targetCount,
            vulnerableCount: vulnerableDomains.length,
        });
    },
});

/**
 * Parse DNSTake output to extract vulnerable domains
 * DNSTake outputs vulnerable domains, one per line, with optional provider info
 */
function parseVulnerableOutput(raw: string, context: any): VulnerableResult[] {
    if (!raw || raw.trim().length === 0) {
        return [];
    }

    const lines = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const results: VulnerableResult[] = [];

    for (const line of lines) {
        // Skip non-result lines (banners, errors, etc.)
        if (line.startsWith('#') || line.startsWith('[') || line.includes('error')) {
            continue;
        }

        // DNSTake output format: domain [NS: ns1.provider.com, ns2.provider.com] [Provider]
        // Or just: domain (in silent mode)
        const domainMatch = line.match(/^([^\s\[]+)/);
        if (!domainMatch) {
            continue;
        }

        const domain = domainMatch[1];

        // Try to extract nameservers
        const nsMatch = line.match(/\[NS:\s*([^\]]+)\]/i);
        const nameservers = nsMatch
            ? nsMatch[1].split(',').map((ns) => ns.trim()).filter((ns) => ns.length > 0)
            : undefined;

        // Try to extract provider
        const providerMatch = line.match(/\[([A-Za-z0-9\s]+)\]$/);
        const provider = providerMatch ? providerMatch[1].trim() : undefined;

        results.push({
            domain,
            nameservers,
            provider,
            vulnerable: true,
        });
    }

    context.logger.info(`[DNSTake Parser] Parsed ${results.length} vulnerable domain(s)`);

    return results;
}

componentRegistry.register(definition);

export type { Output as DnstakeOutput };

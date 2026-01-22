import { z } from 'zod';
import { arch } from 'os';
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

// Auto-select image based on system architecture
const FINDOMAIN_IMAGE = arch() === 'arm64'
    ? 'thijsvos/findomain:buildx-linux-arm64'
    : 'thijsvos/findomain:buildx-linux-amd64';
const FINDOMAIN_TIMEOUT_SECONDS = 600;

const inputSchema = inputs({
    targets: port(
        z.array(z.string().min(1)).min(1, 'At least one target is required'),
        {
            label: 'Targets',
            description: 'Target domains to enumerate subdomains.',
            connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
        },
    ),
});

const parameterSchema = parameters({
    resolved: param(z.boolean().default(false), {
        label: 'Resolved Only',
        editor: 'boolean',
        description: 'Show only resolved subdomains (-r flag).',
    }),
    showIp: param(z.boolean().default(false), {
        label: 'Show IP',
        editor: 'boolean',
        description: 'Show IP address of resolved subdomains (-i flag).',
    }),
    quiet: param(z.boolean().default(true), {
        label: 'Quiet Mode',
        editor: 'boolean',
        description: 'Remove informative messages, output subdomains only (-q flag).',
    }),
    threads: param(z.number().int().min(1).max(200).default(50), {
        label: 'Threads',
        editor: 'number',
        min: 1,
        max: 200,
        description: 'Number of threads for lightweight tasks.',
    }),
    enableDot: param(z.boolean().default(false), {
        label: 'DNS over TLS',
        editor: 'boolean',
        description: 'Enable DNS over TLS for resolving subdomains.',
    }),
    httpStatus: param(z.boolean().default(false), {
        label: 'HTTP Status Check',
        editor: 'boolean',
        description: 'Check HTTP status of discovered subdomains.',
    }),
    filter: param(z.string().optional(), {
        label: 'Filter',
        editor: 'text',
        description: 'Filter subdomains containing specific strings.',
    }),
    exclude: param(z.string().optional(), {
        label: 'Exclude',
        editor: 'text',
        description: 'Exclude subdomains containing specific strings.',
    }),
    excludeSources: param(
        z.array(z.enum([
            'certspotter', 'crtsh', 'sublist3r', 'facebook', 'spyse',
            'threatcrowd', 'virustotalapikey', 'anubis', 'urlscan',
            'securitytrails', 'threatminer', 'c99', 'bufferover_free', 'bufferover_paid'
        ])).optional(),
        {
            label: 'Exclude Sources',
            editor: 'multi-select',
            options: [
                { label: 'Certspotter', value: 'certspotter' },
                { label: 'crt.sh', value: 'crtsh' },
                { label: 'Sublist3r', value: 'sublist3r' },
                { label: 'Facebook', value: 'facebook' },
                { label: 'Spyse', value: 'spyse' },
                { label: 'ThreatCrowd', value: 'threatcrowd' },
                { label: 'VirusTotal', value: 'virustotalapikey' },
                { label: 'Anubis', value: 'anubis' },
                { label: 'URLScan', value: 'urlscan' },
                { label: 'SecurityTrails', value: 'securitytrails' },
                { label: 'ThreatMiner', value: 'threatminer' },
                { label: 'C99', value: 'c99' },
                { label: 'BufferOver Free', value: 'bufferover_free' },
                { label: 'BufferOver Paid', value: 'bufferover_paid' },
            ],
            description: 'Exclude specific sources from subdomain search.',
        },
    ),
    rateLimit: param(z.number().int().min(0).max(60).optional(), {
        label: 'Rate Limit (seconds)',
        editor: 'number',
        min: 0,
        max: 60,
        description: 'Rate limit in seconds for each target during enumeration.',
    }),
});

const outputSchema = outputs({
    subdomains: port(z.array(z.string()), {
        label: 'Subdomains',
        description: 'List of discovered subdomains.',
        connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    }),
    rawOutput: port(z.string(), {
        label: 'Raw Output',
        description: 'Raw findomain output for debugging.',
    }),
    count: port(z.number(), {
        label: 'Count',
        description: 'Number of discovered subdomains.',
    }),
});

type Output = z.infer<typeof outputSchema>;

const findomainRetryPolicy: ComponentRetryPolicy = {
    maxAttempts: 3,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2.0,
    nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
    id: 'shipsec.findomain.run',
    label: 'Findomain',
    category: 'security',
    retryPolicy: findomainRetryPolicy,
    runner: {
        kind: 'docker',
        image: FINDOMAIN_IMAGE,
        entrypoint: 'sh',
        network: 'bridge',
        timeoutSeconds: FINDOMAIN_TIMEOUT_SECONDS,
        command: ['-c', 'findomain "$@"', '--'],
    },
    inputs: inputSchema,
    outputs: outputSchema,
    parameters: parameterSchema,
    docs: 'Fast subdomain enumeration using Certificate Transparency logs and multiple APIs. Supports IP resolution, HTTP status checks, and various filtering options.',
    ui: {
        slug: 'findomain',
        version: '1.0.0',
        type: 'scan',
        category: 'security',
        description:
            'The fastest subdomain enumerator using Certificate Transparency and multiple data sources.',
        documentation: 'https://github.com/Findomain/Findomain',
        icon: 'Search',
        author: {
            name: 'ShipSecAI',
            type: 'shipsecai',
        },
        isLatest: true,
        deprecated: false,
        example: 'findomain -t example.com -q',
        examples: [
            'Basic scan: Enter target domain to discover subdomains',
            'Resolved only: Enable "Resolved Only" to get only live subdomains',
            'With IPs: Enable "Show IP" to include IP addresses in results',
            'HTTP check: Enable "HTTP Status Check" to verify web servers',
        ],
    },
    async execute({ inputs, params }, context) {
        const parsedParams = parameterSchema.parse(params);
        const { targets } = inputs;
        const {
            resolved, showIp, quiet, threads, enableDot,
            httpStatus, filter, exclude, excludeSources, rateLimit
        } = parsedParams;

        const normalizedTargets = targets
            .map((t: string) => t.trim())
            .filter((t: string) => t.length > 0);

        if (normalizedTargets.length === 0) {
            context.logger.info('[Findomain] No targets provided, skipping execution.');
            return outputSchema.parse({
                subdomains: [],
                rawOutput: '',
                count: 0,
            });
        }

        // Findomain processes one target at a time, use the first one
        const target = normalizedTargets[0];

        context.logger.info(`[Findomain] Enumerating subdomains for: ${target}`);
        context.emitProgress(`Discovering subdomains for ${target}`);

        const baseRunner = definition.runner;
        if (baseRunner.kind !== 'docker') {
            throw new ContainerError('Findomain runner must be docker', {
                details: { expectedKind: 'docker', actualKind: baseRunner.kind },
            });
        }

        // Build command arguments
        const args: string[] = ['-t', target];

        if (resolved) {
            args.push('-r');
        }
        if (showIp) {
            args.push('-i');
        }
        if (quiet) {
            args.push('-q');
        }
        if (threads && threads !== 50) {
            args.push('--lightweight-threads', String(threads));
        }
        if (enableDot) {
            args.push('--enable-dot');
        }
        if (httpStatus) {
            args.push('--http-status');
        }
        if (filter) {
            args.push('--filter', filter);
        }
        if (exclude) {
            args.push('--exclude', exclude);
        }
        if (excludeSources && excludeSources.length > 0) {
            for (const source of excludeSources) {
                args.push('--exclude-sources', source);
            }
        }
        if (rateLimit && rateLimit > 0) {
            args.push('--rate-limit', String(rateLimit));
        }

        const runnerConfig: DockerRunnerConfig = {
            kind: 'docker',
            image: baseRunner.image,
            network: baseRunner.network,
            timeoutSeconds: baseRunner.timeoutSeconds ?? FINDOMAIN_TIMEOUT_SECONDS,
            entrypoint: baseRunner.entrypoint,
            command: [...(baseRunner.command ?? []), ...args],
        };

        context.logger.info(`[Findomain] Running with args: ${JSON.stringify(args)}`);
        context.logger.info(`[Findomain] Full runnerConfig command: ${JSON.stringify(runnerConfig.command)}`);

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
        const lines = rawOutput
            .split(/\r?\n/)
            .map((line: string) => line.trim())
            .filter((line: string) => line.length > 0);

        // Filter out non-subdomain lines (info messages, errors)
        const subdomains = lines.filter((line: string) => {
            // Skip lines that look like info messages
            if (line.startsWith('[') || line.includes('>>') || line.includes('<<')) {
                return false;
            }
            // Basic domain validation
            return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(line.split(/\s+/)[0]);
        }).map((line: string) => line.split(/\s+/)[0]); // Take first part (domain) if IP is included

        // Remove duplicates
        const uniqueSubdomains = [...new Set(subdomains)];

        context.logger.info(
            `[Findomain] Found ${uniqueSubdomains.length} unique subdomain(s) for ${target}`
        );

        return outputSchema.parse({
            subdomains: uniqueSubdomains,
            rawOutput,
            count: uniqueSubdomains.length,
        });
    },
});

componentRegistry.register(definition);

export type { Output as FindomainOutput };

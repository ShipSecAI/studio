import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  runComponentWithRunner,
} from '@shipsec/component-sdk';
import type { DockerRunnerConfig } from '@shipsec/component-sdk';
import { awsCredentialSchema } from '@shipsec/contracts';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const cartographyModules = ['aws', 'github', 'kubernetes'] as const;

type CartographyModule = (typeof cartographyModules)[number];

const inputSchema = inputs({
  credentials: port(
    awsCredentialSchema().optional().describe('AWS credentials for Cartography AWS module sync.'),
    {
      label: 'AWS Credentials',
      description:
        'Structured credentials object (`{ accessKeyId, secretAccessKey, sessionToken? }`). Required when syncing AWS.',
      connectionType: { kind: 'contract', name: 'core.credential.aws', credential: true },
    },
  ),
  githubToken: port(
    z.string().optional().describe('GitHub personal access token for the GitHub module.'),
    {
      label: 'GitHub Token',
      description: 'PAT with repo and org:read scopes for GitHub organization sync.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  githubOrg: port(z.string().optional().describe('GitHub organization name to sync.'), {
    label: 'GitHub Organization',
    description: 'The GitHub organization to discover repos, teams, and members from.',
    connectionType: { kind: 'primitive', name: 'text' },
  }),
});

const parameterSchema = parameters({
  selectedModules: param(
    z
      .array(z.enum(cartographyModules))
      .default(['aws'])
      .describe('Cartography intel modules to run during sync.'),
    {
      label: 'Selected Modules',
      editor: 'multi-select',
      description: 'Choose which infrastructure providers to sync into the graph.',
      options: [
        { value: 'aws', label: 'AWS' },
        { value: 'github', label: 'GitHub' },
        { value: 'kubernetes', label: 'Kubernetes' },
      ],
    },
  ),
  neo4jUri: param(
    z
      .string()
      .default('bolt://neo4j:7687')
      .describe('Neo4j Bolt URI for Cartography to write the infrastructure graph.'),
    {
      label: 'Neo4j URI',
      editor: 'text',
      description:
        'Bolt protocol URI for the Neo4j instance. Defaults to the platform Neo4j service.',
    },
  ),
  awsRegions: param(
    z.string().optional().describe('Comma-separated AWS regions to limit the sync scope.'),
    {
      label: 'AWS Regions',
      editor: 'text',
      placeholder: 'us-east-1,us-west-2,eu-west-1',
      description: 'Restrict AWS sync to specific regions. Leave empty for all regions.',
    },
  ),
  awsBestEffort: param(
    z.boolean().default(true).describe('Continue sync on partial AWS API failures.'),
    {
      label: 'Best Effort Mode',
      editor: 'checkbox',
      description:
        'When enabled, Cartography continues even if some AWS API calls fail (e.g., missing permissions).',
    },
  ),
});

const syncResultSchema = z.object({
  module: z.string(),
  status: z.enum(['success', 'failed', 'skipped']),
  error: z.string().optional(),
});

const outputSchema = outputs({
  syncId: port(z.string(), {
    label: 'Sync ID',
    description: 'Unique identifier for this sync run.',
  }),
  status: port(z.enum(['success', 'partial', 'failed']), {
    label: 'Status',
    description: 'Overall sync status.',
  }),
  moduleResults: port(z.array(syncResultSchema), {
    label: 'Module Results',
    description: 'Per-module sync results.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  neo4jUri: port(z.string(), {
    label: 'Neo4j URI',
    description: 'The Neo4j URI that was synced to, for passing to query components.',
  }),
  command: port(z.array(z.string()), {
    label: 'Command',
    description: 'Cartography CLI arguments used during the sync.',
  }),
  stderr: port(z.string(), {
    label: 'Stderr',
    description: 'Standard error output from Cartography.',
  }),
  durationMs: port(z.number(), {
    label: 'Duration (ms)',
    description: 'Time taken to complete the sync in milliseconds.',
  }),
});

const retryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 30,
  maximumIntervalSeconds: 120,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ConfigurationError', 'ValidationError'],
};

const definition = defineComponent({
  id: 'security.cartography.sync',
  label: 'Cartography Sync',
  category: 'security',
  retryPolicy,
  runner: {
    kind: 'docker',
    image: 'ghcr.io/cartography-cncf/cartography:latest',
    platform: 'linux/amd64',
    command: [],
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run Cartography (CNCF) to discover and map infrastructure assets into a Neo4j graph database. Supports AWS, GitHub, and Kubernetes providers. The resulting graph can be queried via the Cartography Query component for blast radius analysis, asset inventory, and security posture assessment.',
  toolProvider: {
    kind: 'component',
    name: 'cartography_sync',
    description:
      'Sync infrastructure assets into the Cartography Neo4j graph (AWS, GitHub, Kubernetes).',
  },
  ui: {
    slug: 'cartography-sync',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Discover and map infrastructure assets from AWS, GitHub, and Kubernetes into a Neo4j graph using Cartography (CNCF). Enables blast radius analysis, asset inventory, and security posture queries.',
    documentation: 'https://github.com/cartography-cncf/cartography',
    icon: 'Network',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Schedule a nightly Cartography sync to keep the infrastructure graph up to date with your AWS accounts.',
      'Sync GitHub organization data to map repository access, team memberships, and CI/CD action dependencies.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);
    const startTime = Date.now();

    const selectedModules = parsedParams.selectedModules as CartographyModule[];
    if (selectedModules.length === 0) {
      return outputSchema.parse({
        syncId: buildSyncId(),
        status: 'failed',
        moduleResults: [],
        neo4jUri: parsedParams.neo4jUri,
        command: [],
        stderr: 'No modules selected.',
        durationMs: Date.now() - startTime,
      });
    }

    // Validate credentials for selected modules
    if (selectedModules.includes('aws') && !parsedInputs.credentials) {
      throw new Error(
        'AWS module requires credentials. Connect an AWS Credentials component to the credentials input.',
      );
    }
    if (selectedModules.includes('github') && !parsedInputs.githubToken) {
      throw new Error(
        'GitHub module requires a personal access token. Provide a token in the githubToken input.',
      );
    }

    // Build Cartography CLI command
    const cmd: string[] = [
      '--neo4j-uri',
      parsedParams.neo4jUri,
      '--selected-modules',
      selectedModules.join(','),
    ];

    if (selectedModules.includes('aws')) {
      if (parsedParams.awsBestEffort) {
        cmd.push('--aws-best-effort-mode');
      }
      if (parsedParams.awsRegions) {
        const regions = parsedParams.awsRegions
          .split(',')
          .map((r) => r.trim())
          .filter((r) => r.length > 0);
        if (regions.length > 0) {
          cmd.push(
            '--aws-requested-syncs',
            'ec2,s3,iam,lambda,rds,dynamodb,eks,kms,secretsmanager,guardduty',
          );
        }
      }
    }

    context.logger.info(
      `[CartographySync] Running cartography with modules: ${selectedModules.join(', ')}`,
    );
    context.emitProgress(`Syncing infrastructure graph: ${selectedModules.join(', ')} modules`);

    // Prepare environment variables
    const env: Record<string, string> = {};
    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const awsCredsVolume = parsedInputs.credentials
      ? new IsolatedContainerVolume(tenantId, `${context.runId}-cartography-aws`)
      : null;

    // AWS credentials
    if (parsedInputs.credentials) {
      env.AWS_ACCESS_KEY_ID = parsedInputs.credentials.accessKeyId;
      env.AWS_SECRET_ACCESS_KEY = parsedInputs.credentials.secretAccessKey;
      if (parsedInputs.credentials.sessionToken) {
        env.AWS_SESSION_TOKEN = parsedInputs.credentials.sessionToken;
      }
      const region = parsedParams.awsRegions?.split(',')[0]?.trim() || 'us-east-1';
      env.AWS_DEFAULT_REGION = region;
      env.AWS_REGION = region;
    }

    // GitHub credentials
    if (parsedInputs.githubToken && parsedInputs.githubOrg) {
      const ghConfig = JSON.stringify({
        organization: [
          {
            token: parsedInputs.githubToken,
            url: 'https://api.github.com/graphql',
            name: parsedInputs.githubOrg,
          },
        ],
      });
      env.GITHUB_CONFIG = Buffer.from(ghConfig).toString('base64');
      cmd.push('--github-config-env-var', 'GITHUB_CONFIG');
    }

    const dockerRunner: DockerRunnerConfig = {
      kind: 'docker',
      image: 'ghcr.io/cartography-cncf/cartography:latest',
      platform: 'linux/amd64',
      network: 'shipsec-network',
      timeoutSeconds: 1800, // 30 minutes for full sync
      env,
      command: cmd,
      volumes: [],
    };

    let stderrCombined = '';
    let awsVolumeInitialized = false;

    try {
      // Mount AWS credentials if provided
      if (awsCredsVolume && parsedInputs.credentials) {
        const credsLines = [
          '[default]',
          `aws_access_key_id = ${parsedInputs.credentials.accessKeyId}`,
          `aws_secret_access_key = ${parsedInputs.credentials.secretAccessKey}`,
        ];
        if (parsedInputs.credentials.sessionToken) {
          credsLines.push(`aws_session_token = ${parsedInputs.credentials.sessionToken}`);
        }
        const cfgRegion = parsedParams.awsRegions?.split(',')[0]?.trim() || 'us-east-1';
        const cfgLines = ['[default]', `region = ${cfgRegion}`, 'output = json'];

        await awsCredsVolume.initialize({
          credentials: credsLines.join('\n'),
          config: cfgLines.join('\n'),
        });
        awsVolumeInitialized = true;
        context.logger.info(
          `[CartographySync] Created AWS creds volume: ${awsCredsVolume.getVolumeName()}`,
        );

        dockerRunner.volumes = [
          ...(dockerRunner.volumes ?? []),
          awsCredsVolume.getVolumeConfig('/var/cartography/.aws', true),
        ];
      }

      await runComponentWithRunner<Record<string, unknown>, unknown>(
        dockerRunner,
        async () => ({}) as unknown,
        {},
        context,
      );

      // Cartography exiting with code 0 means success
      const moduleResults = selectedModules.map((mod) => ({
        module: mod,
        status: 'success' as const,
      }));

      const syncId = buildSyncId();
      context.logger.info(`[CartographySync] Sync complete: ${syncId}`);

      return outputSchema.parse({
        syncId,
        status: 'success',
        moduleResults,
        neo4jUri: parsedParams.neo4jUri,
        command: cmd,
        stderr: stderrCombined,
        durationMs: Date.now() - startTime,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      stderrCombined = errorMessage;

      context.logger.error(`[CartographySync] Sync failed: ${errorMessage}`);

      const moduleResults = selectedModules.map((mod) => ({
        module: mod,
        status: 'failed' as const,
        error: errorMessage,
      }));

      return outputSchema.parse({
        syncId: buildSyncId(),
        status: 'failed',
        moduleResults,
        neo4jUri: parsedParams.neo4jUri,
        command: cmd,
        stderr: stderrCombined,
        durationMs: Date.now() - startTime,
      });
    } finally {
      if (awsVolumeInitialized && awsCredsVolume) {
        await awsCredsVolume.cleanup();
        context.logger.info('[CartographySync] Cleaned up AWS creds volume');
      }
    }
  },
});

function buildSyncId(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14);
  return `cartography-sync-${timestamp}`;
}

componentRegistry.register(definition);

type Input = (typeof inputSchema)['__inferred'];
type Output = (typeof outputSchema)['__inferred'];

export type { Input as CartographySyncInput, Output as CartographySyncOutput };

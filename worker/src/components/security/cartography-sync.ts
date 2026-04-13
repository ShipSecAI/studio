import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  createExecutionContext,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  runComponentWithRunner,
} from '@shipsec/component-sdk';
import type { DockerRunnerConfig } from '@shipsec/component-sdk';
import type { ExecutionContext } from '@shipsec/component-sdk';
import type { LogEventInput } from '@shipsec/component-sdk';
import { awsCredentialSchema } from '@shipsec/contracts';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const cartographyModules = ['aws', 'github', 'kubernetes'] as const;
const CARTOGRAPHY_IMAGE =
  process.env.CARTOGRAPHY_IMAGE?.trim() || 'ghcr.io/cartography-cncf/cartography:latest';
export const DEFAULT_NEO4J_URI = process.env.NEO4J_URI?.trim() || 'bolt://localhost:7687';
export const DEFAULT_NEO4J_DATABASE = process.env.NEO4J_DATABASE?.trim() || 'neo4j';
export const DEFAULT_AWS_REQUESTED_SYNCS =
  'iam,s3,dynamodb,ec2:instance,ec2:security_group,ec2:subnet,ec2:network_acls,ec2:vpc,ec2:volumes,ec2:load_balancer,ec2:load_balancer_v2,ecr,ecs,eks,elasticache,lambda_function,kms,rds,route53,apigateway,secretsmanager,sqs,acm:certificate,cloudfront,cloudtrail,guardduty,sns';

type CartographyModule = (typeof cartographyModules)[number];

export interface CartographyAwsProfileInput {
  profileName: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface CartographyRunnerInput {
  selectedModules: CartographyModule[];
  neo4jUri: string;
  neo4jDatabase: string;
  awsProfiles?: CartographyAwsProfileInput[];
  awsRegions?: string[];
  awsRequestedSyncs?: string;
  awsBestEffort?: boolean;
  githubConfigBase64?: string;
  image?: string;
}

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
      .default(DEFAULT_NEO4J_URI)
      .describe('Neo4j Bolt URI for Cartography to write the infrastructure graph.'),
    {
      label: 'Neo4j URI',
      editor: 'text',
      description:
        'Bolt protocol URI for the Neo4j instance. Defaults to NEO4J_URI or localhost for host-run dev workers.',
    },
  ),
  neo4jDatabase: param(
    z
      .string()
      .min(1)
      .default(DEFAULT_NEO4J_DATABASE)
      .describe('Neo4j database name for the Cartography graph.'),
    {
      label: 'Neo4j Database',
      editor: 'text',
      description:
        'Database to sync into. Use the default neo4j database locally, or set an org-scoped database for isolation.',
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
      editor: 'boolean',
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
  neo4jDatabase: port(z.string(), {
    label: 'Neo4j Database',
    description: 'The Neo4j database that received the sync.',
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

async function writeAwsProfileVolume(
  volume: IsolatedContainerVolume,
  profiles: CartographyAwsProfileInput[],
): Promise<void> {
  const credentialsBlocks: string[] = [];
  const configBlocks: string[] = [];

  for (const [index, profile] of profiles.entries()) {
    const credentialsHeader = index === 0 ? 'default' : profile.profileName;
    const configHeader = index === 0 ? '[default]' : `[profile ${profile.profileName}]`;

    credentialsBlocks.push(
      `[${credentialsHeader}]`,
      `aws_access_key_id = ${profile.accessKeyId}`,
      `aws_secret_access_key = ${profile.secretAccessKey}`,
    );
    if (profile.sessionToken) {
      credentialsBlocks.push(`aws_session_token = ${profile.sessionToken}`);
    }
    credentialsBlocks.push('');

    configBlocks.push(configHeader, `region = ${profile.region}`, 'output = json', '');
  }

  await volume.initialize({
    credentials: credentialsBlocks.join('\n'),
    config: configBlocks.join('\n'),
  });
}

export async function runCartographyWithRunner(
  input: CartographyRunnerInput,
  context: ExecutionContext,
): Promise<{ command: string[]; stdout: string; stderr: string; durationMs: number }> {
  const startTime = Date.now();
  const selectedModules = input.selectedModules;
  const image = input.image?.trim() || CARTOGRAPHY_IMAGE;
  const awsProfiles = input.awsProfiles ?? [];
  const tenantId = context.organizationId ?? 'default-tenant';
  const awsCredsVolume =
    awsProfiles.length > 0
      ? new IsolatedContainerVolume(tenantId, `${context.runId}-cartography-aws`)
      : null;

  const command: string[] = [
    '--neo4j-uri',
    input.neo4jUri,
    '--neo4j-database',
    input.neo4jDatabase,
    '--selected-modules',
    selectedModules.join(','),
  ];

  if (selectedModules.includes('aws')) {
    if (input.awsBestEffort ?? true) {
      command.push('--aws-best-effort-mode');
    }
    if (input.awsRegions && input.awsRegions.length > 0) {
      command.push('--aws-regions', input.awsRegions.join(','));
    }
    command.push(
      '--aws-requested-syncs',
      input.awsRequestedSyncs?.trim() || DEFAULT_AWS_REQUESTED_SYNCS,
    );
    if (awsProfiles.length > 1) {
      command.push('--aws-sync-all-profiles');
    }
  }

  if (selectedModules.includes('github') && input.githubConfigBase64) {
    command.push('--github-config-env-var', 'GITHUB_CONFIG');
  }

  const env: Record<string, string> = {};
  const primaryAwsProfile = awsProfiles[0];
  if (primaryAwsProfile) {
    env.AWS_DEFAULT_REGION = primaryAwsProfile.region;
    env.AWS_REGION = primaryAwsProfile.region;
  }
  if (input.githubConfigBase64) {
    env.GITHUB_CONFIG = input.githubConfigBase64;
  }

  const dockerRunner: DockerRunnerConfig = {
    kind: 'docker',
    image,
    platform: 'linux/amd64',
    network: 'shipsec-network' as unknown as DockerRunnerConfig['network'],
    timeoutSeconds: 1800,
    expectOutputFile: false,
    env,
    command,
    volumes: [],
  };

  let stdout = '';
  let stderr = '';
  const logCollector = (entry: LogEventInput) => {
    if (entry.stream === 'stderr') {
      stderr += entry.message;
    } else if (entry.stream === 'stdout') {
      stdout += entry.message;
    }
  };

  const runnerContext = createExecutionContext({
    runId: context.runId,
    componentRef: context.componentRef,
    organizationId: context.organizationId ?? null,
    workflowId: context.workflowId,
    workflowName: context.workflowName,
    triggerSource: context.triggerSource ?? null,
    triggerType: context.triggerType ?? null,
    metadata: context.metadata,
    trace: context.trace,
    logCollector,
    terminalCollector: context.terminalCollector,
    agentTracePublisher: context.agentTracePublisher,
    runContext: context.runContext,
  });

  try {
    if (awsCredsVolume) {
      await writeAwsProfileVolume(awsCredsVolume, awsProfiles);
      dockerRunner.volumes = [
        ...(dockerRunner.volumes ?? []),
        awsCredsVolume.getVolumeConfig('/var/cartography/.aws', true),
      ];
    }

    const runnerResult = await runComponentWithRunner<Record<string, never>, unknown>(
      dockerRunner,
      async () => ({}) as unknown,
      {},
      runnerContext,
    );
    if (typeof runnerResult === 'string' && runnerResult.length > 0) {
      stdout += runnerResult;
    }

    return {
      command,
      stdout,
      stderr,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const details =
      error && typeof error === 'object' && 'details' in error
        ? ((error as any).details as { stdout?: string; stderr?: string } | undefined)
        : undefined;

    if (details?.stdout) {
      stdout += details.stdout;
    }
    if (details?.stderr) {
      stderr += details.stderr;
    }

    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      stdout,
      stderr,
      command,
      durationMs: Date.now() - startTime,
    });
  } finally {
    if (awsCredsVolume) {
      await awsCredsVolume.cleanup();
      context.logger.info('[CartographySync] Cleaned up AWS creds volume');
    }
  }
}

const definition = defineComponent({
  id: 'security.cartography.sync',
  label: 'Cartography Sync',
  category: 'security',
  retryPolicy,
  runner: {
    kind: 'docker',
    image: CARTOGRAPHY_IMAGE,
    platform: 'linux/amd64',
    command: [],
    expectOutputFile: false,
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
        neo4jDatabase: parsedParams.neo4jDatabase,
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
      '--neo4j-database',
      parsedParams.neo4jDatabase,
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
            'iam,s3,dynamodb,ec2:instance,ec2:security_group,ec2:subnet,ec2:network_acls,ec2:vpc,ec2:volumes,ec2:load_balancer,ec2:load_balancer_v2,ecr,ecs,eks,elasticache,lambda_function,kms,rds,route53,apigateway,secretsmanager,sqs,acm:certificate,cloudfront,cloudtrail,guardduty,sns',
          );
        }
      }
    }

    context.logger.info(
      `[CartographySync] Running cartography with modules: ${selectedModules.join(', ')}`,
    );
    context.emitProgress(`Syncing infrastructure graph: ${selectedModules.join(', ')} modules`);

    let stderrCombined = '';
    const githubConfigBase64 =
      parsedInputs.githubToken && parsedInputs.githubOrg
        ? Buffer.from(
            JSON.stringify({
              organization: [
                {
                  token: parsedInputs.githubToken,
                  url: 'https://api.github.com/graphql',
                  name: parsedInputs.githubOrg,
                },
              ],
            }),
          ).toString('base64')
        : undefined;

    try {
      const runnerResult = await runCartographyWithRunner(
        {
          selectedModules,
          neo4jUri: parsedParams.neo4jUri,
          neo4jDatabase: parsedParams.neo4jDatabase,
          awsProfiles: parsedInputs.credentials
            ? [
                {
                  profileName: 'default',
                  region: parsedParams.awsRegions?.split(',')[0]?.trim() || 'us-east-1',
                  accessKeyId: parsedInputs.credentials.accessKeyId,
                  secretAccessKey: parsedInputs.credentials.secretAccessKey,
                  sessionToken: parsedInputs.credentials.sessionToken,
                },
              ]
            : [],
          awsRegions: parsedParams.awsRegions
            ? parsedParams.awsRegions
                .split(',')
                .map((region) => region.trim())
                .filter((region) => region.length > 0)
            : undefined,
          awsRequestedSyncs: DEFAULT_AWS_REQUESTED_SYNCS,
          awsBestEffort: parsedParams.awsBestEffort,
          githubConfigBase64,
          image: CARTOGRAPHY_IMAGE,
        },
        context,
      );
      stderrCombined = runnerResult.stderr;

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
        neo4jDatabase: parsedParams.neo4jDatabase,
        command: runnerResult.command,
        stderr: stderrCombined,
        durationMs: runnerResult.durationMs,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorWithDetails = error as Error & {
        stderr?: string;
        command?: string[];
        durationMs?: number;
      };
      stderrCombined = errorWithDetails.stderr || errorMessage;

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
        neo4jDatabase: parsedParams.neo4jDatabase,
        command: errorWithDetails.command ?? cmd,
        stderr: stderrCombined,
        durationMs: errorWithDetails.durationMs ?? Date.now() - startTime,
      });
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

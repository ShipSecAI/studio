import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  ConfigurationError,
  runComponentWithRunner,
  ValidationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  analyticsResultSchema,
  generateFindingHash,
  type AnalyticsResult,
} from '@shipsec/component-sdk';

import type { DockerRunnerConfig } from '@shipsec/component-sdk';
import { awsCredentialSchema, gcpCredentialSchema } from '@shipsec/contracts';
import { createIsolatedVolume } from '../../utils/isolated-volume';
import { createToolOutputVolume, readToolOutputFile } from '../../utils/tool-output';
import { discoverOrgAccounts } from '../core/aws-org-discovery';
import { assumeRole } from '../core/aws-assume-role';
import {
  severityLevels,
  recommendedFlagOptions,
  defaultSelectedFlagIds,
  recommendedFlagIdSchema,
  recommendedFlagMap,
  normalisedFindingSchema,
  normaliseFindings,
  mapToAnalyticsSeverity,
  buildScanId,
  buildMemberRoleArn,
  setVolumeOwnership,
  shouldSetVolumeOwnershipForExecutionMode,
  splitArgs,
  type NormalisedSeverity,
  type NormalisedFinding,
  type RecommendedFlagId,
} from './prowler-shared';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROWLER_IMAGE = 'ghcr.io/shipsecai/prowler:latest';
const SINGLE_ACCOUNT_TIMEOUT_SECONDS = 2700; // 45 minutes — Prowler scans typically take 20-45 min
const _ORG_SCAN_TIMEOUT_SECONDS = 7200; // 2 hours — reserved for future per-org timeout budget
const FLUSH_THRESHOLD = 5000;
const PROWLER_ASFF_OUTPUT_FILE = 'shipsec.asff.json';
const GCP_IMPERSONATION_SOURCE_CREDENTIALS_ENV =
  'SHIPSEC_GCP_IMPERSONATION_SOURCE_CREDENTIALS_JSON';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const inputSchema = inputs({
  accountId: port(
    z
      .string()
      .optional()
      .describe('AWS account to tag findings with. Required when orgScan is false.'),
    {
      label: 'Account ID',
      description: 'Account identifier forwarded from the AWS Credentials component.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  credentials: port(
    awsCredentialSchema()
      .optional()
      .describe(
        'AWS credentials emitted by the AWS Account component. Required for authenticated AWS scans.',
      ),
    {
      label: 'AWS Credentials',
      description:
        'Structured credentials object (`{ accessKeyId, secretAccessKey, sessionToken? }`).',
      connectionType: { kind: 'contract', name: 'core.credential.aws', credential: true },
    },
  ),
  gcpCredential: port(
    gcpCredentialSchema()
      .optional()
      .describe(
        'GCP impersonation credential object for GCP scans (`{ targetServiceAccountEmail, defaultProjectId?, organizationId?, clientEmail? }`).',
      ),
    {
      label: 'GCP Credential',
      description: 'Structured GCP credential for `prowler gcp` scans.',
      connectionType: { kind: 'contract', name: 'core.credential.gcp', credential: true },
    },
  ),
  kubeconfig: port(
    z
      .string()
      .optional()
      .describe(
        'Raw kubeconfig YAML content used by Kubernetes scans. Required for `prowler kubernetes` unless runner supplies in-cluster auth.',
      ),
    {
      label: 'Kubeconfig',
      description: 'Kubernetes kubeconfig content mounted for `prowler kubernetes` scans.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  regions: port(
    z.string().default('us-east-1').describe('Comma separated AWS regions (AWS mode only).'),
    {
      label: 'Regions',
      description: 'Comma separated AWS regions to cover when scan mode is AWS.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  orgScan: port(
    z
      .boolean()
      .optional()
      .describe(
        'When true, discovers all org accounts and scans each one. Overrides the orgScan parameter when connected.',
      ),
    {
      label: 'Org-Wide Scan',
      description:
        'Pass true from an upstream node (e.g. integration trigger) to enable org-wide scanning. Overrides the parameter toggle when connected.',
      connectionType: { kind: 'primitive', name: 'boolean' },
    },
  ),
});

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameterSchema = parameters({
  scanMode: param(
    z
      .enum(['aws', 'cloud', 'gcp', 'kubernetes'])
      .default('aws')
      .describe('Run `prowler aws`, `prowler cloud`, `prowler gcp`, or `prowler kubernetes`.'),
    {
      label: 'Scan Target',
      editor: 'select',
      options: [
        { label: 'AWS Account (prowler aws)', value: 'aws' },
        { label: 'Cloud Overview (prowler cloud)', value: 'cloud' },
        { label: 'GCP (prowler gcp)', value: 'gcp' },
        { label: 'Kubernetes (prowler kubernetes)', value: 'kubernetes' },
      ],
      description: 'Choose provider target. Regions are used only for AWS/cloud scans.',
    },
  ),
  recommendedFlags: param(
    z
      .array(recommendedFlagIdSchema)
      .default(defaultSelectedFlagIds)
      .describe('Toggle pre-populated CLI flags to apply to the Prowler command.'),
    {
      label: 'Recommended Flags',
      editor: 'multi-select',
      options: recommendedFlagOptions.map((option) => ({
        label: option.label,
        value: option.id,
        description: option.description,
      })),
      description: 'Pre-selected CLI flags appended automatically to the Prowler command.',
    },
  ),
  customFlags: param(
    z
      .string()
      .trim()
      .max(1024, 'Custom CLI flags cannot exceed 1024 characters.')
      .optional()
      .describe('Raw CLI flags to append to the Prowler command.'),
    {
      label: 'Additional CLI Flags',
      editor: 'textarea',
      rows: 3,
      placeholder: '--exclude-checks extra73,extra74 --severity-filter medium,high,critical',
      description: 'Any extra CLI flags appended verbatim to the prowler command.',
    },
  ),
  orgScan: param(
    z
      .boolean()
      .default(false)
      .describe('When enabled, discovers all org accounts and scans each one.'),
    {
      label: 'Org-Wide Scan',
      editor: 'toggle',
      description:
        'Enable to scan all accounts in an AWS Organization. Credentials must belong to the management account.',
    },
  ),
  memberRoleName: param(
    z
      .string()
      .default('OrganizationAccountAccessRole')
      .describe('IAM role name to assume in each member account.'),
    {
      label: 'Member Role Name',
      editor: 'text',
      description:
        'Name of the IAM role to assume in each member account. Supports full ARN templates with {accountId} placeholder.',
      visibleWhen: { orgScan: true },
    },
  ),
  externalId: param(
    z.string().optional().describe('Optional external ID for cross-account role assumption.'),
    {
      label: 'External ID',
      editor: 'text',
      description: 'Optional external ID required by the trust policy of the member role.',
      visibleWhen: { orgScan: true },
    },
  ),
  continueOnError: param(
    z
      .boolean()
      .default(true)
      .describe('When true, continue scanning remaining accounts if one fails.'),
    {
      label: 'Continue on Error',
      editor: 'toggle',
      description: 'If a member account scan fails, record the error and continue to the next.',
      visibleWhen: { orgScan: true },
    },
  ),
  skipManagementAccount: param(
    z
      .boolean()
      .default(false)
      .describe('When true, skip the management account from org-wide scanning.'),
    {
      label: 'Skip Management Account',
      editor: 'toggle',
      description: 'Exclude the management account (the one providing credentials) from scanning.',
      visibleWhen: { orgScan: true },
    },
  ),
  maxConcurrency: param(
    z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(1)
      .describe('Number of accounts to scan concurrently (1-5).'),
    {
      label: 'Max Concurrency',
      editor: 'number',
      description:
        'Number of accounts to scan in parallel. Higher values scan faster but use more resources.',
      visibleWhen: { orgScan: true },
    },
  ),
});

// ---------------------------------------------------------------------------
// Account summary schema (for org mode)
// ---------------------------------------------------------------------------

const accountSummarySchema = z.object({
  accountId: z.string(),
  accountName: z.string(),
  findingCount: z.number(),
  status: z.enum(['scanned', 'failed', 'skipped']),
  error: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

const outputSchema = outputs({
  scanId: port(z.string(), {
    label: 'Scan ID',
    description: 'Deterministic identifier for the scan run.',
  }),
  findings: port(z.array(normalisedFindingSchema), {
    label: 'Findings',
    description:
      'Array of normalized findings derived from Prowler ASFF output (includes severity, resource id, remediation).',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw Prowler output for debugging.',
  }),
  summary: port(
    z.object({
      totalFindings: z.number(),
      failed: z.number(),
      passed: z.number(),
      unknown: z.number(),
      severityCounts: z.record(z.enum(severityLevels), z.number()),
      generatedAt: z.string(),
      regions: z.array(z.string()),
      scanMode: z.enum(['aws', 'cloud', 'gcp', 'kubernetes']),
      selectedFlagIds: z.array(recommendedFlagIdSchema),
      customFlags: z.string().nullable(),
      accountSummaries: z.array(accountSummarySchema).optional(),
    }),
    {
      label: 'Summary',
      description: 'Aggregate counts, regions, selected flag metadata, and other run statistics.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
  command: port(z.array(z.string()), {
    label: 'Command',
    description: 'Prowler command-line arguments used during the run.',
  }),
  stderr: port(z.string(), {
    label: 'Stderr',
    description: 'Standard error output emitted by Prowler.',
  }),
  errors: port(z.array(z.string()).optional(), {
    label: 'Errors',
    description: 'Errors encountered during the scan.',
  }),
});

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

const prowlerRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 10,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 1.5,
  nonRetryableErrorTypes: ['ConfigurationError', 'ValidationError'],
};

// ---------------------------------------------------------------------------
// Shared helpers (internal to this file)
// ---------------------------------------------------------------------------

type ParsedInputs = ReturnType<typeof inputSchema.parse>;
type ParsedParams = ReturnType<typeof parameterSchema.parse>;

interface PreparedScan {
  regions: string[];
  selectedFlags: Set<RecommendedFlagId>;
  resolvedFlagArgs: string[];
}

function prepareScan(parsedInputs: ParsedInputs, parsedParams: ParsedParams): PreparedScan {
  const usesAwsRegions = parsedParams.scanMode === 'aws' || parsedParams.scanMode === 'cloud';
  const parsedRegions = usesAwsRegions
    ? parsedInputs.regions
        .split(',')
        .map((region: string) => region.trim())
        .filter((region: string) => region.length > 0)
    : [];
  const regions = usesAwsRegions ? (parsedRegions.length > 0 ? parsedRegions : ['us-east-1']) : [];

  const selectedFlags = new Set<RecommendedFlagId>(
    parsedParams.recommendedFlags ?? defaultSelectedFlagIds,
  );
  const resolvedFlagArgs = Array.from(selectedFlags).flatMap(
    (flagId) => recommendedFlagMap.get(flagId) ?? [],
  );

  return { regions, selectedFlags, resolvedFlagArgs };
}

function buildCommand(
  scanMode: 'aws' | 'cloud' | 'gcp' | 'kubernetes',
  regions: string[],
  resolvedFlagArgs: string[],
  customFlags?: string,
): string[] {
  const cmd: string[] = [scanMode];
  if (scanMode === 'aws') {
    for (const region of regions) {
      cmd.push('--region', region);
    }
  }
  if (!resolvedFlagArgs.includes('--ignore-exit-code-3')) {
    resolvedFlagArgs.push('--ignore-exit-code-3');
  }
  cmd.push(...resolvedFlagArgs);
  if (customFlags && customFlags.trim().length > 0) {
    try {
      cmd.push(...splitArgs(customFlags));
    } catch (err) {
      throw new ValidationError(`Failed to parse custom CLI flags: ${(err as Error).message}`, {
        cause: err as Error,
        fieldErrors: { customFlags: ['Invalid CLI flag syntax'] },
      });
    }
  }
  cmd.push(
    '--output-formats',
    'json-asff',
    '--output-directory',
    '/output',
    '--output-filename',
    'shipsec',
  );
  return cmd;
}

function buildAwsEnv(
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
  regions: string[],
  scanMode: 'aws' | 'cloud' | 'gcp' | 'kubernetes',
): Record<string, string> {
  const awsEnv: Record<string, string> = {};
  awsEnv.AWS_ACCESS_KEY_ID = credentials.accessKeyId;
  awsEnv.AWS_SECRET_ACCESS_KEY = credentials.secretAccessKey;
  if (credentials.sessionToken) {
    awsEnv.AWS_SESSION_TOKEN = credentials.sessionToken;
  }
  awsEnv.AWS_SHARED_CREDENTIALS_FILE = '/home/prowler/.aws/credentials';
  awsEnv.AWS_CONFIG_FILE = '/home/prowler/.aws/config';
  awsEnv.AWS_PROFILE = 'default';
  if (scanMode === 'aws' && regions.length > 0) {
    awsEnv.AWS_REGION = regions[0];
    awsEnv.AWS_DEFAULT_REGION = regions[0];
  }
  return awsEnv;
}

function buildGcpEnv(gcpCredential: NonNullable<ParsedInputs['gcpCredential']>): {
  env: Record<string, string>;
  files: Record<string, string>;
} {
  const keyPath = '/home/prowler/.gcp/application_default_credentials.json';
  let sourceCredentialJson = process.env[GCP_IMPERSONATION_SOURCE_CREDENTIALS_ENV]?.trim();
  if (!sourceCredentialJson && process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) {
    sourceCredentialJson = readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS.trim(), 'utf8');
  }
  if (!sourceCredentialJson) {
    throw new ConfigurationError(
      `Missing ${GCP_IMPERSONATION_SOURCE_CREDENTIALS_ENV} (or GOOGLE_APPLICATION_CREDENTIALS). Prowler GCP scans require ShipSec source credentials for impersonation.`,
      { configKey: GCP_IMPERSONATION_SOURCE_CREDENTIALS_ENV },
    );
  }

  let sourceCredentials: unknown;
  try {
    sourceCredentials = JSON.parse(sourceCredentialJson);
  } catch {
    throw new ConfigurationError(`${GCP_IMPERSONATION_SOURCE_CREDENTIALS_ENV} is not valid JSON.`, {
      configKey: GCP_IMPERSONATION_SOURCE_CREDENTIALS_ENV,
    });
  }

  const impersonationCredentials = {
    type: 'impersonated_service_account',
    source_credentials: sourceCredentials,
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/` +
      `${encodeURIComponent(gcpCredential.targetServiceAccountEmail)}:generateAccessToken`,
    delegates: [],
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  };

  const env: Record<string, string> = {
    GOOGLE_APPLICATION_CREDENTIALS: keyPath,
  };

  if (gcpCredential.defaultProjectId) {
    env.GOOGLE_CLOUD_PROJECT = gcpCredential.defaultProjectId;
    env.CLOUDSDK_CORE_PROJECT = gcpCredential.defaultProjectId;
  }

  return {
    env,
    files: {
      'application_default_credentials.json': JSON.stringify(impersonationCredentials),
    },
  };
}

function deriveScanTargetId(parsedInputs: ParsedInputs, parsedParams: ParsedParams): string {
  if (parsedInputs.accountId) {
    return parsedInputs.accountId;
  }
  if (parsedParams.scanMode === 'gcp') {
    return parsedInputs.gcpCredential?.defaultProjectId ?? 'gcp';
  }
  if (parsedParams.scanMode === 'kubernetes') {
    return 'kubernetes';
  }
  return 'cloud';
}

function buildAnalyticsResults(findings: NormalisedFinding[]): AnalyticsResult[] {
  return findings.map((finding) => ({
    scanner: 'prowler',
    finding_hash: generateFindingHash(
      finding.id,
      finding.resourceId ?? finding.accountId ?? '',
      finding.title ?? '',
    ),
    severity: mapToAnalyticsSeverity(finding.severity),
    asset_key: finding.resourceId ?? finding.accountId ?? undefined,
    title: finding.title,
    description: finding.description,
    region: finding.region,
    account_id: finding.accountId,
    service_name: finding.serviceName,
    status: finding.status,
    remediationText: finding.remediationText,
    recommendationUrl: finding.recommendationUrl,
  }));
}

function computeSeverityCounts(findings: NormalisedFinding[]) {
  const severityCounts: Record<NormalisedSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    informational: 0,
    unknown: 0,
  };
  let failed = 0;
  let passed = 0;
  let unknown = 0;

  findings.forEach((finding) => {
    severityCounts[finding.severity] = (severityCounts[finding.severity] ?? 0) + 1;
    switch (finding.status) {
      case 'FAILED':
        failed += 1;
        break;
      case 'PASSED':
        passed += 1;
        break;
      default:
        unknown += 1;
    }
  });

  return { severityCounts, failed, passed, unknown };
}

async function readProwlerAsffOutput(
  volume: Awaited<ReturnType<typeof createToolOutputVolume>>,
): Promise<string[]> {
  const asffOutput = await readToolOutputFile(volume, PROWLER_ASFF_OUTPUT_FILE, 'Prowler');
  return asffOutput.trim().length > 0 ? [asffOutput] : [];
}

// ---------------------------------------------------------------------------
// Single-account scan (existing behavior)
// ---------------------------------------------------------------------------

async function executeSingleAccountScan(
  { inputs, params }: { inputs: unknown; params: unknown },
  context: any,
): Promise<Output> {
  const parsedInputs = inputSchema.parse(inputs);
  const parsedParams = parameterSchema.parse(params);

  if (parsedParams.scanMode === 'aws' && !parsedInputs.accountId) {
    throw new ConfigurationError(
      'Account ID is required for single-account scans. Provide it via the accountId input port.',
      { configKey: 'accountId' },
    );
  }

  const { regions, selectedFlags, resolvedFlagArgs } = prepareScan(parsedInputs, parsedParams);

  if (
    (parsedParams.scanMode === 'aws' || parsedParams.scanMode === 'cloud') &&
    !parsedInputs.credentials
  ) {
    throw new ConfigurationError(
      `${parsedParams.scanMode} scan requires AWS credentials input. Ensure the previous step outputs { accessKeyId, secretAccessKey, sessionToken? } into the "credentials" input.`,
      { configKey: 'credentials' },
    );
  }
  if (parsedParams.scanMode === 'gcp' && !parsedInputs.gcpCredential) {
    throw new ConfigurationError(
      'GCP scan requires gcpCredential input. Provide target service-account impersonation credentials from a GCP credential source.',
      { configKey: 'gcpCredential' },
    );
  }
  if (parsedParams.scanMode === 'kubernetes' && !parsedInputs.kubeconfig) {
    throw new ConfigurationError(
      'Kubernetes scan requires kubeconfig input. Provide kubeconfig YAML content via the kubeconfig port.',
      { configKey: 'kubeconfig' },
    );
  }

  const tenantId = (context as any).tenantId ?? 'default-tenant';
  const awsCredsVolume =
    parsedInputs.credentials &&
    (parsedParams.scanMode === 'aws' || parsedParams.scanMode === 'cloud')
      ? createIsolatedVolume(tenantId, `${context.runId}-prowler-aws`)
      : null;
  const gcpCredsVolume =
    parsedParams.scanMode === 'gcp' && parsedInputs.gcpCredential
      ? createIsolatedVolume(tenantId, `${context.runId}-prowler-gcp`)
      : null;
  const kubeconfigVolume =
    parsedParams.scanMode === 'kubernetes' && parsedInputs.kubeconfig
      ? createIsolatedVolume(tenantId, `${context.runId}-prowler-kubeconfig`)
      : null;

  const awsEnv = parsedInputs.credentials
    ? buildAwsEnv(parsedInputs.credentials, regions, parsedParams.scanMode)
    : {};
  const gcpConfig = parsedInputs.gcpCredential ? buildGcpEnv(parsedInputs.gcpCredential) : null;
  const kubernetesEnv = parsedInputs.kubeconfig ? { KUBECONFIG: '/home/prowler/.kube/config' } : {};

  context.logger.info(
    `[ProwlerScan] Running prowler ${parsedParams.scanMode} for ${deriveScanTargetId(parsedInputs, parsedParams)}${regions.length > 0 ? ` with regions: ${regions.join(', ')}` : ''}`,
  );
  context.emitProgress(`Executing prowler ${parsedParams.scanMode} scan`);

  const cmd = buildCommand(
    parsedParams.scanMode,
    regions,
    resolvedFlagArgs,
    parsedParams.customFlags,
  );
  context.logger.info(`[ProwlerScan] Command: ${cmd.join(' ')}`);

  const dockerRunner = {
    kind: 'docker',
    image: PROWLER_IMAGE,
    platform: 'linux/amd64',
    network: 'bridge',
    timeoutSeconds: SINGLE_ACCOUNT_TIMEOUT_SECONDS,
    env: {
      HOME: '/home/prowler',
      ...awsEnv,
      ...(gcpConfig?.env ?? {}),
      ...kubernetesEnv,
    },
    entrypoint: 'poetry',
    command: ['run', 'prowler', ...cmd],
    stdinJson: false,
    expectOutputFile: false,
    volumes: [],
  } as DockerRunnerConfig;

  let rawSegments: string[] = [];
  const commandForOutput: string[] = cmd;
  const stderrCombined = '';
  let outputVolume: Awaited<ReturnType<typeof createToolOutputVolume>> | null = null;
  let outputVolumeInitialized = false;
  let awsVolumeInitialized = false;
  let gcpVolumeInitialized = false;
  let kubeconfigVolumeInitialized = false;

  try {
    if (awsCredsVolume && parsedInputs.credentials) {
      const credsLines = [
        '[default]',
        `aws_access_key_id = ${parsedInputs.credentials.accessKeyId ?? ''}`,
        `aws_secret_access_key = ${parsedInputs.credentials.secretAccessKey ?? ''}`,
      ];
      if (parsedInputs.credentials.sessionToken) {
        credsLines.push(`aws_session_token = ${parsedInputs.credentials.sessionToken}`);
      }

      const cfgRegion = regions[0] ?? 'us-east-1';
      const cfgLines = ['[default]', `region = ${cfgRegion}`, 'output = json'];

      await awsCredsVolume.initialize({
        credentials: credsLines.join('\n'),
        config: cfgLines.join('\n'),
      });
      awsVolumeInitialized = true;
      context.logger.info(
        `[ProwlerScan] Created isolated AWS creds volume: ${awsCredsVolume.getVolumeName()}`,
      );

      dockerRunner.volumes = [
        ...(dockerRunner.volumes ?? []),
        awsCredsVolume.getVolumeConfig('/home/prowler/.aws', true),
      ];
    }
    if (gcpCredsVolume && gcpConfig) {
      await gcpCredsVolume.initialize(gcpConfig.files);
      gcpVolumeInitialized = true;
      context.logger.info(
        `[ProwlerScan] Created isolated GCP creds volume: ${gcpCredsVolume.getVolumeName()}`,
      );
      dockerRunner.volumes = [
        ...(dockerRunner.volumes ?? []),
        gcpCredsVolume.getVolumeConfig('/home/prowler/.gcp', true),
      ];
    }
    if (kubeconfigVolume && parsedInputs.kubeconfig) {
      await kubeconfigVolume.initialize({ config: parsedInputs.kubeconfig });
      kubeconfigVolumeInitialized = true;
      context.logger.info(
        `[ProwlerScan] Created isolated kubeconfig volume: ${kubeconfigVolume.getVolumeName()}`,
      );
      dockerRunner.volumes = [
        ...(dockerRunner.volumes ?? []),
        kubeconfigVolume.getVolumeConfig('/home/prowler/.kube', true),
      ];
    }

    outputVolume = await createToolOutputVolume(tenantId, context.runId, 'prowler-out');
    outputVolumeInitialized = true;
    if (shouldSetVolumeOwnershipForExecutionMode()) {
      await setVolumeOwnership(outputVolume, 1000, 1000);
    } else {
      context.logger.info(
        '[ProwlerScan] Skipping Docker-only output volume ownership preparation in k8s mode.',
      );
    }
    context.logger.info(
      `[ProwlerScan] Created isolated output volume: ${outputVolume.getVolumeName()}`,
    );
    dockerRunner.volumes = [
      ...(dockerRunner.volumes ?? []),
      outputVolume.getVolumeConfig('/output', false),
    ];

    await runComponentWithRunner<Record<string, unknown>, undefined>(
      dockerRunner,
      async () => undefined,
      {},
      context,
    );

    rawSegments = await readProwlerAsffOutput(outputVolume);

    const { findings, errors } =
      rawSegments.length > 0
        ? normaliseFindings(rawSegments, context.runId)
        : { findings: [] as NormalisedFinding[], errors: [] as string[] };

    if (rawSegments.length === 0) {
      context.logger.warn('[ProwlerScan] Prowler completed without producing shipsec.asff.json');
    }

    const { severityCounts, failed, passed, unknown } = computeSeverityCounts(findings);
    const scanId = buildScanId(
      deriveScanTargetId(parsedInputs, parsedParams),
      parsedParams.scanMode,
    );
    const results = buildAnalyticsResults(findings);

    const output: Output = {
      scanId,
      findings,
      results,
      rawOutput: rawSegments.join('\n'),
      summary: {
        totalFindings: findings.length,
        failed,
        passed,
        unknown,
        severityCounts,
        generatedAt: new Date().toISOString(),
        regions,
        scanMode: parsedParams.scanMode,
        selectedFlagIds: Array.from(selectedFlags),
        customFlags: parsedParams.customFlags?.trim() || null,
      },
      command: commandForOutput,
      stderr: stderrCombined,
      errors: errors.length > 0 ? errors : undefined,
    };

    return outputSchema.parse(output);
  } finally {
    if (outputVolumeInitialized) {
      await outputVolume?.cleanup();
      context.logger.info('[ProwlerScan] Cleaned up output volume');
    }
    if (awsVolumeInitialized && awsCredsVolume) {
      await awsCredsVolume.cleanup();
      context.logger.info('[ProwlerScan] Cleaned up AWS creds volume');
    }
    if (gcpVolumeInitialized && gcpCredsVolume) {
      await gcpCredsVolume.cleanup();
      context.logger.info('[ProwlerScan] Cleaned up GCP creds volume');
    }
    if (kubeconfigVolumeInitialized && kubeconfigVolume) {
      await kubeconfigVolume.cleanup();
      context.logger.info('[ProwlerScan] Cleaned up kubeconfig volume');
    }
  }
}

// ---------------------------------------------------------------------------
// Org-wide scan (new)
// ---------------------------------------------------------------------------

interface AccountScanResult {
  accountId: string;
  accountName: string;
  status: 'scanned' | 'failed' | 'skipped';
  findingCount: number;
  error?: string;
  findings?: NormalisedFinding[];
  results?: AnalyticsResult[];
  rawSegments?: string[];
  flushedToStorage?: boolean;
}

async function scanSingleOrgAccount(
  account: { id: string; name: string },
  managementCredentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region?: string;
  },
  parsedParams: ParsedParams,
  regions: string[],
  resolvedFlagArgs: string[],
  context: any,
): Promise<AccountScanResult> {
  let awsVolume: ReturnType<typeof createIsolatedVolume> | undefined;
  let outVolume: Awaited<ReturnType<typeof createToolOutputVolume>> | undefined;
  const tenantId = (context as any).tenantId ?? 'default-tenant';

  try {
    const roleArn = buildMemberRoleArn(parsedParams.memberRoleName, account.id);
    context.logger.info(
      `[ProwlerScan:Org] Assuming role ${roleArn} for account ${account.id} (${account.name})`,
    );

    const memberCreds = await assumeRole(managementCredentials, roleArn, {
      externalId: parsedParams.externalId,
      sessionName: `shipsec-org-prowler-${account.id}`,
    });

    const awsEnv = buildAwsEnv(memberCreds, regions, parsedParams.scanMode);
    const cmd = buildCommand(
      parsedParams.scanMode,
      regions,
      [...resolvedFlagArgs],
      parsedParams.customFlags,
    );

    awsVolume = createIsolatedVolume(tenantId, `${context.runId}-prowler-aws-${account.id}`);
    outVolume = await createToolOutputVolume(tenantId, context.runId, `prowler-out-${account.id}`);

    // Initialize AWS creds volume
    const credsLines = [
      '[default]',
      `aws_access_key_id = ${memberCreds.accessKeyId}`,
      `aws_secret_access_key = ${memberCreds.secretAccessKey}`,
    ];
    if (memberCreds.sessionToken) {
      credsLines.push(`aws_session_token = ${memberCreds.sessionToken}`);
    }
    const cfgRegion = regions[0] ?? 'us-east-1';
    const cfgLines = ['[default]', `region = ${cfgRegion}`, 'output = json'];

    await awsVolume.initialize({
      credentials: credsLines.join('\n'),
      config: cfgLines.join('\n'),
    });

    if (shouldSetVolumeOwnershipForExecutionMode()) {
      await setVolumeOwnership(outVolume, 1000, 1000);
    } else {
      context.logger.info(
        `[ProwlerScan:Org] Skipping Docker-only output volume ownership preparation for account ${account.id} in k8s mode.`,
      );
    }

    const dockerRunner = {
      kind: 'docker',
      image: PROWLER_IMAGE,
      platform: 'linux/amd64',
      network: 'bridge',
      timeoutSeconds: SINGLE_ACCOUNT_TIMEOUT_SECONDS,
      env: {
        HOME: '/home/prowler',
        ...awsEnv,
      },
      entrypoint: 'poetry',
      command: ['run', 'prowler', ...cmd],
      stdinJson: false,
      expectOutputFile: false,
      volumes: [
        awsVolume.getVolumeConfig('/home/prowler/.aws', true),
        outVolume.getVolumeConfig('/output', false),
      ],
    } as DockerRunnerConfig;

    let rawSegments: string[] = [];

    await runComponentWithRunner<Record<string, unknown>, undefined>(
      dockerRunner,
      async () => undefined,
      {},
      context,
    );

    rawSegments = await readProwlerAsffOutput(outVolume);

    const { findings, errors: parseErrors } =
      rawSegments.length > 0
        ? normaliseFindings(rawSegments, context.runId)
        : { findings: [] as NormalisedFinding[], errors: [] as string[] };

    if (parseErrors.length > 0) {
      context.logger.warn(
        `[ProwlerScan:Org] Parse errors for account ${account.id}: ${parseErrors.join('; ')}`,
      );
    }

    const analyticsResults = buildAnalyticsResults(findings);

    return {
      accountId: account.id,
      accountName: account.name,
      status: 'scanned',
      findingCount: findings.length,
      findings,
      results: analyticsResults,
      rawSegments,
    };
  } finally {
    await awsVolume?.cleanup();
    await outVolume?.cleanup();
  }
}

async function executeOrgScan(
  { inputs, params }: { inputs: unknown; params: unknown },
  context: any,
): Promise<Output> {
  const parsedInputs = inputSchema.parse(inputs);
  const parsedParams = parameterSchema.parse(params);
  if (parsedParams.scanMode !== 'aws') {
    throw new ConfigurationError('Org-wide scan currently supports scanMode=aws only.', {
      configKey: 'scanMode',
    });
  }

  if (!parsedInputs.credentials) {
    throw new ConfigurationError(
      'Org-wide scan requires AWS credentials for the management account.',
      { configKey: 'credentials' },
    );
  }

  const credentials = parsedInputs.credentials;
  const { regions, selectedFlags, resolvedFlagArgs } = prepareScan(parsedInputs, parsedParams);

  context.emitProgress('Discovering AWS Organization accounts...');
  const allAccounts = await discoverOrgAccounts(credentials, regions[0]);

  // Filter: active accounts only
  let accounts = allAccounts.filter((a) => a.status === 'ACTIVE');

  // Optionally skip management account (the one that owns the credentials)
  // The management account's ID is in the credential's accountId input, if provided
  if (parsedParams.skipManagementAccount && parsedInputs.accountId) {
    accounts = accounts.filter((a) => a.id !== parsedInputs.accountId);
  }

  context.logger.info(
    `[ProwlerScan:Org] Found ${allAccounts.length} total accounts, ${accounts.length} to scan.`,
  );
  context.emitProgress(`Found ${accounts.length} accounts to scan`);

  if (accounts.length === 0) {
    const scanId = buildScanId(parsedInputs.accountId ?? 'org', parsedParams.scanMode);
    return outputSchema.parse({
      scanId,
      findings: [],
      results: [],
      rawOutput: '',
      summary: {
        totalFindings: 0,
        failed: 0,
        passed: 0,
        unknown: 0,
        severityCounts: { critical: 0, high: 0, medium: 0, low: 0, informational: 0, unknown: 0 },
        generatedAt: new Date().toISOString(),
        regions,
        scanMode: parsedParams.scanMode,
        selectedFlagIds: Array.from(selectedFlags),
        customFlags: parsedParams.customFlags?.trim() || null,
        accountSummaries: [],
      },
      command: [],
      stderr: '',
      errors: undefined,
    });
  }

  const accountResults: AccountScanResult[] = [];
  const allErrors: string[] = [];

  // Scan accounts (sequential for maxConcurrency=1, batched otherwise)
  const concurrency = parsedParams.maxConcurrency ?? 1;

  for (let i = 0; i < accounts.length; i += concurrency) {
    const batch = accounts.slice(i, i + concurrency);
    const batchPromises = batch.map(async (account, batchIdx) => {
      const globalIdx = i + batchIdx;
      context.emitProgress(
        `Scanning ${globalIdx + 1}/${accounts.length}: ${account.name} (${account.id})`,
      );

      try {
        const result = await scanSingleOrgAccount(
          account,
          credentials,
          parsedParams,
          regions,
          [...resolvedFlagArgs],
          context,
        );

        // Flush per-account results to storage if they exceed threshold
        if (context.storage && result.findings && result.findings.length > FLUSH_THRESHOLD) {
          try {
            await context.storage.uploadFile(
              `${context.runId}/org-scan/${account.id}.json`,
              'findings.json',
              Buffer.from(JSON.stringify(result.findings)),
              'application/json',
            );
            context.logger.info(
              `[ProwlerScan:Org] Flushed ${result.findings.length} findings for account ${account.id} to storage`,
            );
            return {
              ...result,
              findings: undefined,
              results: undefined,
              rawSegments: undefined,
              flushedToStorage: true,
            } satisfies AccountScanResult;
          } catch (flushErr) {
            context.logger.warn(
              `[ProwlerScan:Org] Failed to flush findings for ${account.id}: ${(flushErr as Error).message}`,
            );
            // Keep in memory if flush fails
          }
        }

        return result;
      } catch (err) {
        const errorMsg = (err as Error).message ?? String(err);
        if (parsedParams.continueOnError) {
          context.logger.warn(
            `[ProwlerScan:Org] Account ${account.id} (${account.name}) failed: ${errorMsg}`,
          );
          allErrors.push(`Account ${account.id} (${account.name}): ${errorMsg}`);
          return {
            accountId: account.id,
            accountName: account.name,
            status: 'failed' as const,
            findingCount: 0,
            error: errorMsg,
          };
        } else {
          throw err;
        }
      }
    });

    const batchResults = await Promise.all(batchPromises);
    accountResults.push(...batchResults);
  }

  // Aggregate results
  const allFindings: NormalisedFinding[] = [];
  const allAnalyticsResults: AnalyticsResult[] = [];
  const allRawSegments: string[] = [];

  for (const result of accountResults) {
    if (result.flushedToStorage) {
      // Read back flushed results
      try {
        if (context.storage) {
          const content = await context.storage.downloadFile(
            `${context.runId}/org-scan/${result.accountId}.json`,
          );
          const flushedFindings: NormalisedFinding[] = JSON.parse(
            typeof content === 'string' ? content : content.toString(),
          );
          allFindings.push(...flushedFindings);
          allAnalyticsResults.push(...buildAnalyticsResults(flushedFindings));
        }
      } catch (readErr) {
        context.logger.warn(
          `[ProwlerScan:Org] Failed to read flushed findings for ${result.accountId}: ${(readErr as Error).message}`,
        );
      }
    } else {
      if (result.findings) allFindings.push(...result.findings);
      if (result.results) allAnalyticsResults.push(...result.results);
      if (result.rawSegments) allRawSegments.push(...result.rawSegments);
    }
  }

  const { severityCounts, failed, passed, unknown } = computeSeverityCounts(allFindings);
  const scanId = buildScanId(parsedInputs.accountId ?? 'org', parsedParams.scanMode);

  const accountSummaries = accountResults.map((r) => ({
    accountId: r.accountId,
    accountName: r.accountName,
    findingCount: r.findingCount,
    status: r.status,
    error: r.error,
  }));

  const output: Output = {
    scanId,
    findings: allFindings,
    results: allAnalyticsResults,
    rawOutput: allRawSegments.join('\n'),
    summary: {
      totalFindings: allFindings.length,
      failed,
      passed,
      unknown,
      severityCounts,
      generatedAt: new Date().toISOString(),
      regions,
      scanMode: parsedParams.scanMode,
      selectedFlagIds: Array.from(selectedFlags),
      customFlags: parsedParams.customFlags?.trim() || null,
      accountSummaries,
    },
    command: [],
    stderr: '',
    errors: allErrors.length > 0 ? allErrors : undefined,
  };

  return outputSchema.parse(output);
}

// ---------------------------------------------------------------------------
// Component definition
// ---------------------------------------------------------------------------

const definition = defineComponent({
  id: 'security.prowler.scan',
  label: 'Prowler Scan',
  category: 'security',
  retryPolicy: prowlerRetryPolicy,
  runner: {
    kind: 'docker',
    image: PROWLER_IMAGE,
    platform: 'linux/amd64',
    command: [], // Placeholder - actual command built dynamically in execute()
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Execute Prowler inside Docker using `ghcr.io/shipsecai/prowler` (amd64 enforced on ARM hosts). Supports `prowler aws`, `prowler cloud`, `prowler gcp`, and `prowler kubernetes` modes. Org-wide mode currently applies to AWS.',
  toolProvider: {
    kind: 'component',
    name: 'prowler_scan',
    description: 'AWS and multi-cloud security assessment tool (Prowler).',
  },
  ui: {
    slug: 'prowler-scan',
    version: '3.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Run Toniblyx Prowler to assess AWS accounts or multi-cloud posture. Supports single-account and org-wide scanning modes. Streams raw logs while returning structured findings in ASFF-derived JSON.',
    documentation: 'https://github.com/prowler-cloud/prowler',
    icon: 'ShieldCheck',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    examples: [
      'Run nightly `prowler aws --quick --severity-filter high,critical` scans on production accounts and forward findings into ELK.',
      'Use `prowler cloud` with custom flags to generate a multi-cloud compliance snapshot.',
      'Run `prowler gcp` with a connected GCP credential to assess Google Cloud resources.',
      'Run `prowler kubernetes` with a kubeconfig input to assess cluster posture.',
      'Enable org-wide scan to discover all member accounts and run Prowler across the entire organization.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);

    // Input-level orgScan (from upstream node) takes precedence over the parameter toggle
    const isOrgScan = inputs.orgScan ?? parsedParams.orgScan;

    if (isOrgScan) {
      return executeOrgScan({ inputs, params }, context);
    }
    return executeSingleAccountScan({ inputs, params }, context);
  },
});

componentRegistry.register(definition);

export const __testables = {
  buildCommand,
  prepareScan,
  deriveScanTargetId,
};

// Create local type aliases for backward compatibility
type Input = (typeof inputSchema)['__inferred'];
type Output = (typeof outputSchema)['__inferred'];

export type { Input as ProwlerScanInput, Output as ProwlerScanOutput };

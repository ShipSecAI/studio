import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  ConfigurationError,
  runComponentWithRunner,
  ServiceError,
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
import { awsCredentialSchema } from '@shipsec/contracts';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
import { discoverOrgAccounts } from '../core/aws-org-discovery';
import { assumeRole } from '../core/aws-assume-role';
import {
  severityLevels,
  recommendedFlagOptions,
  defaultSelectedFlagIds,
  recommendedFlagIdSchema,
  recommendedFlagMap,
  runnerPayloadSchema,
  normalisedFindingSchema,
  normaliseFindings,
  mapToAnalyticsSeverity,
  buildScanId,
  buildMemberRoleArn,
  listVolumeFiles,
  setVolumeOwnership,
  splitArgs,
  type NormalisedSeverity,
  type NormalisedFinding,
  type RecommendedFlagId,
} from './prowler-shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROWLER_IMAGE = 'ghcr.io/shipsecai/prowler:latest';
const SINGLE_ACCOUNT_TIMEOUT_SECONDS = 900;
const _ORG_SCAN_TIMEOUT_SECONDS = 7200;
const FLUSH_THRESHOLD = 5000;

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
  regions: port(
    z.string().default('us-east-1').describe('Comma separated AWS regions (AWS mode only).'),
    {
      label: 'Regions',
      description: 'Comma separated AWS regions to cover when scan mode is AWS.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
});

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

const parameterSchema = parameters({
  scanMode: param(
    z
      .enum(['aws', 'cloud'])
      .default('aws')
      .describe(
        'Run `prowler aws` for a specific account or `prowler cloud` for the multi-cloud overview.',
      ),
    {
      label: 'Scan Target',
      editor: 'select',
      options: [
        { label: 'AWS Account (prowler aws)', value: 'aws' },
        { label: 'Cloud Overview (prowler cloud)', value: 'cloud' },
      ],
      description:
        'Choose between a targeted AWS account scan or the multi-cloud overview. AWS mode honors regions.',
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
      scanMode: z.enum(['aws', 'cloud']),
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
  const parsedRegions = parsedInputs.regions
    .split(',')
    .map((region: string) => region.trim())
    .filter((region: string) => region.length > 0);
  const regions = parsedRegions.length > 0 ? parsedRegions : ['us-east-1'];

  const selectedFlags = new Set<RecommendedFlagId>(
    parsedParams.recommendedFlags ?? defaultSelectedFlagIds,
  );
  const resolvedFlagArgs = Array.from(selectedFlags).flatMap(
    (flagId) => recommendedFlagMap.get(flagId) ?? [],
  );

  return { regions, selectedFlags, resolvedFlagArgs };
}

function buildCommand(
  scanMode: 'aws' | 'cloud',
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
  scanMode: 'aws' | 'cloud',
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

// ---------------------------------------------------------------------------
// Single-account scan (existing behavior)
// ---------------------------------------------------------------------------

async function executeSingleAccountScan(
  { inputs, params }: { inputs: unknown; params: unknown },
  context: any,
): Promise<Output> {
  const parsedInputs = inputSchema.parse(inputs);
  const parsedParams = parameterSchema.parse(params);

  if (!parsedInputs.accountId) {
    throw new ConfigurationError(
      'Account ID is required for single-account scans. Provide it via the accountId input port.',
      { configKey: 'accountId' },
    );
  }

  const { regions, selectedFlags, resolvedFlagArgs } = prepareScan(parsedInputs, parsedParams);

  if (parsedParams.scanMode === 'aws' && !parsedInputs.credentials) {
    throw new ConfigurationError(
      'AWS scan requires credentials input. Ensure the previous step outputs { accessKeyId, secretAccessKey, sessionToken? } into the "credentials" input.',
      { configKey: 'credentials' },
    );
  }

  const tenantId = (context as any).tenantId ?? 'default-tenant';
  const awsCredsVolume = parsedInputs.credentials
    ? new IsolatedContainerVolume(tenantId, `${context.runId}-prowler-aws`)
    : null;

  const awsEnv = parsedInputs.credentials
    ? buildAwsEnv(parsedInputs.credentials, regions, parsedParams.scanMode)
    : {};

  context.logger.info(
    `[ProwlerScan] Running prowler ${parsedParams.scanMode} for ${parsedInputs.accountId} with regions: ${regions.join(', ')}`,
  );
  context.emitProgress(
    `Executing prowler ${parsedParams.scanMode} scan across ${regions.length} region${regions.length === 1 ? '' : 's'}`,
  );

  const cmd = buildCommand(
    parsedParams.scanMode,
    regions,
    resolvedFlagArgs,
    parsedParams.customFlags,
  );
  context.logger.info(`[ProwlerScan] Command: ${cmd.join(' ')}`);

  const dockerRunner: DockerRunnerConfig = {
    kind: 'docker',
    image: PROWLER_IMAGE,
    platform: 'linux/amd64',
    network: 'bridge',
    timeoutSeconds: SINGLE_ACCOUNT_TIMEOUT_SECONDS,
    env: {
      HOME: '/home/prowler',
      ...awsEnv,
    },
    command: cmd,
    volumes: [],
  };

  let rawSegments: string[] = [];
  let commandForOutput: string[] = cmd;
  let stderrCombined = '';
  const outputVolume = new IsolatedContainerVolume(tenantId, `${context.runId}-prowler-out`);
  let outputVolumeInitialized = false;
  let awsVolumeInitialized = false;

  try {
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

      await outputVolume.initialize({});
      outputVolumeInitialized = true;
      await setVolumeOwnership(outputVolume, 1000, 1000);
      context.logger.info(
        `[ProwlerScan] Created isolated output volume: ${outputVolume.getVolumeName()}`,
      );
      dockerRunner.volumes = [
        ...(dockerRunner.volumes ?? []),
        outputVolume.getVolumeConfig('/output', false),
      ];

      const raw = await runComponentWithRunner<Record<string, unknown>, unknown>(
        dockerRunner,
        async () => ({}) as unknown,
        {},
        context,
      );

      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const parsed = runnerPayloadSchema.safeParse(raw);
        if (parsed.success) {
          const result = parsed.data;
          if (result.parse_error) {
            throw new ValidationError(`Failed to parse custom CLI flags: ${result.parse_error}`, {
              fieldErrors: { customFlags: ['Invalid CLI flag syntax'] },
            });
          }
          if (result.returncode !== 0) {
            const msg = result.stderr.trim();
            throw new ServiceError(
              msg.length > 0 ? msg : `prowler exited with status ${result.returncode}`,
              {
                details: { returncode: result.returncode },
              },
            );
          }
          rawSegments = result.artifacts.length > 0 ? result.artifacts : [result.stdout];
          commandForOutput = result.command;
          stderrCombined = result.stderr;
        }
      }
    } catch (err) {
      const msg = (err as Error)?.message ?? '';
      const isFindingsExit = /exit code\s*3/.test(msg);
      if (isFindingsExit) {
        context.logger.info(
          '[ProwlerScan] Prowler exited with code 3 (findings present); continuing to parse output.',
        );
        stderrCombined = msg;
      } else {
        throw err;
      }
    }

    if (rawSegments.length === 0) {
      try {
        const entries = await listVolumeFiles(outputVolume);
        const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith('.json'));
        const contents: string[] = [];
        for (const file of jsonFiles) {
          try {
            const fileMap = await outputVolume.readFiles([file]);
            contents.push(fileMap[file]);
          } catch {
            // Skip files that can't be read
          }
        }
        rawSegments = contents;
      } catch {
        // Fall through to check if rawSegments is empty
      }
    }

    const { findings, errors } =
      rawSegments.length > 0
        ? normaliseFindings(rawSegments, context.runId)
        : { findings: [] as NormalisedFinding[], errors: [] as string[] };

    if (rawSegments.length === 0) {
      context.logger.info(
        '[ProwlerScan] Prowler produced no ASFF output \u2014 likely 0 findings for the selected severity/region.',
      );
    }

    const { severityCounts, failed, passed, unknown } = computeSeverityCounts(findings);
    const scanId = buildScanId(parsedInputs.accountId, parsedParams.scanMode);
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
      await outputVolume.cleanup();
      context.logger.info('[ProwlerScan] Cleaned up output volume');
    }
    if (awsVolumeInitialized && awsCredsVolume) {
      await awsCredsVolume.cleanup();
      context.logger.info('[ProwlerScan] Cleaned up AWS creds volume');
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
  let awsVolume: IsolatedContainerVolume | undefined;
  let outVolume: IsolatedContainerVolume | undefined;
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

    awsVolume = new IsolatedContainerVolume(tenantId, `${context.runId}-prowler-aws-${account.id}`);
    outVolume = new IsolatedContainerVolume(tenantId, `${context.runId}-prowler-out-${account.id}`);

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

    await outVolume.initialize({});
    await setVolumeOwnership(outVolume, 1000, 1000);

    const dockerRunner: DockerRunnerConfig = {
      kind: 'docker',
      image: PROWLER_IMAGE,
      platform: 'linux/amd64',
      network: 'bridge',
      timeoutSeconds: SINGLE_ACCOUNT_TIMEOUT_SECONDS,
      env: {
        HOME: '/home/prowler',
        ...awsEnv,
      },
      command: cmd,
      volumes: [
        awsVolume.getVolumeConfig('/home/prowler/.aws', true),
        outVolume.getVolumeConfig('/output', false),
      ],
    };

    let rawSegments: string[] = [];
    let _stderrForAccount = '';

    try {
      const raw = await runComponentWithRunner<Record<string, unknown>, unknown>(
        dockerRunner,
        async () => ({}) as unknown,
        {},
        context,
      );

      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const parsed = runnerPayloadSchema.safeParse(raw);
        if (parsed.success) {
          const result = parsed.data;
          if (result.returncode !== 0 && !/exit code\s*3/.test(result.stderr)) {
            const msg = result.stderr.trim();
            throw new ServiceError(
              msg.length > 0 ? msg : `prowler exited with status ${result.returncode}`,
              { details: { returncode: result.returncode } },
            );
          }
          rawSegments = result.artifacts.length > 0 ? result.artifacts : [result.stdout];
          _stderrForAccount = result.stderr;
        }
      }
    } catch (err) {
      const msg = (err as Error)?.message ?? '';
      if (/exit code\s*3/.test(msg)) {
        _stderrForAccount = msg;
      } else {
        throw err;
      }
    }

    // Read ASFF files from volume if needed
    if (rawSegments.length === 0) {
      try {
        const entries = await listVolumeFiles(outVolume);
        const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith('.json'));
        for (const file of jsonFiles) {
          try {
            const fileMap = await outVolume.readFiles([file]);
            rawSegments.push(fileMap[file]);
          } catch {
            // Skip
          }
        }
      } catch {
        // Fall through
      }
    }

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
  docs: 'Execute Prowler inside Docker using `ghcr.io/shipsecai/prowler` (amd64 enforced on ARM hosts). Supports single-account AWS scans, org-wide multi-account scans, and the multi-cloud `prowler cloud` overview, with optional CLI flag customisation.',
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
      'Enable org-wide scan to discover all member accounts and run Prowler across the entire organization.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);

    if (parsedParams.orgScan) {
      return executeOrgScan({ inputs, params }, context);
    }
    return executeSingleAccountScan({ inputs, params }, context);
  },
});

componentRegistry.register(definition);

// Create local type aliases for backward compatibility
type Input = (typeof inputSchema)['__inferred'];
type Output = (typeof outputSchema)['__inferred'];

export type { Input as ProwlerScanInput, Output as ProwlerScanOutput };

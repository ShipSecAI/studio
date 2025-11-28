import { z } from 'zod';
import { spawn } from 'node:child_process';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  runComponentWithRunner,
} from '@shipsec/component-sdk';
import type { DockerRunnerConfig } from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const recommendedFlagOptions = [
  {
    id: 'quick',
    label: 'Quick scan (removed in v4 — ignored)',
    description: 'Kept for backwards compatibility; Prowler v4 ignores this option.',
    args: [],
    defaultSelected: false,
  },
  {
    id: 'severity-high-critical',
    label: 'Severity filter: high+critical (--severity high critical)',
    description: 'Limit findings to high and critical severities.',
    // Prowler v4 (argparse) accepts multiple choices in one --severity
    // Example: --severity high critical
    args: ['--severity', 'high', 'critical'],
    defaultSelected: true,
  },
  {
    id: 'ignore-exit-code',
    label: 'Do not fail on findings (--ignore-exit-code-3)',
    description: 'Treat exit code 3 (findings present) as success so flows do not fail.',
    args: ['--ignore-exit-code-3'],
    defaultSelected: true,
  },
  {
    id: 'no-banner',
    label: 'Hide banner (--no-banner)',
    description: 'Remove the ASCII banner from stdout for cleaner logs.',
    args: ['--no-banner'],
    defaultSelected: true,
  },
] as const;

type RecommendedFlagId = (typeof recommendedFlagOptions)[number]['id'];

const defaultSelectedFlagIds: RecommendedFlagId[] = recommendedFlagOptions
  .filter((option) => option.defaultSelected)
  .map((option) => option.id);

const recommendedFlagIdSchema = z.enum(
  recommendedFlagOptions.map((option) => option.id) as [RecommendedFlagId, ...RecommendedFlagId[]],
);

const severityLevels = ['critical', 'high', 'medium', 'low', 'informational', 'unknown'] as const;
type NormalisedSeverity = (typeof severityLevels)[number];

const statusLevels = ['FAILED', 'PASSED', 'WARNING', 'NOT_APPLICABLE', 'NOT_AVAILABLE', 'UNKNOWN'] as const;
type NormalisedStatus = (typeof statusLevels)[number];

const awsCredentialSchema = z.object({
  accessKeyId: z.string().min(16, 'Access key ID is required'),
  secretAccessKey: z.string().min(16, 'Secret access key is required'),
  sessionToken: z.string().min(10).optional(),
});

const inputSchema = z.object({
  accountId: z
    .string()
    .min(1, 'Account ID is required')
    .describe('AWS account to tag findings with (required for AWS scans).'),
  credentials: awsCredentialSchema
    .optional()
    .describe('AWS credentials emitted by the AWS Account component. Required for authenticated AWS scans.'),
  regions: z
    .string()
    .default('us-east-1')
    .describe('Comma separated AWS regions (AWS mode only).'),
  scanMode: z
    .enum(['aws', 'cloud'])
    .default('aws')
    .describe('Run `prowler aws` for a specific account or `prowler cloud` for the multi-cloud overview.'),
  recommendedFlags: z
    .array(recommendedFlagIdSchema)
    .default(defaultSelectedFlagIds)
    .describe('Toggle pre-populated CLI flags to apply to the Prowler command.'),
  customFlags: z
    .string()
    .trim()
    .max(1024, 'Custom CLI flags cannot exceed 1024 characters.')
    .optional()
    .describe('Raw CLI flags to append to the Prowler command.'),
});

type Input = z.infer<typeof inputSchema>;

const prowlerFindingSchema = z
  .object({
    Id: z.string().optional(),
    Title: z.string().optional(),
    Description: z.string().optional(),
    AwsAccountId: z.string().optional(),
    Severity: z
      .object({
        Label: z.string().optional(),
        Original: z.string().optional(),
        Normalized: z.number().optional(),
      })
      .partial()
      .optional(),
    Compliance: z
      .object({
        Status: z.string().optional(),
      })
      .partial()
      .optional(),
    Resources: z
      .array(
        z
          .object({
            Id: z.string().optional(),
            Type: z.string().optional(),
            Region: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    Remediation: z
      .object({
        Recommendation: z
          .object({
            Text: z.string().optional(),
            Url: z.string().optional(),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

type ProwlerFinding = z.infer<typeof prowlerFindingSchema>;

const runnerPayloadSchema = z.object({
  returncode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  command: z.array(z.string()),
  artifacts: z.array(z.string()).default([]),
  parse_error: z.string().optional(),
});

const normalisedFindingSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  accountId: z.string().nullable(),
  resourceId: z.string().nullable(),
  region: z.string().nullable(),
  severity: z.enum(severityLevels),
  status: z.enum(statusLevels),
  description: z.string().nullable(),
  remediationText: z.string().nullable(),
  recommendationUrl: z.string().nullable(),
  rawFinding: z.unknown(),
});

type NormalisedFinding = z.infer<typeof normalisedFindingSchema>;

const outputSchema = z.object({
  scanId: z.string(),
  findings: z.array(normalisedFindingSchema),
  rawOutput: z.string(),
  summary: z.object({
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
  }),
  command: z.array(z.string()),
  stderr: z.string(),
  errors: z.array(z.string()).optional(),
});

type Output = z.infer<typeof outputSchema>;

const recommendedFlagMap = new Map<RecommendedFlagId, string[]>(
  recommendedFlagOptions.map((option) => [option.id, [...option.args]]),
);

async function listVolumeFiles(volume: IsolatedContainerVolume): Promise<string[]> {
  const volumeName = volume.getVolumeName();
  if (!volumeName) return [];

  return new Promise((resolve, reject) => {
    const proc = spawn('docker', [
      'run',
      '--rm',
      '-v',
      `${volumeName}:/data`,
      '--entrypoint',
      'sh',
      'alpine:latest',
      '-c',
      'ls -1 /data',
    ]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      reject(error);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to list volume files: ${stderr.trim()}`));
      } else {
        resolve(
          stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        );
      }
    });
  });
}

const definition: ComponentDefinition<Input, Output> = {
  id: 'security.prowler.scan',
  label: 'Prowler Scan',
  category: 'security',
  runner: {
    kind: 'inline',
  },
  inputSchema,
  outputSchema,
  docs:
    'Execute Prowler inside Docker using `prowlercloud/prowler` (amd64 enforced on ARM hosts). Supports AWS account scans and the multi-cloud `prowler cloud` overview, with optional CLI flag customisation.',
  metadata: {
    slug: 'prowler-scan',
    version: '2.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Run Toniblyx Prowler to assess AWS accounts or multi-cloud posture. Streams raw logs while returning structured findings in ASFF-derived JSON.',
    documentation: 'https://github.com/prowler-cloud/prowler',
    icon: 'ShieldCheck',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    inputs: [
      {
        id: 'accountId',
        label: 'Account ID',
        dataType: port.text(),
        required: true,
        description: 'Account identifier forwarded from the AWS Credentials component.',
      },
      {
        id: 'credentials',
        label: 'AWS Credentials',
        dataType: port.json(),
        required: false,
        description: 'Structured credentials object (`{ accessKeyId, secretAccessKey, sessionToken? }`).',
      },
      {
        id: 'regions',
        label: 'Regions',
        dataType: port.text(),
        required: false,
        description: 'Comma separated AWS regions to cover when scan mode is AWS.',
      },
    ],
    outputs: [
      {
        id: 'scanId',
        label: 'Scan ID',
        dataType: port.text(),
        description: 'Deterministic identifier for the scan run.',
      },
      {
        id: 'findings',
        label: 'Findings',
        dataType: port.list(port.json()),
        description:
          'Array of normalized findings derived from Prowler ASFF output (includes severity, resource id, remediation).',
      },
      {
        id: 'summary',
        label: 'Summary',
        dataType: port.json(),
        description: 'Aggregate counts, regions, selected flag metadata, and other run statistics.',
      },
    ],
    parameters: [
      {
        id: 'scanMode',
        label: 'Scan Target',
        type: 'select',
        required: false,
        default: 'aws',
        options: [
          { label: 'AWS Account (prowler aws)', value: 'aws' },
          { label: 'Cloud Overview (prowler cloud)', value: 'cloud' },
        ],
        description:
          'Choose between a targeted AWS account scan or the multi-cloud overview. AWS mode honours the regions field.',
      },
      {
        id: 'regions',
        label: 'Regions',
        type: 'text',
        required: false,
        default: 'us-east-1',
        description: 'Comma separated AWS regions passed to `--region`. Ignored in Cloud mode.',
      },
      {
        id: 'recommendedFlags',
        label: 'Recommended Flags',
        type: 'multi-select',
        required: false,
        default: defaultSelectedFlagIds,
        options: recommendedFlagOptions.map((option) => ({
          label: option.label,
          value: option.id,
          description: option.description,
        })),
        description: 'Pre-selected CLI flags appended automatically to the Prowler command.',
      },
      {
        id: 'customFlags',
        label: 'Additional CLI Flags',
        type: 'textarea',
        required: false,
        rows: 3,
        placeholder: '--exclude-checks extra73,extra74 --severity-filter medium,high,critical',
        description: 'Any extra CLI flags appended verbatim to the prowler command.',
      },
    ],
    examples: [
      'Run nightly `prowler aws --quick --severity-filter high,critical` scans on production accounts and forward findings into ELK.',
      'Use `prowler cloud` with custom flags to generate a multi-cloud compliance snapshot.',
    ],
  },
  async execute(params, context) {
    // Helper: split custom CLI flags honoring simple quotes
    const splitArgs = (input: string): string[] => {
      const args: string[] = [];
      let current = '';
      let quote: '"' | "'" | null = null;
      let escape = false;
      for (const ch of input) {
        if (escape) {
          current += ch;
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (quote) {
          if (ch === quote) {
            quote = null;
          } else {
            current += ch;
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch as '"' | "'";
          continue;
        }
        if (/\s/.test(ch)) {
          if (current.length > 0) {
            args.push(current);
            current = '';
          }
          continue;
        }
        current += ch;
      }
      if (current.length > 0) args.push(current);
      return args;
    };
    const parsedRegions = params.regions
      .split(',')
      .map((region) => region.trim())
      .filter((region) => region.length > 0);
    const regions = parsedRegions.length > 0 ? parsedRegions : ['us-east-1'];

    const selectedFlags = new Set<RecommendedFlagId>(params.recommendedFlags ?? defaultSelectedFlagIds);
    const resolvedFlagArgs = Array.from(selectedFlags).flatMap((flagId) => recommendedFlagMap.get(flagId) ?? []);

    // Validate creds when running AWS scans
    if (params.scanMode === 'aws' && !params.credentials) {
      throw new Error(
        'AWS scan requires credentials input. Ensure the previous step outputs { accessKeyId, secretAccessKey, sessionToken? } into the "credentials" input.',
      );
    }

    // Prepare AWS environment and optional shared credentials/config files
    const awsEnv: Record<string, string> = {};
    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const awsCredsVolume = params.credentials
      ? new IsolatedContainerVolume(tenantId, `${context.runId}-prowler-aws`)
      : null;

    if (params.credentials) {
      awsEnv.AWS_ACCESS_KEY_ID = params.credentials.accessKeyId;
      awsEnv.AWS_SECRET_ACCESS_KEY = params.credentials.secretAccessKey;
      if (params.credentials.sessionToken) {
        awsEnv.AWS_SESSION_TOKEN = params.credentials.sessionToken;
      }

      // Hint to SDKs where to find the shared files
      awsEnv.AWS_SHARED_CREDENTIALS_FILE = '/home/prowler/.aws/credentials';
      awsEnv.AWS_CONFIG_FILE = '/home/prowler/.aws/config';
      awsEnv.AWS_PROFILE = 'default';
    }

    if (params.scanMode === 'aws' && regions.length > 0) {
      awsEnv.AWS_REGION = awsEnv.AWS_REGION ?? regions[0];
      awsEnv.AWS_DEFAULT_REGION = awsEnv.AWS_DEFAULT_REGION ?? regions[0];
    }

    context.logger.info(
      `[ProwlerScan] Running prowler ${params.scanMode} for ${params.accountId} with regions: ${regions.join(', ')}`,
    );
    context.emitProgress(
      `Executing prowler ${params.scanMode} scan across ${regions.length} region${regions.length === 1 ? '' : 's'}`,
    );
    // Build the prowler command entirely in TypeScript.
    // Note: prowler image entrypoint already invokes `prowler`,
    // so only pass the provider subcommand (aws/cloud) and flags.
    const cmd: string[] = [params.scanMode];
    if (params.scanMode === 'aws') {
      for (const region of regions) {
        cmd.push('--region', region);
      }
    }
    // Ensure flows do not fail on findings by default even if older saved
    // workflows didn't have the updated default for the flag.
    if (!resolvedFlagArgs.includes('--ignore-exit-code-3')) {
      resolvedFlagArgs.push('--ignore-exit-code-3');
    }
    cmd.push(...resolvedFlagArgs);
    if (params.customFlags && params.customFlags.trim().length > 0) {
      try {
        cmd.push(...splitArgs(params.customFlags));
      } catch (err) {
        throw new Error(`Failed to parse custom CLI flags: ${(err as Error).message}`);
      }
    }

    cmd.push('--output-formats', 'json-asff', '--output-directory', '/output', '--output-filename', 'shipsec');
    context.logger.info(`[ProwlerScan] Command: ${cmd.join(' ')}`);

    // Prepare a one-off runner with dynamic command and volume
    const dockerRunner: DockerRunnerConfig = {
      kind: 'docker',
      image: 'prowlercloud/prowler:latest',
      platform: 'linux/amd64',
      network: 'bridge',
      timeoutSeconds: 900,
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
      // Initialize AWS credentials volume if provided
      if (awsCredsVolume && params.credentials) {
        const credsLines = [
          '[default]',
          `aws_access_key_id = ${params.credentials.accessKeyId}`,
          `aws_secret_access_key = ${params.credentials.secretAccessKey}`,
        ];
        if (params.credentials.sessionToken) {
          credsLines.push(`aws_session_token = ${params.credentials.sessionToken}`);
        }

        const cfgRegion = regions[0] ?? 'us-east-1';
        const cfgLines = ['[default]', `region = ${cfgRegion}`, 'output = json'];

        await awsCredsVolume.initialize({
          credentials: credsLines.join('\n'),
          config: cfgLines.join('\n'),
        });
        awsVolumeInitialized = true;
        context.logger.info(`[ProwlerScan] Created isolated AWS creds volume: ${awsCredsVolume.getVolumeName()}`);

        dockerRunner.volumes = [
          ...(dockerRunner.volumes ?? []),
          awsCredsVolume.getVolumeConfig('/home/prowler/.aws', true),
        ];
      }

      // Initialize output volume
      await outputVolume.initialize({});
      outputVolumeInitialized = true;
        context.logger.info(`[ProwlerScan] Created isolated output volume: ${outputVolume.getVolumeName()}`);
        dockerRunner.volumes = [
          ...(dockerRunner.volumes ?? []),
          outputVolume.getVolumeConfig('/output', false),
        ];

      const raw = await runComponentWithRunner<Record<string, unknown>, unknown>(
        dockerRunner,
        async () => ({} as unknown),
        {},
        context,
      );

      // If the container returned our previous JSON payload shape, keep supporting it
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const parsed = runnerPayloadSchema.safeParse(raw);
        if (parsed.success) {
          const result = parsed.data;
          if (result.parse_error) {
            throw new Error(`Failed to parse custom CLI flags: ${result.parse_error}`);
          }
          if (result.returncode !== 0) {
            const msg = result.stderr.trim();
            throw new Error(msg.length > 0 ? msg : `prowler exited with status ${result.returncode}`);
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
          // Prowler uses exit code 3 to indicate checks failed (findings present).
          // Treat this as a successful run for parsing purposes; keep stderr for summary.
          context.logger.info('[ProwlerScan] Prowler exited with code 3 (findings present); continuing to parse output.');
          stderrCombined = msg;
          // Do not cleanup here; we still need to read the mounted output directory.
        } else {
          throw err;
        }
      }

      // If we didn't get JSON from the container, read ASFF files from the mounted folder
      if (rawSegments.length === 0) {
        try {
          const entries = await listVolumeFiles(outputVolume);
        const jsonFiles = entries.filter((f) => f.toLowerCase().endsWith('.json'));
        const contents: string[] = [];
        for (const file of jsonFiles) {
          try {
            const fileMap = await outputVolume.readFiles([file]);
            contents.push(fileMap[file]);
          } catch {}
        }
        rawSegments = contents;
      } catch {}
    }

    if (rawSegments.length === 0) {
      throw new Error('Prowler did not produce any ASFF output files.');
    }

    const { findings, errors } = normaliseFindings(rawSegments, context.runId);

    const generatedAt = new Date().toISOString();
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

    const scanId = buildScanId(params.accountId, params.scanMode);

    const output: Output = {
      scanId,
      findings,
      rawOutput: rawSegments.join('\n'),
      summary: {
        totalFindings: findings.length,
        failed,
        passed,
        unknown,
        severityCounts,
        generatedAt,
        regions,
        scanMode: params.scanMode,
        selectedFlagIds: Array.from(selectedFlags),
        customFlags: params.customFlags?.trim() || null,
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
  },
};

function buildScanId(accountId: string, scanMode: 'aws' | 'cloud'): string {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const safeAccount = accountId.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 32);
  return `prowler-${scanMode}-${safeAccount}-${timestamp}`;
}

function normaliseFindings(rawSegments: string[], runId: string): {
  findings: NormalisedFinding[];
  errors: string[];
} {
  const findings: NormalisedFinding[] = [];
  const errors: string[] = [];

  rawSegments.forEach((segment, segmentIndex) => {
    const candidates = parseSegment(segment, segmentIndex, errors);
    candidates.forEach((candidate, candidateIndex) => {
      const parsed = prowlerFindingSchema.safeParse(candidate);
      if (!parsed.success) {
        errors.push(`Segment ${segmentIndex + 1} item ${candidateIndex + 1}: ${parsed.error.message}`);
        return;
      }
      findings.push(toNormalisedFinding(parsed.data, findings.length, runId));
    });
  });

  return { findings, errors };
}

function parseSegment(segment: string, segmentIndex: number, errors: string[]): unknown[] {
  const trimmed = (segment ?? '').trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      if (Array.isArray(record.Findings)) {
        return record.Findings;
      }
      if (Array.isArray(record.findings)) {
        return record.findings;
      }
      return [parsed];
    }
  } catch (error) {
    // Fallback to NDJSON parsing
    const ndjsonResults: unknown[] = [];
    trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .forEach((line, lineIndex) => {
        try {
          ndjsonResults.push(JSON.parse(line));
        } catch (innerError) {
          errors.push(
            `Segment ${segmentIndex + 1} line ${lineIndex + 1}: Unable to parse JSON (${(innerError as Error).message})`,
          );
        }
      });

    if (ndjsonResults.length > 0) {
      return ndjsonResults;
    }

    errors.push(`Segment ${segmentIndex + 1}: Unable to parse Prowler output as JSON.`);
  }

  return [];
}

function toNormalisedFinding(finding: ProwlerFinding, index: number, runId: string): NormalisedFinding {
  const primaryResource = Array.isArray(finding.Resources) && finding.Resources.length > 0 ? finding.Resources[0] : undefined;
  const accountId =
    finding.AwsAccountId ??
    extractAccountId(primaryResource?.Id) ??
    null;
  const region = primaryResource?.Region ?? extractRegionFromArn(primaryResource?.Id) ?? null;
  const resourceId = primaryResource?.Id ?? null;
  const severity = normaliseSeverity(finding);
  const status = normaliseStatus(finding.Compliance?.Status);
  const remediationText = finding.Remediation?.Recommendation?.Text ?? null;
  const recommendationUrl = finding.Remediation?.Recommendation?.Url ?? null;

  return {
    id: finding.Id ?? `${runId}-finding-${index + 1}`,
    title: finding.Title ?? null,
    accountId,
    resourceId,
    region,
    severity,
    status,
    description: finding.Description ?? null,
    remediationText,
    recommendationUrl,
    rawFinding: finding,
  };
}

function normaliseSeverity(finding: ProwlerFinding): NormalisedSeverity {
  const label =
    finding.Severity?.Label ??
    finding.Severity?.Original ??
    '';

  if (typeof label === 'string' && label.trim().length > 0) {
    const lowered = label.trim().toLowerCase();
    if (lowered.startsWith('crit')) return 'critical';
    if (lowered.startsWith('high')) return 'high';
    if (lowered.startsWith('med')) return 'medium';
    if (lowered.startsWith('low')) return 'low';
    if (lowered.startsWith('info')) return 'informational';
  }

  const normalisedScore = finding.Severity?.Normalized;
  if (typeof normalisedScore === 'number' && Number.isFinite(normalisedScore)) {
    if (normalisedScore >= 90) return 'critical';
    if (normalisedScore >= 70) return 'high';
    if (normalisedScore >= 40) return 'medium';
    if (normalisedScore >= 1) return 'low';
    return 'informational';
  }

  return 'unknown';
}

function normaliseStatus(status?: string): NormalisedStatus {
  if (!status || status.trim().length === 0) {
    return 'UNKNOWN';
  }
  const upper = status.trim().toUpperCase();
  if (upper.includes('FAIL')) return 'FAILED';
  if (upper.includes('PASS')) return 'PASSED';
  if (upper.includes('WARN')) return 'WARNING';
  if (upper.includes('NOT_APPLICABLE') || upper === 'NOTAPPLICABLE') return 'NOT_APPLICABLE';
  if (upper.includes('NOT_AVAILABLE') || upper === 'NOTAVAILABLE') return 'NOT_AVAILABLE';
  return 'UNKNOWN';
}

function extractAccountId(resourceId?: string): string | null {
  if (!resourceId) return null;
  const accountMatch = resourceId.match(/arn:[^:]*:[^:]*:([^:]*):(\d{12})/);
  if (accountMatch && accountMatch[2]) {
    return accountMatch[2];
  }
  return null;
}

function extractRegionFromArn(resourceId?: string): string | null {
  if (!resourceId) return null;
  const match = resourceId.match(/arn:[^:]*:[^:]*:([^:]*):/);
  if (match && match[1]) {
    const region = match[1];
    if (region && region !== '*' && region !== '') {
      return region;
    }
  }
  return null;
}

componentRegistry.register(definition);

export type { Input as ProwlerScanInput, Output as ProwlerScanOutput };

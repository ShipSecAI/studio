import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ContainerError,
  ValidationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const scanTypeSchema = z.enum(['git', 'github', 'gitlab', 's3', 'gcs', 'filesystem', 'docker']);

const inputSchema = inputs({
  scanTarget: port(
    z
      .string()
      .min(1, 'Scan target cannot be empty')
      .describe('Target to scan (repository URL, filesystem path, S3 bucket, etc.)'),
    {
      label: 'Scan Target',
      description: 'Target to scan (repository URL, filesystem path, bucket, etc.).',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
});

type Output = z.infer<typeof outputSchema>;

const parameterSchema = parameters({
  scanType: param(scanTypeSchema.default('git').describe('Type of scan to perform'), {
    label: 'Scan Type',
    editor: 'select',
    options: [
      { label: 'Git', value: 'git' },
      { label: 'GitHub', value: 'github' },
      { label: 'GitLab', value: 'gitlab' },
      { label: 'S3', value: 's3' },
      { label: 'GCS', value: 'gcs' },
      { label: 'Filesystem', value: 'filesystem' },
      { label: 'Docker', value: 'docker' },
    ],
  }),
  filesystemContent: param(
    z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Files to write to isolated volume for filesystem scanning (filename -> content map)',
      ),
    {
      label: 'Filesystem Files',
      editor: 'json',
      description: 'JSON map of filename to content for filesystem scanning (optional).',
      helpText:
        'Only use with scanType=filesystem. Files are written to an isolated Docker volume.',
    },
  ),
  onlyVerified: param(z.boolean().default(true).describe('Show only verified secrets'), {
    label: 'Only Verified',
    editor: 'boolean',
    description: 'Show only verified secrets (actively valid credentials).',
    helpText: 'Disable to also show unverified potential secrets.',
  }),
  jsonOutput: param(z.boolean().default(true).describe('Output results in JSON format'), {
    label: 'JSON Output',
    editor: 'boolean',
    description: 'Output results in JSON format for parsing.',
    helpText: 'JSON format provides structured data for further processing.',
  }),
  branch: param(
    z
      .string()
      .trim()
      .optional()
      .describe('Specific branch to scan - use PR branch for PR scanning (git/github only)'),
    {
      label: 'Branch',
      editor: 'text',
      placeholder: 'feature-branch',
      description: 'Specific branch to scan (git/github only).',
      helpText: 'For PR scanning: set this to the PR/feature branch name.',
    },
  ),
  sinceCommit: param(
    z
      .string()
      .trim()
      .optional()
      .describe('Scan commits since this reference - use base branch for PR scanning (git only)'),
    {
      label: 'Since Commit',
      editor: 'text',
      placeholder: 'main',
      description: 'Scan commits since this reference (git only).',
      helpText: 'For PR scans: set this to the base branch (e.g. "main").',
    },
  ),
  includeIssueComments: param(
    z.boolean().default(false).describe('Include GitHub issue comments (github only)'),
    {
      label: 'Include Issue Comments',
      editor: 'boolean',
      description: 'Scan GitHub issue comments (github only).',
    },
  ),
  includePRComments: param(
    z.boolean().default(false).describe('Include pull request comments (github only)'),
    {
      label: 'Include PR Comments',
      editor: 'boolean',
      description: 'Scan pull request comments (github only).',
    },
  ),
  customFlags: param(
    z
      .string()
      .trim()
      .optional()
      .describe('Additional CLI flags to append to the TruffleHog command'),
    {
      label: 'Custom CLI Flags',
      editor: 'textarea',
      rows: 3,
      placeholder: '--fail --concurrency=8',
      description: 'Additional TruffleHog CLI flags.',
      helpText: 'Use --fail to exit with code 183 if secrets are found.',
    },
  ),
});

interface Secret {
  DetectorType?: string;
  DetectorName?: string;
  DecoderName?: string;
  Verified?: boolean;
  Raw?: string;
  RawV2?: string;
  Redacted?: string;
  SourceMetadata?: {
    Data?: {
      Git?: {
        commit?: string;
        file?: string;
        email?: string;
        repository?: string;
        timestamp?: string;
      };
      Github?: Record<string, any>;
      Gitlab?: Record<string, any>;
      Filesystem?: {
        file?: string;
      };
    };
  };
  StructuredData?: Record<string, any>;
}

const outputSchema = outputs({
  secrets: port(z.array(z.any()), {
    label: 'Secrets',
    description: 'Secrets detected by TruffleHog.',
    allowAny: true,
    reason: 'TruffleHog returns heterogeneous secret payloads.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw TruffleHog output for debugging.',
  }),
  secretCount: port(z.number(), {
    label: 'Secret Count',
    description: 'Total number of secrets detected.',
  }),
  verifiedCount: port(z.number(), {
    label: 'Verified Count',
    description: 'Number of verified secrets detected.',
  }),
  hasVerifiedSecrets: port(z.boolean(), {
    label: 'Has Verified Secrets',
    description: 'True when any verified secrets are detected.',
  }),
});

// Helper function to build TruffleHog command arguments
function buildTruffleHogCommand(
  input: (typeof inputSchema)['__inferred'] & (typeof parameterSchema)['__inferred'],
): string[] {
  const args: string[] = [input.scanType];

  // Add scan target based on scan type
  switch (input.scanType) {
    case 's3':
    case 'gcs':
      args.push(`--bucket=${input.scanTarget}`);
      break;
    case 'docker':
      args.push(`--image=${input.scanTarget}`);
      break;
    default:
      args.push(input.scanTarget);
  }

  // Add results filter
  if (input.onlyVerified) {
    args.push('--results=verified');
  } else {
    args.push('--results=verified,unknown');
  }

  // Add JSON output flag
  if (input.jsonOutput) {
    args.push('--json');
  }

  // Add branch flag (git/github only)
  if (input.branch && (input.scanType === 'git' || input.scanType === 'github')) {
    args.push(`--branch=${input.branch}`);
  }

  // Add since-commit flag (git only)
  if (input.sinceCommit && input.scanType === 'git') {
    args.push(`--since-commit=${input.sinceCommit}`);
  }

  // Add issue comments flag (github only)
  if (input.includeIssueComments && input.scanType === 'github') {
    args.push('--issue-comments');
  }

  // Add PR comments flag (github only)
  if (input.includePRComments && input.scanType === 'github') {
    args.push('--pr-comments');
  }

  // Add custom flags if provided
  if (input.customFlags) {
    args.push(...input.customFlags.split(' ').filter((f) => f.trim().length > 0));
  }

  return args;
}

// Helper function to parse raw TruffleHog JSON output
function parseRawOutput(rawOutput: string): Output {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return {
      secrets: [],
      rawOutput: '',
      secretCount: 0,
      verifiedCount: 0,
      hasVerifiedSecrets: false,
    };
  }

  // Try to parse as a single JSON object first (for test mocks)
  try {
    const parsed = JSON.parse(rawOutput);
    // If it has the expected output structure, return it
    if ('secrets' in parsed && 'secretCount' in parsed) {
      return outputSchema.parse(parsed);
    }
  } catch {
    // Not a single JSON object, continue to NDJSON parsing
  }

  // TruffleHog outputs one JSON object per line for each secret found (NDJSON format)
  const lines = rawOutput.split('\n').filter((line) => line.trim().length > 0);
  const secrets: Secret[] = [];
  let verifiedCount = 0;

  for (const line of lines) {
    try {
      const secret = JSON.parse(line);
      secrets.push(secret);
      if (secret.Verified === true) {
        verifiedCount++;
      }
    } catch (_error) {
      // Skip non-JSON lines (like status messages)
      continue;
    }
  }

  return {
    secrets,
    rawOutput,
    secretCount: secrets.length,
    verifiedCount,
    hasVerifiedSecrets: verifiedCount > 0,
  };
}

const definition = defineComponent({
  id: 'shipsec.trufflehog.scan',
  label: 'TruffleHog',
  category: 'security',
  runner: {
    kind: 'docker',
    image: 'trufflesecurity/trufflehog:v3.92.1',
    entrypoint: 'trufflehog',
    network: 'bridge',
    command: [], // Will be built dynamically in execute
    timeoutSeconds: 300,
    env: {
      HOME: '/tmp',
    },
  },
  retryPolicy: {
    maxAttempts: 2,
    initialIntervalSeconds: 5,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
  } satisfies ComponentRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Scan for secrets and credentials using TruffleHog. Supports Git repositories, GitHub, GitLab, filesystems, S3 buckets, Docker images, and more.',
  ui: {
    slug: 'trufflehog',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Find, verify, and analyze leaked credentials across repositories, filesystems, and cloud storage using TruffleHog.',
    documentation:
      'TruffleHog discovers and verifies secrets across 800+ credential types. Scan Git history, filesystems, S3 buckets, Docker images, and more.',
    documentationUrl: 'https://github.com/trufflesecurity/trufflehog',
    icon: 'Key',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`trufflehog git https://github.com/org/repo --results=verified --json` - Scans a Git repository for verified secrets and outputs results in JSON format.',
    examples: [
      'Scan a Git repository for verified secrets before deployment.',
      'Audit filesystem directories for accidentally committed credentials.',
      'Check Docker images for leaked API keys before pushing to registry.',
      'Scan only changes in a Pull Request by setting branch to PR branch and sinceCommit to base branch.',
      'Scan last 10 commits in CI/CD using sinceCommit=HEAD~10 to catch recent secrets.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedParams = parameterSchema.parse(params);
    const runnerPayload = {
      ...inputs,
      ...parsedParams,
    };

    context.logger.info(
      `[TruffleHog] Scanning ${runnerPayload.scanType} target: ${runnerPayload.scanTarget}`,
    );

    const optionsSummary = {
      scanType: runnerPayload.scanType,
      onlyVerified: runnerPayload.onlyVerified ?? true,
      jsonOutput: runnerPayload.jsonOutput ?? true,
      branch: runnerPayload.branch ?? null,
      sinceCommit: runnerPayload.sinceCommit ?? null,
      hasFilesystemContent: !!runnerPayload.filesystemContent,
    };

    context.emitProgress({
      message: 'Launching TruffleHog scan…',
      level: 'info',
      data: { target: runnerPayload.scanTarget, options: optionsSummary },
    });

    // Handle filesystem scanning with isolated volumes
    let volume: IsolatedContainerVolume | undefined;
    let effectiveInput = runnerPayload;

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('TruffleHog runner must be docker', {
        details: { reason: 'runner_type_mismatch', expected: 'docker', actual: baseRunner.kind },
      });
    }

    try {
      // If filesystemContent is provided, use isolated volume
      if (
        runnerPayload.filesystemContent &&
        Object.keys(runnerPayload.filesystemContent).length > 0
      ) {
        if (runnerPayload.scanType !== 'filesystem') {
          throw new ValidationError('filesystemContent can only be used with scanType=filesystem', {
            fieldErrors: { scanType: ['Must be "filesystem" when using filesystemContent'] },
          });
        }

        const tenantId = (context as any).tenantId ?? 'default-tenant';
        volume = new IsolatedContainerVolume(tenantId, context.runId);

        // Initialize volume with files
        const volumeName = await volume.initialize(runnerPayload.filesystemContent);
        context.logger.info(`[TruffleHog] Created isolated volume: ${volumeName}`);

        // Override scanTarget to point to mounted volume
        effectiveInput = {
          ...runnerPayload,
          scanTarget: '/scan',
        };
      }

      // Build TruffleHog command arguments in TypeScript
      const commandArgs = buildTruffleHogCommand(effectiveInput);

      context.logger.info(`[TruffleHog] Command: trufflehog ${commandArgs.join(' ')}`);

      // Configure runner with command args and optional volume
      const runnerConfig: DockerRunnerConfig = {
        ...baseRunner,
        command: commandArgs,
        volumes: volume ? [volume.getVolumeConfig('/scan', true)] : undefined,
      };

      // Execute TruffleHog
      // Note: TruffleHog exits with code 183 when secrets are found and --fail is used
      // This is not an error, so we need to handle it specially
      let rawResult: unknown;
      try {
        rawResult = await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          effectiveInput,
          context,
        );
      } catch (error) {
        // Check if this is a TruffleHog exit code 183 (secrets found with --fail)
        const errorMessage = error instanceof Error ? error.message : String(error);

        // If it's exit code 183, this means secrets were found (not an error)
        // We should still parse and return the output
        if (
          errorMessage.includes('exit code 183') ||
          errorMessage.includes('exited with code 183')
        ) {
          context.logger.info('[TruffleHog] Exit code 183: secrets found (--fail flag)');

          // Try to extract output from error if available
          // For now, we'll re-throw to surface the failure as requested
          // The caller can handle exit code 183 as needed
          throw error;
        }

        // For any other error, propagate it
        context.logger.error(`[TruffleHog] Scan failed: ${errorMessage}`);
        throw error;
      }

      // Parse the raw output
      const output =
        typeof rawResult === 'string' ? parseRawOutput(rawResult) : (rawResult as Output);

      // Log and emit progress
      context.logger.info(
        `[TruffleHog] Found ${output.secretCount} secrets (${output.verifiedCount} verified)`,
      );

      if (output.hasVerifiedSecrets) {
        context.emitProgress({
          message: `⚠️  Found ${output.verifiedCount} verified secrets!`,
          level: 'warn',
          data: {
            secretCount: output.secretCount,
            verifiedCount: output.verifiedCount,
          },
        });
      } else if (output.secretCount > 0) {
        context.emitProgress({
          message: `Found ${output.secretCount} potential secrets (unverified)`,
          level: 'info',
        });
      } else {
        context.emitProgress({
          message: 'No secrets detected',
          level: 'info',
        });
      }

      return output;
    } finally {
      // Always cleanup volume if it was created
      if (volume) {
        await volume.cleanup();
        context.logger.info('[TruffleHog] Cleaned up isolated volume');
      }
    }
  },
});

componentRegistry.register(definition);

// Create local type aliases for backward compatibility
type TruffleHogInput = typeof inputSchema;
type TruffleHogOutput = typeof outputSchema;

export type { TruffleHogInput, TruffleHogOutput };

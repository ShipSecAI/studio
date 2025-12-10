import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  runComponentWithRunner,
  type DockerRunnerConfig,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

const scanTypeSchema = z.enum([
  'git',
  'github',
  'gitlab',
  's3',
  'gcs',
  'filesystem',
  'docker',
]);

const inputSchema = z.object({
  scanTarget: z
    .string()
    .min(1, 'Scan target cannot be empty')
    .describe('Target to scan (repository URL, filesystem path, S3 bucket, etc.)'),
  scanType: scanTypeSchema
    .default('git')
    .describe('Type of scan to perform'),
  filesystemContent: z
    .record(z.string(), z.string())
    .optional()
    .describe('Files to write to isolated volume for filesystem scanning (filename -> content map)'),
  onlyVerified: z
    .boolean()
    .optional()
    .default(true)
    .describe('Show only verified secrets'),
  jsonOutput: z
    .boolean()
    .optional()
    .default(true)
    .describe('Output results in JSON format'),
  branch: z
    .string()
    .trim()
    .optional()
    .describe('Specific branch to scan - use PR branch for PR scanning (git/github only)'),
  sinceCommit: z
    .string()
    .trim()
    .optional()
    .describe('Scan commits since this reference - use base branch for PR scanning (git only)'),
  includeIssueComments: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include GitHub issue comments (github only)'),
  includePRComments: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include pull request comments (github only)'),
  customFlags: z
    .string()
    .trim()
    .optional()
    .describe('Additional CLI flags to append to the TruffleHog command'),
});

type Input = z.infer<typeof inputSchema>;

type Secret = {
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
};

type Output = {
  secrets: Secret[];
  rawOutput: string;
  secretCount: number;
  verifiedCount: number;
  hasVerifiedSecrets: boolean;
};

const outputSchema = z.object({
  secrets: z.array(z.any()),
  rawOutput: z.string(),
  secretCount: z.number(),
  verifiedCount: z.number(),
  hasVerifiedSecrets: z.boolean(),
});

// Helper function to build TruffleHog command arguments
function buildTruffleHogCommand(input: Input): string[] {
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
    args.push(...input.customFlags.split(' ').filter(f => f.trim().length > 0));
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
  const lines = rawOutput.split('\n').filter(line => line.trim().length > 0);
  const secrets: Secret[] = [];
  let verifiedCount = 0;

  for (const line of lines) {
    try {
      const secret = JSON.parse(line);
      secrets.push(secret);
      if (secret.Verified === true) {
        verifiedCount++;
      }
    } catch (error) {
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

const definition: ComponentDefinition<Input, Output> = {
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
  inputSchema,
  outputSchema,
  docs: 'Scan for secrets and credentials using TruffleHog. Supports Git repositories, GitHub, GitLab, filesystems, S3 buckets, Docker images, and more.',
  metadata: {
    slug: 'trufflehog',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description: 'Find, verify, and analyze leaked credentials across repositories, filesystems, and cloud storage using TruffleHog.',
    documentation: 'TruffleHog discovers and verifies secrets across 800+ credential types. Scan Git history, filesystems, S3 buckets, Docker images, and more.',
    documentationUrl: 'https://github.com/trufflesecurity/trufflehog',
    icon: 'Key',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example: '`trufflehog git https://github.com/org/repo --results=verified --json` - Scans a Git repository for verified secrets and outputs results in JSON format.',
    inputs: [
      {
        id: 'scanTarget',
        label: 'Scan Target',
        dataType: port.text(),
        required: true,
        description: 'Repository URL, filesystem path, S3 bucket name, or Docker image to scan.',
      },
      {
        id: 'scanType',
        label: 'Scan Type',
        dataType: port.text(),
        required: true,
        description: 'Type of scan: git, github, gitlab, s3, gcs, filesystem, or docker.',
      },
      {
        id: 'filesystemContent',
        label: 'Filesystem Content',
        dataType: port.any(),
        required: false,
        description: 'Map of filename to content for filesystem scanning (uses isolated volumes).',
      },
    ],
    outputs: [
      {
        id: 'secrets',
        label: 'Detected Secrets',
        dataType: port.list(port.any()),
        description: 'Array of secrets discovered by TruffleHog with verification status.',
      },
      {
        id: 'rawOutput',
        label: 'Raw Output',
        dataType: port.text(),
        description: 'Raw TruffleHog output for debugging.',
      },
      {
        id: 'secretCount',
        label: 'Secret Count',
        dataType: port.number(),
        description: 'Total number of secrets found.',
      },
      {
        id: 'verifiedCount',
        label: 'Verified Count',
        dataType: port.number(),
        description: 'Number of verified secrets.',
      },
      {
        id: 'hasVerifiedSecrets',
        label: 'Has Verified Secrets',
        dataType: port.boolean(),
        description: 'Boolean flag indicating if any verified secrets were found.',
      },
    ],
    examples: [
      'Scan a Git repository for verified secrets before deployment.',
      'Audit filesystem directories for accidentally committed credentials.',
      'Check Docker images for leaked API keys before pushing to registry.',
      'Scan only changes in a Pull Request by setting branch to PR branch and sinceCommit to base branch.',
      'Scan last 10 commits in CI/CD using sinceCommit=HEAD~10 to catch recent secrets.',
    ],
    parameters: [
      {
        id: 'filesystemContent',
        label: 'Filesystem Files',
        type: 'textarea',
        rows: 10,
        placeholder: '{"config.yaml": "api_key: secret123", "app.py": "# code here"}',
        description: 'JSON map of filename to content for filesystem scanning (optional).',
        helpText: 'Only use with scanType=filesystem. Files are written to an isolated Docker volume for secure multi-tenant scanning.',
      },
      {
        id: 'onlyVerified',
        label: 'Only Verified',
        type: 'boolean',
        default: true,
        description: 'Show only verified secrets (actively valid credentials).',
        helpText: 'Disable to also show unverified potential secrets.',
      },
      {
        id: 'jsonOutput',
        label: 'JSON Output',
        type: 'boolean',
        default: true,
        description: 'Output results in JSON format for parsing.',
        helpText: 'JSON format provides structured data for further processing.',
      },
      {
        id: 'branch',
        label: 'Branch',
        type: 'text',
        placeholder: 'feature-branch',
        description: 'Specific branch to scan (git/github only).',
        helpText: 'For PR scanning: set this to the PR/feature branch name.',
      },
      {
        id: 'sinceCommit',
        label: 'Since Commit',
        type: 'text',
        placeholder: 'main',
        description: 'Scan commits since this reference (git only).',
        helpText: 'For PR scanning: set this to the base branch (e.g., "main"). For incremental scans: use HEAD~10 or a commit hash.',
      },
      {
        id: 'includeIssueComments',
        label: 'Include Issue Comments',
        type: 'boolean',
        default: false,
        description: 'Scan GitHub issue comments (github only).',
      },
      {
        id: 'includePRComments',
        label: 'Include PR Comments',
        type: 'boolean',
        default: false,
        description: 'Scan pull request comments (github only).',
      },
      {
        id: 'customFlags',
        label: 'Custom CLI Flags',
        type: 'textarea',
        rows: 3,
        placeholder: '--fail --concurrency=8',
        description: 'Additional TruffleHog CLI flags.',
        helpText: 'Use --fail to exit with code 183 if secrets are found.',
      },
    ],
  },
  async execute(input, context) {
    context.logger.info(
      `[TruffleHog] Scanning ${input.scanType} target: ${input.scanTarget}`,
    );

    const optionsSummary = {
      scanType: input.scanType,
      onlyVerified: input.onlyVerified ?? true,
      jsonOutput: input.jsonOutput ?? true,
      branch: input.branch ?? null,
      sinceCommit: input.sinceCommit ?? null,
      hasFilesystemContent: !!input.filesystemContent,
    };

    context.emitProgress({
      message: 'Launching TruffleHog scan…',
      level: 'info',
      data: { target: input.scanTarget, options: optionsSummary },
    });

    // Handle filesystem scanning with isolated volumes
    let volume: IsolatedContainerVolume | undefined;
    let effectiveInput = input;

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new Error('TruffleHog runner must be docker');
    }

    try {
      // If filesystemContent is provided, use isolated volume
      if (input.filesystemContent && Object.keys(input.filesystemContent).length > 0) {
        if (input.scanType !== 'filesystem') {
          throw new Error('filesystemContent can only be used with scanType=filesystem');
        }

        const tenantId = (context as any).tenantId ?? 'default-tenant';
        volume = new IsolatedContainerVolume(tenantId, context.runId);

        // Initialize volume with files
        const volumeName = await volume.initialize(input.filesystemContent);
        context.logger.info(`[TruffleHog] Created isolated volume: ${volumeName}`);

        // Override scanTarget to point to mounted volume
        effectiveInput = {
          ...input,
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
        if (errorMessage.includes('exit code 183') || errorMessage.includes('exited with code 183')) {
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
      const output = typeof rawResult === 'string'
        ? parseRawOutput(rawResult)
        : (rawResult as Output);

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
            verifiedCount: output.verifiedCount
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
};

componentRegistry.register(definition);

export type { Input as TruffleHogInput, Output as TruffleHogOutput };

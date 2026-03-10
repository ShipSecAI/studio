import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ContainerError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
  generateFindingHash,
  analyticsResultSchema,
  type AnalyticsResult,
} from '@shipsec/component-sdk';
import { resolveVolumeSource } from '../../utils/isolated-volume';
import {
  createToolOutputVolume,
  readToolOutputFile,
  TOOL_OUTPUT_DIR,
} from '../../utils/tool-output';

/**
 * TruffleHog Secret Scanner Component
 *
 * Scans a cloned repository for exposed secrets and credentials.
 * Designed to work with the GitHub clone-repo component via volumeName.
 */

// Finding type for standardized output format
const findingSchema = z.object({
  type: z.string().describe('Type of finding (e.g., "AWS", "GitHub", "PrivateKey")'),
  file: z.string().describe('File path where the secret was found'),
  line: z.number().describe('Line number in the file'),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).describe('Severity level'),
  secret_type: z.string().describe('Specific type of secret detected'),
  snippet: z.string().describe('Code snippet containing the finding (redacted)'),
});

type Finding = z.infer<typeof findingSchema>;

// Input schema - receives volumeName from clone component
const inputSchema = inputs({
  volumeName: port(
    z
      .string()
      .min(1, 'Volume name is required')
      .describe('Docker volume name containing the cloned repository'),
    {
      label: 'Volume Name',
      description:
        'Docker volume name from github.repo.clone. The repository is at /repo inside the volume.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  changedFiles: port(
    z
      .array(z.string())
      .optional()
      .describe('List of changed file paths to scope the scan to (e.g. from PR context).'),
    {
      label: 'Changed Files',
      description:
        'Optional list of file paths changed in the PR. When provided, only these files are scanned instead of the entire repository.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
      allowAny: true,
      reason: 'Accepts any array of file path strings.',
    },
  ),
});

// Configuration parameters
const parameterSchema = parameters({
  onlyVerified: param(
    z.boolean().default(false).describe('Only report verified (actively valid) secrets'),
    {
      label: 'Only Verified',
      editor: 'boolean',
      description: 'Only report verified secrets that are confirmed to be active.',
      helpText:
        'When enabled, passes --results=verified. When disabled, no --results flag is passed.',
    },
  ),
  includeDetectors: param(
    z.array(z.string()).optional().describe('Specific detector types to include'),
    {
      label: 'Include Detectors',
      editor: 'multi-select',
      options: [
        { label: 'AWS', value: 'AWS' },
        { label: 'GitHub', value: 'Github' },
        { label: 'GitLab', value: 'Gitlab' },
        { label: 'Slack', value: 'Slack' },
        { label: 'Private Key', value: 'PrivateKey' },
        { label: 'Generic', value: 'GenericApiKey' },
      ],
      description: 'Only run specific detectors (leave empty for all).',
    },
  ),
  excludeDetectors: param(z.array(z.string()).optional().describe('Detector types to exclude'), {
    label: 'Exclude Detectors',
    editor: 'multi-select',
    options: [
      { label: 'AWS', value: 'AWS' },
      { label: 'GitHub', value: 'Github' },
      { label: 'GitLab', value: 'Gitlab' },
      { label: 'Slack', value: 'Slack' },
      { label: 'Private Key', value: 'PrivateKey' },
      { label: 'Generic', value: 'GenericApiKey' },
    ],
    description: 'Exclude specific detectors from the scan.',
  }),
  maxDepth: param(
    z.number().int().min(1).max(100).default(50).describe('Maximum git history depth to scan'),
    {
      label: 'Max Depth',
      editor: 'number',
      min: 1,
      max: 100,
      description: 'Maximum number of commits to scan in git history.',
    },
  ),
  concurrency: param(
    z.number().int().min(1).max(20).default(8).describe('Number of concurrent workers'),
    {
      label: 'Concurrency',
      editor: 'number',
      min: 1,
      max: 20,
      description: 'Number of parallel scanning workers.',
    },
  ),
});

// Output schema - standardized findings format
const outputSchema = outputs({
  findings: port(z.array(findingSchema), {
    label: 'Findings',
    description: 'Array of detected secrets in standardized format.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
  }),
  findingCount: port(z.number(), {
    label: 'Finding Count',
    description: 'Total number of secrets detected.',
  }),
  verifiedCount: port(z.number(), {
    label: 'Verified Count',
    description: 'Number of verified (actively valid) secrets.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw TruffleHog JSON output for debugging.',
  }),
});

type Output = z.infer<typeof outputSchema>;

// TruffleHog raw output format
interface TruffleHogSecret {
  DetectorType?: string | number;
  DetectorName?: string;
  Verified?: boolean;
  Raw?: string;
  Redacted?: string;
  SourceMetadata?: {
    Data?: {
      Git?: {
        commit?: string;
        file?: string;
        line?: number;
        email?: string;
        repository?: string;
        timestamp?: string;
      };
      Filesystem?: {
        file?: string;
        line?: number;
      };
    };
  };
}

function toDetectorLabel(secret: TruffleHogSecret): string {
  const detectorName =
    typeof secret.DetectorName === 'string' ? secret.DetectorName.trim() : undefined;
  if (detectorName && detectorName.length > 0) {
    return detectorName;
  }

  if (typeof secret.DetectorType === 'string') {
    const detectorType = secret.DetectorType.trim();
    if (detectorType.length > 0) {
      return detectorType;
    }
  }

  if (typeof secret.DetectorType === 'number') {
    return String(secret.DetectorType);
  }

  return 'Unknown';
}

// Map TruffleHog detector types to severity levels
function mapSeverity(detectorLabel: string, verified: boolean): Finding['severity'] {
  // Verified secrets are always critical
  if (verified) return 'critical';

  // High-risk secret types
  const normalized = detectorLabel.toLowerCase();
  const criticalTypes = ['aws', 'gcp', 'azure', 'privatekey', 'rsaprivatekey'];
  const highTypes = ['github', 'gitlab', 'bitbucket', 'slack', 'stripe'];
  const mediumTypes = ['genericapikey', 'genericpassword', 'jwt'];

  if (criticalTypes.some((t) => normalized.includes(t))) return 'high';
  if (highTypes.some((t) => normalized.includes(t))) return 'medium';
  if (mediumTypes.some((t) => normalized.includes(t))) return 'low';

  return 'info';
}

// Known workspace prefixes that scanners add to file paths.
const WORKSPACE_PREFIXES = ['/workspace/repo/', '/scan/repo/', '/scan/', '/workspace/', '/repo/'];

function stripWorkspacePrefix(filePath: string): string {
  for (const prefix of WORKSPACE_PREFIXES) {
    if (filePath.startsWith(prefix)) {
      return filePath.slice(prefix.length);
    }
  }
  if (filePath.startsWith('/')) {
    return filePath.slice(1);
  }
  return filePath;
}

// Convert TruffleHog output to standardized findings
function convertToFindings(secrets: TruffleHogSecret[]): Finding[] {
  return secrets.map((secret) => {
    const git = secret.SourceMetadata?.Data?.Git;
    const fs = secret.SourceMetadata?.Data?.Filesystem;
    const detectorLabel = toDetectorLabel(secret);
    const rawFile = git?.file || fs?.file || 'unknown';

    return {
      type: detectorLabel,
      file: stripWorkspacePrefix(rawFile),
      line: git?.line || fs?.line || 0,
      severity: mapSeverity(detectorLabel, secret.Verified || false),
      secret_type: detectorLabel,
      snippet: secret.Redacted || '[redacted]',
    };
  });
}

function isTruffleHogSecret(value: unknown): value is TruffleHogSecret {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    'DetectorName' in candidate ||
    'DetectorType' in candidate ||
    ('SourceMetadata' in candidate && 'Raw' in candidate)
  );
}

// Parse TruffleHog NDJSON output
function parseTruffleHogOutput(rawOutput: string): TruffleHogSecret[] {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return [];
  }

  const trimmed = rawOutput.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter(isTruffleHogSecret);
    }
    if (isTruffleHogSecret(parsed)) {
      return [parsed];
    }
  } catch {
    // Not a single JSON payload; continue with NDJSON parsing.
  }

  const lines = rawOutput.split('\n').filter((line) => line.trim().length > 0);
  const secrets: TruffleHogSecret[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (isTruffleHogSecret(parsed)) {
        secrets.push(parsed);
      }
    } catch {
      // Skip non-JSON lines (status messages, etc.)
      continue;
    }
  }

  return secrets;
}

// Retry policy for TruffleHog
const trufflehogRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'scanner.trufflehog',
  label: 'TruffleHog Secret Scanner',
  category: 'scanners',
  retryPolicy: trufflehogRetryPolicy,
  runner: {
    kind: 'docker',
    image: 'trufflesecurity/trufflehog:latest',
    // Keep JSON findings off PTY by redirecting stdout to a mounted output volume.
    entrypoint: 'sh',
    network: 'none', // No network needed for filesystem scanning
    timeoutSeconds: 600,
    command: ['-c', `trufflehog "$@" 1>${TOOL_OUTPUT_DIR}/trufflehog.ndjson`, '--'],
    env: {
      HOME: '/tmp',
    },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Scan a cloned repository for exposed secrets and credentials using TruffleHog. Works with the github.repo.clone component.',
  ui: {
    slug: 'trufflehog-scanner',
    version: '1.0.0',
    type: 'scan',
    category: 'scanners',
    description:
      'Scan repositories for exposed secrets, API keys, and credentials using TruffleHog.',
    documentation:
      'TruffleHog scans git history and files for 800+ credential types. Connect to the clone-repo component to scan GitHub repositories.',
    documentationUrl: 'https://github.com/trufflesecurity/trufflehog',
    icon: 'Key',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      'Clone a repository with github.repo.clone, then connect volumeName to this component.',
    examples: [
      'Scan a cloned repository for AWS credentials before deployment.',
      'Check for leaked API keys in PR changes.',
      'Audit repository history for accidentally committed secrets.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);
    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const outputVolume = await createToolOutputVolume(tenantId, context.runId, 'trufflehog-output');

    try {
      context.logger.info(
        `[TruffleHog Scanner] Starting scan on volume: ${parsedInputs.volumeName}`,
      );

      context.emitProgress({
        message: 'Launching TruffleHog secret scan...',
        level: 'info',
        data: { volumeName: parsedInputs.volumeName },
      });

      // Volume mounted at /scan, repo is at /scan/repo
      const args: string[] = [
        'filesystem',
        '/scan/repo',
        '--json',
        '--no-update',
        '--no-color',
        '--fail-on-scan-errors',
      ];

      // Add verification filter
      if (parsedParams.onlyVerified) {
        args.push('--results=verified');
      }

      // Add detector filters
      if (parsedParams.includeDetectors && parsedParams.includeDetectors.length > 0) {
        args.push('--include-detectors', parsedParams.includeDetectors.join(','));
      }
      if (parsedParams.excludeDetectors && parsedParams.excludeDetectors.length > 0) {
        args.push('--exclude-detectors', parsedParams.excludeDetectors.join(','));
      }

      // Add concurrency
      args.push('--concurrency', parsedParams.concurrency.toString());

      // Exclude .git/config — platform-injected clone tokens in this file are false positives
      args.push('--exclude-paths', '/tmp/exclude-paths.txt');

      // Scope scan to changed files only (if provided)
      // TruffleHog expects --include-paths pointing to a file with newline-separated regexes.
      // We write the file to /tmp inside the container via the shell command.
      const hasChangedFiles = parsedInputs.changedFiles && parsedInputs.changedFiles.length > 0;
      if (hasChangedFiles) {
        args.push('--include-paths', '/tmp/include-paths.txt');
        context.logger.info(
          `[TruffleHog Scanner] Scoping to ${parsedInputs.changedFiles!.length} changed files`,
        );
      }

      context.logger.info(`[TruffleHog Scanner] Command: trufflehog ${args.join(' ')}`);

      const baseRunner = definition.runner;
      if (baseRunner.kind !== 'docker') {
        throw new ContainerError('TruffleHog runner must be docker', {
          details: { reason: 'runner_type_mismatch', expected: 'docker', actual: baseRunner.kind },
        });
      }

      // Build shell command — always write exclude-paths file, optionally write include-paths
      const writeExclude = `printf '%s\\n' '(^|/)\\.git/config$' > /tmp/exclude-paths.txt`;
      let shellScript: string;
      if (hasChangedFiles) {
        const escapedPaths = parsedInputs.changedFiles!.map((f) => f.replace(/'/g, "'\\''"));
        const writeLines = escapedPaths.map((f) => `echo '${f}'`).join(' && ');
        shellScript = `${writeExclude} && (${writeLines}) > /tmp/include-paths.txt && trufflehog "$@" 1>${TOOL_OUTPUT_DIR}/trufflehog.ndjson`;
      } else {
        shellScript = `${writeExclude} && trufflehog "$@" 1>${TOOL_OUTPUT_DIR}/trufflehog.ndjson`;
      }

      // Configure runner with volume mount
      const runnerConfig: DockerRunnerConfig = {
        ...baseRunner,
        command: ['-c', shellScript, '--', ...args],
        volumes: [
          {
            source: resolveVolumeSource(parsedInputs.volumeName),
            target: '/scan',
            readOnly: true,
          },
          outputVolume.getVolumeConfig(TOOL_OUTPUT_DIR, false),
        ],
        // Output managed by component, not /shipsec-output/result.json
        expectOutputFile: false,
      };

      // Execute TruffleHog
      await runComponentWithRunner(
        runnerConfig,
        async () => ({}) as Output,
        { ...parsedInputs, ...parsedParams },
        context,
      );

      const rawOutput = await readToolOutputFile(outputVolume, 'trufflehog.ndjson', 'TruffleHog');
      const secrets = parseTruffleHogOutput(rawOutput);
      const findings = convertToFindings(secrets);
      const verifiedCount = secrets.filter((s) => s.Verified === true).length;

      context.logger.info(
        `[TruffleHog Scanner] Found ${findings.length} secrets (${verifiedCount} verified)`,
      );

      // Emit progress with results summary
      if (verifiedCount > 0) {
        context.emitProgress({
          message: `⚠️ Found ${verifiedCount} verified secrets!`,
          level: 'warn',
          data: { findingCount: findings.length, verifiedCount },
        });
      } else if (findings.length > 0) {
        context.emitProgress({
          message: `Found ${findings.length} potential secrets`,
          level: 'info',
          data: { findingCount: findings.length },
        });
      } else {
        context.emitProgress({
          message: 'No secrets detected',
          level: 'info',
        });
      }

      // Build analytics-ready results
      const results: AnalyticsResult[] = findings.map((finding) => ({
        ...finding,
        scanner: 'trufflehog',
        title: `${finding.secret_type} secret`,
        asset_key: finding.file,
        finding_hash: generateFindingHash(
          'trufflehog',
          finding.type,
          finding.file,
          String(finding.line),
          finding.secret_type,
        ),
      }));

      const output: Output = {
        findings,
        results,
        findingCount: findings.length,
        verifiedCount,
        rawOutput,
      };

      return outputSchema.parse(output);
    } finally {
      await outputVolume.cleanup().catch((error) => {
        context.logger.warn(
          `[TruffleHog Scanner] Failed to cleanup output volume: ${String(error)}`,
        );
      });
    }
  },
});

componentRegistry.register(definition);

// Export types for external use
export type TruffleHogScannerInput = typeof inputSchema;
export type TruffleHogScannerOutput = typeof outputSchema;

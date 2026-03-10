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
 * OpenGrep SAST Scanner Component
 *
 * Performs static application security testing (SAST) on a cloned repository.
 * Designed to work with the GitHub clone-repo component via volumeName.
 */

// Finding type for standardized output format
const findingSchema = z.object({
  rule_id: z.string().describe('OpenGrep rule ID that triggered the finding'),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).describe('Severity level'),
  file: z.string().describe('File path where the issue was found'),
  line: z.number().describe('Line number in the file'),
  message: z.string().describe('Description of the security issue'),
  snippet: z.string().describe('Code snippet containing the finding'),
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
  ruleset: param(
    z
      .enum(['auto', 'p/default', 'p/security-audit', 'p/owasp-top-ten', 'p/cwe-top-25'])
      .default('auto')
      .describe('OpenGrep ruleset to use'),
    {
      label: 'Ruleset',
      editor: 'select',
      options: [
        { label: 'Auto-detect + Security', value: 'auto' },
        { label: 'Default Rules', value: 'p/default' },
        { label: 'Security Audit', value: 'p/security-audit' },
        { label: 'OWASP Top 10', value: 'p/owasp-top-ten' },
        { label: 'CWE Top 25', value: 'p/cwe-top-25' },
      ],
      description: 'OpenGrep ruleset to apply. Auto will detect language and apply security rules.',
    },
  ),
  severityFilter: param(
    z
      .array(z.enum(['ERROR', 'WARNING', 'INFO']))
      .optional()
      .describe('Filter results by severity'),
    {
      label: 'Severity Filter',
      editor: 'multi-select',
      options: [
        { label: 'Error (High/Critical)', value: 'ERROR' },
        { label: 'Warning (Medium)', value: 'WARNING' },
        { label: 'Info (Low)', value: 'INFO' },
      ],
      description: 'Only show findings at these severity levels.',
    },
  ),
  excludePaths: param(z.array(z.string()).optional().describe('Paths to exclude from scanning'), {
    label: 'Exclude Paths',
    editor: 'tags',
    placeholder: 'node_modules, vendor, .git',
    description: 'Glob patterns for paths to exclude from scanning.',
  }),
  timeout: param(
    z.number().int().min(60).max(1800).default(300).describe('Scan timeout in seconds'),
    {
      label: 'Timeout (seconds)',
      editor: 'number',
      min: 60,
      max: 1800,
      description: 'Maximum time for the scan to complete.',
    },
  ),
  jobs: param(z.number().int().min(1).max(16).default(4).describe('Number of parallel jobs'), {
    label: 'Parallel Jobs',
    editor: 'number',
    min: 1,
    max: 16,
    description: 'Number of parallel scanning jobs.',
  }),
});

// Output schema - standardized findings format
const outputSchema = outputs({
  findings: port(z.array(findingSchema), {
    label: 'Findings',
    description: 'Array of detected security issues in standardized format.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
  }),
  findingCount: port(z.number(), {
    label: 'Finding Count',
    description: 'Total number of issues detected.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw OpenGrep JSON output for debugging.',
  }),
});

type Output = z.infer<typeof outputSchema>;

// OpenGrep raw output format (compatible with Semgrep JSON schema)
interface OpenGrepResult {
  check_id: string;
  path: string;
  start: {
    line: number;
    col: number;
  };
  end: {
    line: number;
    col: number;
  };
  extra: {
    message: string;
    severity: string;
    lines?: string;
    metadata?: {
      cwe?: string[];
      owasp?: string[];
      category?: string;
    };
  };
}

interface OpenGrepOutput {
  results?: OpenGrepResult[];
  errors?: {
    message: string;
    level: string;
  }[];
}

// Map OpenGrep severity to standardized severity
function mapSeverity(ogSeverity: string): Finding['severity'] {
  switch (ogSeverity.toUpperCase()) {
    case 'ERROR':
      return 'high';
    case 'WARNING':
      return 'medium';
    case 'INFO':
      return 'low';
    default:
      return 'info';
  }
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

// Convert OpenGrep output to standardized findings
function convertToFindings(results: OpenGrepResult[]): Finding[] {
  return results.map((result) => ({
    rule_id: result.check_id,
    severity: mapSeverity(result.extra.severity),
    file: stripWorkspacePrefix(result.path),
    line: result.start.line,
    message: result.extra.message,
    snippet: result.extra.lines || '',
  }));
}

// Parse OpenGrep JSON output
function parseOpenGrepOutput(rawOutput: string): OpenGrepOutput {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return { results: [] };
  }

  try {
    return JSON.parse(rawOutput);
  } catch {
    // Try to find JSON in the output (OpenGrep may output non-JSON messages first)
    const jsonMatch = rawOutput.match(/\{[\s\S]*"results"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return { results: [] };
      }
    }
    return { results: [] };
  }
}

// Retry policy for OpenGrep
const opengrepRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 10,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'scanner.opengrep',
  label: 'OpenGrep SAST Scanner',
  category: 'scanners',
  retryPolicy: opengrepRetryPolicy,
  runner: {
    kind: 'docker',
    image: 'realgam3/opengrep:latest',
    entrypoint: 'opengrep',
    network: 'bridge', // May need network for ruleset downloads
    timeoutSeconds: 600,
    command: [],
    env: {
      HOME: '/tmp',
      SEMGREP_SEND_METRICS: 'off',
    },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Perform static application security testing (SAST) on a cloned repository using OpenGrep. Works with the github.repo.clone component.',
  ui: {
    slug: 'opengrep-scanner',
    version: '1.0.0',
    type: 'scan',
    category: 'scanners',
    description:
      'Static code analysis for security vulnerabilities using OpenGrep with 2000+ community rules.',
    documentation:
      'OpenGrep is a fast, open-source static analysis tool (Semgrep community fork) that finds security bugs, code quality issues, and enforces coding standards. Auto-detects languages and applies security rulesets.',
    documentationUrl: 'https://github.com/opengrep/opengrep',
    icon: 'Shield',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      'Clone a repository with github.repo.clone, then connect volumeName to this component for SAST scanning.',
    examples: [
      'Scan for SQL injection vulnerabilities in a web application.',
      'Check for insecure deserialization in Python code.',
      'Detect hardcoded credentials and secrets.',
      'Enforce secure coding standards across the codebase.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);
    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const outputVolume = await createToolOutputVolume(tenantId, context.runId, 'opengrep-output');

    try {
      context.logger.info(
        `[OpenGrep Scanner] Starting SAST scan on volume: ${parsedInputs.volumeName}`,
      );

      context.emitProgress({
        message: 'Launching OpenGrep SAST scan...',
        level: 'info',
        data: { volumeName: parsedInputs.volumeName, ruleset: parsedParams.ruleset },
      });

      // Build OpenGrep command arguments
      const args: string[] = [
        'scan',
        '--json',
        '--json-output',
        `${TOOL_OUTPUT_DIR}/opengrep.json`,
        '--no-git-ignore',
        '--metrics=off',
      ];

      // Add ruleset configuration
      // Note: --config auto requires metrics enabled.
      // To avoid sending telemetry, we use explicit rulesets that provide equivalent coverage.
      if (parsedParams.ruleset === 'auto') {
        args.push('--config', 'p/default');
        args.push('--config', 'p/security-audit');
      } else {
        args.push('--config', parsedParams.ruleset);
      }

      // Add severity filter
      if (parsedParams.severityFilter && parsedParams.severityFilter.length > 0) {
        for (const sev of parsedParams.severityFilter) {
          args.push('--severity', sev);
        }
      }

      // Add exclude paths
      if (parsedParams.excludePaths && parsedParams.excludePaths.length > 0) {
        for (const excludePath of parsedParams.excludePaths) {
          args.push('--exclude', excludePath);
        }
      }

      // Add timeout and jobs
      args.push('--timeout', parsedParams.timeout.toString());
      args.push('--jobs', parsedParams.jobs.toString());

      // Scope scan to changed files only (if provided)
      if (parsedInputs.changedFiles && parsedInputs.changedFiles.length > 0) {
        for (const file of parsedInputs.changedFiles) {
          args.push('--include', file);
        }
        context.logger.info(
          `[OpenGrep Scanner] Scoping to ${parsedInputs.changedFiles.length} changed files`,
        );
      }

      // Scan target: volume is mounted at /workspace, repo is at /repo inside the volume
      args.push('/workspace/repo');

      context.logger.info(`[OpenGrep Scanner] Command: opengrep ${args.join(' ')}`);

      const baseRunner = definition.runner;
      if (baseRunner.kind !== 'docker') {
        throw new ContainerError('OpenGrep runner must be docker', {
          details: { reason: 'runner_type_mismatch', expected: 'docker', actual: baseRunner.kind },
        });
      }

      // Use the volume name passed from clone-repo's output
      const volumeName = parsedInputs.volumeName;

      context.logger.info(`[OpenGrep Scanner] Mounting volume: ${volumeName}`);

      // Configure runner with volume mount
      // Mount the clone-repo volume at /workspace; repo files are at /workspace/repo
      const runnerConfig: DockerRunnerConfig = {
        ...baseRunner,
        command: args,
        timeoutSeconds: parsedParams.timeout + 60,
        volumes: [
          {
            source: resolveVolumeSource(volumeName),
            target: '/workspace',
            readOnly: true,
          },
          outputVolume.getVolumeConfig(TOOL_OUTPUT_DIR, false),
        ],
        // Output managed by component, not /shipsec-output/result.json
        expectOutputFile: false,
      };

      // Execute OpenGrep
      await runComponentWithRunner(
        runnerConfig,
        async () => ({}) as Output,
        { ...parsedInputs, ...parsedParams },
        context,
      );

      const rawOutput = await readToolOutputFile(outputVolume, 'opengrep.json', 'OpenGrep');
      const opengrepOutput = parseOpenGrepOutput(rawOutput);

      const findings = convertToFindings(opengrepOutput.results || []);

      // Log any errors from OpenGrep
      if (opengrepOutput.errors && opengrepOutput.errors.length > 0) {
        for (const error of opengrepOutput.errors) {
          context.logger.warn(`[OpenGrep Scanner] ${error.level}: ${error.message}`);
        }
      }

      context.logger.info(`[OpenGrep Scanner] Found ${findings.length} security issues`);

      // Count by severity
      const severityCounts = findings.reduce(
        (acc, f) => {
          acc[f.severity] = (acc[f.severity] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      // Emit progress with results summary
      if (findings.length > 0) {
        const criticalHigh = (severityCounts.critical || 0) + (severityCounts.high || 0);
        context.emitProgress({
          message:
            criticalHigh > 0
              ? `⚠️ Found ${criticalHigh} critical/high severity issues`
              : `Found ${findings.length} security issues`,
          level: criticalHigh > 0 ? 'warn' : 'info',
          data: { findingCount: findings.length, severityCounts },
        });
      } else {
        context.emitProgress({
          message: 'No security issues detected',
          level: 'info',
        });
      }

      // Build analytics-ready results
      const results: AnalyticsResult[] = findings.map((finding) => ({
        ...finding,
        scanner: 'opengrep',
        title: finding.rule_id,
        asset_key: finding.file,
        finding_hash: generateFindingHash(
          'opengrep',
          finding.rule_id,
          finding.file,
          String(finding.line),
        ),
      }));

      const output: Output = {
        findings,
        results,
        findingCount: findings.length,
        rawOutput,
      };

      return outputSchema.parse(output);
    } finally {
      await outputVolume.cleanup().catch((error) => {
        context.logger.warn(`[OpenGrep Scanner] Failed to cleanup output volume: ${String(error)}`);
      });
    }
  },
});

componentRegistry.register(definition);

// Export types for external use
export type OpenGrepScannerInput = typeof inputSchema;
export type OpenGrepScannerOutput = typeof outputSchema;

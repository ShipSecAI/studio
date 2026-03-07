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
 * Dependency Scanner Component (using safedep/vet)
 *
 * Scans dependencies for known vulnerabilities using safedep/vet.
 * Auto-detects package managers from lockfiles.
 */

// Finding type for standardized output format
const findingSchema = z.object({
  package: z.string().describe('Package name'),
  version: z.string().describe('Installed version'),
  vulnerability_id: z.string().describe('CVE or vulnerability ID'),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).describe('Severity level'),
  fixed_version: z.string().nullable().describe('Version that fixes the vulnerability'),
  description: z.string().describe('Description of the vulnerability'),
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
});

// Configuration parameters
const parameterSchema = parameters({
  failOnVuln: param(
    z.boolean().default(false).describe('Fail the scan if vulnerabilities are found'),
    {
      label: 'Fail on Vulnerabilities',
      editor: 'boolean',
      description: 'Exit with error code if vulnerabilities are detected.',
    },
  ),
  severityThreshold: param(
    z
      .enum(['critical', 'high', 'medium', 'low'])
      .default('high')
      .describe('Minimum severity to report'),
    {
      label: 'Severity Threshold',
      editor: 'select',
      options: [
        { label: 'Critical only', value: 'critical' },
        { label: 'High and above', value: 'high' },
        { label: 'Medium and above', value: 'medium' },
        { label: 'All vulnerabilities', value: 'low' },
      ],
      description: 'Only report vulnerabilities at or above this severity.',
    },
  ),
  ecosystems: param(
    z
      .array(z.enum(['npm', 'pypi', 'cargo', 'go', 'maven', 'nuget', 'rubygems']))
      .optional()
      .describe('Ecosystems to scan'),
    {
      label: 'Ecosystems',
      editor: 'multi-select',
      options: [
        { label: 'npm (JavaScript/TypeScript)', value: 'npm' },
        { label: 'PyPI (Python)', value: 'pypi' },
        { label: 'Cargo (Rust)', value: 'cargo' },
        { label: 'Go modules', value: 'go' },
        { label: 'Maven (Java)', value: 'maven' },
        { label: 'NuGet (.NET)', value: 'nuget' },
        { label: 'RubyGems (Ruby)', value: 'rubygems' },
      ],
      description: 'Limit scan to specific ecosystems. Leave empty to auto-detect.',
    },
  ),
});

// Output schema - standardized findings format
const outputSchema = outputs({
  findings: port(z.array(findingSchema), {
    label: 'Findings',
    description: 'Array of vulnerable dependencies in standardized format.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  results: port(z.array(analyticsResultSchema()), {
    label: 'Results',
    description:
      'Analytics-ready findings with scanner, finding_hash, and severity. Connect to Analytics Sink.',
  }),
  findingCount: port(z.number(), {
    label: 'Finding Count',
    description: 'Total number of vulnerable dependencies.',
  }),
  packageCount: port(z.number(), {
    label: 'Package Count',
    description: 'Total number of packages scanned.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw vet JSON output for debugging.',
  }),
});

type Output = z.infer<typeof outputSchema>;

// safedep/vet output format
interface VetVulnerability {
  id: string;
  package: string;
  version: string;
  severity: string;
  title: string;
  description: string;
  fixed_version?: string;
  reference?: string;
}

interface VetOutput {
  packages?: number | VetPackage[];
  vulnerabilities?: VetVulnerability[];
  summary?: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

interface VetPackage {
  package?: {
    ecosystem?: string;
    name?: string;
    version?: string;
  };
}

// Map vet severity to standardized severity
function mapSeverity(vetSeverity: string): Finding['severity'] {
  switch (vetSeverity.toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'moderate':
    case 'medium':
      return 'medium';
    case 'low':
      return 'low';
    default:
      return 'info';
  }
}

// Convert vet output to standardized findings
function convertToFindings(vulnerabilities: VetVulnerability[]): Finding[] {
  return vulnerabilities.map((vuln) => ({
    package: vuln.package,
    version: vuln.version,
    vulnerability_id: vuln.id,
    severity: mapSeverity(vuln.severity),
    fixed_version: vuln.fixed_version || null,
    description: vuln.description || vuln.title,
  }));
}

// Parse vet JSON output
function parseVetOutput(rawOutput: string): VetOutput {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return { packages: 0, vulnerabilities: [] };
  }

  // vet outputs JSON lines, try to parse the last valid JSON object
  const lines = rawOutput.split('\n').filter((line) => line.trim().length > 0);

  // Try to find a complete JSON output
  for (const line of lines.reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && (parsed.packages !== undefined || parsed.vulnerabilities !== undefined)) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  // Try to parse as single JSON blob
  try {
    return JSON.parse(rawOutput);
  } catch {
    return { packages: 0, vulnerabilities: [] };
  }
}

function getPackageCount(vetOutput: VetOutput): number {
  if (typeof vetOutput.packages === 'number') {
    return vetOutput.packages;
  }
  if (Array.isArray(vetOutput.packages)) {
    return vetOutput.packages.length;
  }
  return 0;
}

// Retry policy for vet
const dependencyRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'scanner.dependency',
  label: 'Dependency Scanner',
  category: 'scanners',
  retryPolicy: dependencyRetryPolicy,
  runner: {
    kind: 'docker',
    image: 'ghcr.io/safedep/vet:latest',
    entrypoint: 'vet',
    network: 'bridge', // Needs network for vulnerability database lookups
    timeoutSeconds: 300,
    command: [],
    env: {
      HOME: '/tmp',
    },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Scan dependencies for known vulnerabilities using safedep/vet. Auto-detects package managers (npm, pip, cargo, go, maven) from lockfiles.',
  ui: {
    slug: 'dependency-scanner',
    version: '1.0.0',
    type: 'scan',
    category: 'scanners',
    description:
      'Scan project dependencies for known vulnerabilities using the safedep/vet security scanner.',
    documentation:
      'vet scans your project dependencies against vulnerability databases to find known CVEs. Supports npm, pip, cargo, go, maven, nuget, and rubygems.',
    documentationUrl: 'https://github.com/safedep/vet',
    icon: 'Package',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      'Clone a repository with github.repo.clone, then connect volumeName to this component for dependency scanning.',
    examples: [
      'Scan npm packages in package-lock.json for known CVEs.',
      'Check Python dependencies in requirements.txt for vulnerabilities.',
      'Audit Cargo.lock for vulnerable Rust crates.',
      'Identify vulnerable Go modules in go.sum.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);
    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const outputVolume = await createToolOutputVolume(tenantId, context.runId, 'dependency-output');

    try {
      context.logger.info(
        `[Dependency Scanner] Starting scan on volume: ${parsedInputs.volumeName}`,
      );

      context.emitProgress({
        message: 'Launching dependency vulnerability scan...',
        level: 'info',
        data: { volumeName: parsedInputs.volumeName },
      });

      const args: string[] = [
        'scan',
        '-D',
        '/scan',
        '--report-json',
        `${TOOL_OUTPUT_DIR}/vet-report.json`,
        '--report-console',
        '--report-summary',
        '--no-banner',
      ];

      // Add severity threshold
      if (parsedParams.severityThreshold) {
        args.push('--filter-severity', parsedParams.severityThreshold);
      }

      // Add fail on vuln flag
      if (parsedParams.failOnVuln) {
        args.push('--fail-on-vuln');
      }

      context.logger.info(`[Dependency Scanner] Command: vet ${args.join(' ')}`);

      const baseRunner = definition.runner;
      if (baseRunner.kind !== 'docker') {
        throw new ContainerError('Dependency scanner runner must be docker', {
          details: { reason: 'runner_type_mismatch', expected: 'docker', actual: baseRunner.kind },
        });
      }

      // Configure runner with volume mount
      const runnerConfig: DockerRunnerConfig = {
        ...baseRunner,
        command: args,
        volumes: [
          {
            source: resolveVolumeSource(parsedInputs.volumeName),
            target: '/scan',
            readOnly: true,
          },
          outputVolume.getVolumeConfig(TOOL_OUTPUT_DIR, false),
        ],
      };

      // Execute vet
      try {
        await runComponentWithRunner(
          runnerConfig,
          async () => ({}) as Output,
          { ...parsedInputs, ...parsedParams },
          context,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        context.logger.warn(`[Dependency Scanner] vet exited with error: ${errorMessage}`);
      }

      const rawOutput = await readToolOutputFile(outputVolume, 'vet-report.json', 'vet');
      const vetOutput = parseVetOutput(rawOutput);
      const findings = convertToFindings(vetOutput.vulnerabilities || []);

      context.logger.info(
        `[Dependency Scanner] Found ${findings.length} vulnerable dependencies in ${getPackageCount(vetOutput)} packages`,
      );

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
              ? `⚠️ Found ${criticalHigh} critical/high severity vulnerabilities`
              : `Found ${findings.length} vulnerable dependencies`,
          level: criticalHigh > 0 ? 'warn' : 'info',
          data: { findingCount: findings.length, severityCounts },
        });
      } else {
        context.emitProgress({
          message: 'No vulnerable dependencies detected',
          level: 'info',
        });
      }

      // Build analytics-ready results
      const results: AnalyticsResult[] = findings.map((finding) => ({
        ...finding,
        scanner: 'dependency',
        title: `${finding.vulnerability_id} in ${finding.package}`,
        asset_key: `${finding.package}@${finding.version}`,
        finding_hash: generateFindingHash(
          'dependency',
          finding.package,
          finding.version,
          finding.vulnerability_id,
        ),
      }));

      const output: Output = {
        findings,
        results,
        findingCount: findings.length,
        packageCount: getPackageCount(vetOutput),
        rawOutput,
      };

      return outputSchema.parse(output);
    } finally {
      await outputVolume.cleanup().catch((error) => {
        context.logger.warn(
          `[Dependency Scanner] Failed to cleanup output volume: ${String(error)}`,
        );
      });
    }
  },
});

componentRegistry.register(definition);

// Export types for external use
export type DependencyScannerInput = typeof inputSchema;
export type DependencyScannerOutput = typeof outputSchema;

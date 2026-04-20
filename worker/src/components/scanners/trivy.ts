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
} from '@shipsec/component-sdk';

/**
 * Trivy Scanner Component
 *
 * Scans container images, filesystems, and IaC for vulnerabilities.
 * Designed to work with the GitHub clone-repo component via volumeName.
 */

// Finding type for standardized output format
const findingSchema = z.object({
  type: z.string().describe('Type of finding (vulnerability, misconfiguration, secret)'),
  target: z.string().describe('Target file or package'),
  vulnerability_id: z.string().describe('CVE or misconfiguration ID'),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).describe('Severity level'),
  description: z.string().describe('Description of the finding'),
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
  scanType: param(
    z
      .enum(['filesystem', 'config', 'image'])
      .default('filesystem')
      .describe('Type of scan to perform'),
    {
      label: 'Scan Type',
      editor: 'select',
      options: [
        { label: 'Filesystem (vulnerabilities in code/deps)', value: 'filesystem' },
        { label: 'Config (IaC misconfigurations)', value: 'config' },
        { label: 'Image (container image vulnerabilities)', value: 'image' },
      ],
      description: 'Type of Trivy scan to perform.',
    },
  ),
  imageRef: param(
    z.string().optional().describe('Container image reference (only for image scan type)'),
    {
      label: 'Image Reference',
      editor: 'text',
      placeholder: 'nginx:latest',
      description: 'Container image to scan (only for image scan type).',
    },
  ),
  severityFilter: param(
    z
      .array(z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']))
      .optional()
      .describe('Severity levels to include'),
    {
      label: 'Severity Filter',
      editor: 'multi-select',
      options: [
        { label: 'Critical', value: 'CRITICAL' },
        { label: 'High', value: 'HIGH' },
        { label: 'Medium', value: 'MEDIUM' },
        { label: 'Low', value: 'LOW' },
        { label: 'Unknown', value: 'UNKNOWN' },
      ],
      description: 'Only include findings at these severity levels.',
    },
  ),
  scanners: param(
    z
      .array(z.enum(['vuln', 'misconfig', 'secret', 'license']))
      .optional()
      .describe('Scanners to enable'),
    {
      label: 'Scanners',
      editor: 'multi-select',
      options: [
        { label: 'Vulnerabilities', value: 'vuln' },
        { label: 'Misconfigurations', value: 'misconfig' },
        { label: 'Secrets', value: 'secret' },
        { label: 'Licenses', value: 'license' },
      ],
      description: 'Trivy scanners to enable. Leave empty for default (vuln, misconfig).',
    },
  ),
  ignoreUnfixed: param(
    z.boolean().default(false).describe('Ignore vulnerabilities without fixed versions'),
    {
      label: 'Ignore Unfixed',
      editor: 'boolean',
      description: 'Skip vulnerabilities that do not have a fix available.',
    },
  ),
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
});

// Output schema - standardized findings format
const outputSchema = outputs({
  findings: port(z.array(findingSchema), {
    label: 'Findings',
    description: 'Array of detected issues in standardized format.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  findingCount: port(z.number(), {
    label: 'Finding Count',
    description: 'Total number of issues detected.',
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw Trivy JSON output for debugging.',
  }),
});

type Output = z.infer<typeof outputSchema>;

// Trivy JSON output format
interface TrivyVulnerability {
  VulnerabilityID: string;
  PkgName: string;
  InstalledVersion: string;
  FixedVersion?: string;
  Severity: string;
  Title?: string;
  Description?: string;
}

interface TrivyMisconfiguration {
  ID: string;
  Title: string;
  Description: string;
  Severity: string;
  Resolution?: string;
}

interface TrivyResult {
  Target: string;
  Type?: string;
  Vulnerabilities?: TrivyVulnerability[];
  Misconfigurations?: TrivyMisconfiguration[];
  Secrets?: {
    RuleID: string;
    Category: string;
    Severity: string;
    Title: string;
    Match: string;
  }[];
}

interface TrivyOutput {
  Results?: TrivyResult[];
}

// Map Trivy severity to standardized severity
function mapSeverity(trivySeverity: string): Finding['severity'] {
  switch (trivySeverity.toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'high';
    case 'MEDIUM':
      return 'medium';
    case 'LOW':
      return 'low';
    default:
      return 'info';
  }
}

// Convert Trivy output to standardized findings
function convertToFindings(results: TrivyResult[]): Finding[] {
  const findings: Finding[] = [];

  for (const result of results) {
    // Process vulnerabilities
    if (result.Vulnerabilities) {
      for (const vuln of result.Vulnerabilities) {
        findings.push({
          type: 'vulnerability',
          target: `${result.Target} - ${vuln.PkgName}@${vuln.InstalledVersion}`,
          vulnerability_id: vuln.VulnerabilityID,
          severity: mapSeverity(vuln.Severity),
          description: vuln.Description || vuln.Title || vuln.VulnerabilityID,
        });
      }
    }

    // Process misconfigurations
    if (result.Misconfigurations) {
      for (const misconfig of result.Misconfigurations) {
        findings.push({
          type: 'misconfiguration',
          target: result.Target,
          vulnerability_id: misconfig.ID,
          severity: mapSeverity(misconfig.Severity),
          description: misconfig.Description || misconfig.Title,
        });
      }
    }

    // Process secrets
    if (result.Secrets) {
      for (const secret of result.Secrets) {
        findings.push({
          type: 'secret',
          target: result.Target,
          vulnerability_id: secret.RuleID,
          severity: mapSeverity(secret.Severity),
          description: secret.Title,
        });
      }
    }
  }

  return findings;
}

// Parse Trivy JSON output
function parseTrivyOutput(rawOutput: string): TrivyOutput {
  if (!rawOutput || rawOutput.trim().length === 0) {
    return { Results: [] };
  }

  try {
    return JSON.parse(rawOutput);
  } catch {
    // Try to find JSON in the output
    const jsonMatch = rawOutput.match(/\{[\s\S]*"Results"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return { Results: [] };
      }
    }
    return { Results: [] };
  }
}

// Retry policy for Trivy
const trivyRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 10,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'scanner.trivy',
  label: 'Trivy Security Scanner',
  category: 'scanners',
  retryPolicy: trivyRetryPolicy,
  runner: {
    kind: 'docker',
    image: 'aquasec/trivy:latest',
    entrypoint: 'trivy',
    network: 'bridge', // May need network for DB updates
    timeoutSeconds: 600,
    command: [],
    env: {
      HOME: '/tmp',
      TRIVY_NO_PROGRESS: 'true',
    },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Scan filesystems, container images, and IaC for vulnerabilities and misconfigurations using Trivy.',
  ui: {
    slug: 'trivy-scanner',
    version: '1.0.0',
    type: 'scan',
    category: 'scanners',
    description:
      'Comprehensive vulnerability and misconfiguration scanner for filesystems, containers, and IaC.',
    documentation:
      'Trivy is a comprehensive security scanner that detects vulnerabilities in OS packages, language packages, IaC misconfigurations, and secrets.',
    documentationUrl: 'https://github.com/aquasecurity/trivy',
    icon: 'ShieldAlert',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      'Clone a repository with github.repo.clone, then connect volumeName to this component for comprehensive security scanning.',
    examples: [
      'Scan filesystem for vulnerable packages.',
      'Check Terraform files for IaC misconfigurations.',
      'Detect hardcoded secrets in configuration files.',
      'Scan container images for vulnerabilities.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);

    context.logger.info(
      `[Trivy Scanner] Starting ${parsedParams.scanType} scan on volume: ${parsedInputs.volumeName}`,
    );

    context.emitProgress({
      message: `Launching Trivy ${parsedParams.scanType} scan...`,
      level: 'info',
      data: { volumeName: parsedInputs.volumeName, scanType: parsedParams.scanType },
    });

    // Build Trivy command arguments
    const args: string[] = [
      parsedParams.scanType === 'image' ? 'image' : parsedParams.scanType,
      '--format',
      'json',
      '--quiet',
    ];

    // Add severity filter
    if (parsedParams.severityFilter && parsedParams.severityFilter.length > 0) {
      args.push('--severity', parsedParams.severityFilter.join(','));
    }

    // Add scanners configuration
    if (parsedParams.scanners && parsedParams.scanners.length > 0) {
      args.push('--scanners', parsedParams.scanners.join(','));
    }

    // Add ignore unfixed flag
    if (parsedParams.ignoreUnfixed) {
      args.push('--ignore-unfixed');
    }

    // Add timeout
    args.push('--timeout', `${parsedParams.timeout}s`);

    // Add target based on scan type
    if (parsedParams.scanType === 'image') {
      if (!parsedParams.imageRef) {
        throw new ContainerError('Image reference is required for image scan type', {
          details: { scanType: parsedParams.scanType },
        });
      }
      args.push(parsedParams.imageRef);
    } else {
      args.push('/scan');
    }

    context.logger.info(`[Trivy Scanner] Command: trivy ${args.join(' ')}`);

    const baseRunner = definition.runner;
    if (baseRunner.kind !== 'docker') {
      throw new ContainerError('Trivy runner must be docker', {
        details: { reason: 'runner_type_mismatch', expected: 'docker', actual: baseRunner.kind },
      });
    }

    // Configure runner with volume mount
    const volumes: { source: string; target: string; readOnly: boolean }[] = [];

    // Only mount volume for filesystem/config scans
    if (parsedParams.scanType !== 'image') {
      volumes.push({
        source: parsedInputs.volumeName,
        target: '/scan',
        readOnly: true,
      });
    }

    // For image scans, mount docker socket if available
    if (parsedParams.scanType === 'image') {
      volumes.push({
        source: '/var/run/docker.sock',
        target: '/var/run/docker.sock',
        readOnly: true,
      });
    }

    const runnerConfig: DockerRunnerConfig = {
      ...baseRunner,
      command: args,
      timeoutSeconds: parsedParams.timeout + 60, // Add buffer for startup
      volumes: volumes.length > 0 ? volumes : undefined,
    };

    // Execute Trivy
    const rawResult = await runComponentWithRunner(
      runnerConfig,
      async () => ({}) as Output,
      { ...parsedInputs, ...parsedParams },
      context,
    );

    // Parse output
    const rawOutput = typeof rawResult === 'string' ? rawResult : '';
    const trivyOutput = parseTrivyOutput(rawOutput);
    const findings = convertToFindings(trivyOutput.Results || []);

    context.logger.info(`[Trivy Scanner] Found ${findings.length} issues`);

    // Count by severity
    const severityCounts = findings.reduce(
      (acc, f) => {
        acc[f.severity] = (acc[f.severity] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    // Count by type
    const typeCounts = findings.reduce(
      (acc, f) => {
        acc[f.type] = (acc[f.type] || 0) + 1;
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
        data: { findingCount: findings.length, severityCounts, typeCounts },
      });
    } else {
      context.emitProgress({
        message: 'No security issues detected',
        level: 'info',
      });
    }

    const output: Output = {
      findings,
      findingCount: findings.length,
      rawOutput,
    };

    return outputSchema.parse(output);
  },
});

componentRegistry.register(definition);

// Export types for external use
export type TrivyScannerInput = typeof inputSchema;
export type TrivyScannerOutput = typeof outputSchema;

import { z } from 'zod';
import {
  componentRegistry,
  runComponentWithRunner,
  type DockerRunnerConfig,
  ValidationError,
  ServiceError,
  ComponentRetryPolicy,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
import * as yaml from 'js-yaml';

const inputSchema = inputs({
  targets: port(
    z
      .array(z.string().min(1, 'Target cannot be empty'))
      .min(1, 'At least one target is required')
      .describe('URLs or IPs to scan for vulnerabilities'),
    {
      label: 'Targets',
      description: 'URLs or IP addresses to scan (from subfinder, httpx, or manual input).',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
  customTemplateArchive: port(
    z
      .string()
      .optional()
      .describe('Base64-encoded zip archive containing multiple YAML templates (from File Loader)'),
    {
      label: 'Template Archive (Zip)',
      description: 'Base64-encoded zip file with multiple templates (connect File Loader output).',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  customTemplateYaml: port(
    z.string().optional().describe('Raw YAML content for a single template (for quick testing)'),
    {
      label: 'Template YAML (Single)',
      description: 'Raw YAML content for quick template testing (paste directly or connect).',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
  templateIds: port(
    z
      .array(z.string())
      .optional()
      .describe(
        'Specific template IDs to run (e.g., ["CVE-2024-1234", "http-missing-security-headers"])',
      ),
    {
      label: 'Template IDs',
      description:
        'Specific template IDs from nuclei-templates repo (e.g., CVE-2024-1234, http-missing-security-headers).',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
  templatePaths: port(
    z
      .array(z.string())
      .optional()
      .describe(
        'Specific built-in template paths to include (e.g., ["cves/2024/", "http/exposures/"])',
      ),
    {
      label: 'Template Paths',
      description: 'Specific built-in template paths to include in the scan.',
      connectionType: { kind: 'list', element: { kind: 'primitive', name: 'text' } },
    },
  ),
});

const parameterSchema = parameters({
  rateLimit: param(
    z.number().int().positive().max(1000).default(150).describe('Maximum requests per second'),
    {
      label: 'Rate Limit (req/sec)',
      editor: 'number',
      min: 1,
      max: 1000,
      description: 'Maximum requests per second to avoid overwhelming targets.',
    },
  ),
  concurrency: param(
    z
      .number()
      .int()
      .positive()
      .max(100)
      .default(25)
      .describe('Number of parallel template executions'),
    {
      label: 'Concurrency',
      editor: 'number',
      min: 1,
      max: 100,
      description: 'Number of parallel template executions.',
    },
  ),
  timeout: param(
    z.number().int().positive().max(300).default(10).describe('Timeout per request in seconds'),
    {
      label: 'Timeout (seconds)',
      editor: 'number',
      min: 1,
      max: 300,
      description: 'Timeout per HTTP request.',
    },
  ),
  retries: param(
    z.number().int().min(0).max(5).default(1).describe('Number of retries for failed requests'),
    {
      label: 'Retries',
      editor: 'number',
      min: 0,
      max: 5,
      description: 'Number of retries for failed requests.',
    },
  ),
  includeRaw: param(
    z.boolean().default(false).describe('Include raw HTTP requests and responses in output'),
    {
      label: 'Include Raw HTTP',
      editor: 'boolean',
      description: 'Include raw HTTP requests/responses in findings (increases output size).',
    },
  ),
  followRedirects: param(
    z.boolean().default(false).describe('Follow HTTP redirects during scanning'),
    {
      label: 'Follow Redirects',
      editor: 'boolean',
      description: 'Follow HTTP redirects during scanning.',
    },
  ),
  updateTemplates: param(
    z.boolean().default(false).describe('Update built-in templates before scanning'),
    {
      label: 'Update Templates',
      editor: 'boolean',
      description: 'Update built-in template library before scanning (slower, usually not needed).',
    },
  ),
  disableHttpx: param(
    z
      .boolean()
      .default(true)
      .describe('Disable automatic HTTP probing with httpx (faster scans for known URLs)'),
    {
      label: 'Disable HTTP Probing',
      editor: 'boolean',
      description: 'Skip automatic HTTP probing with httpx (faster for known valid URLs).',
    },
  ),
});

// Output schema (unchanged)
const findingSchema = z.object({
  templateId: z.string(),
  name: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  tags: z.array(z.string()),
  matchedAt: z.string(),
  extractedResults: z.array(z.string()).optional(),
  request: z.string().optional(),
  response: z.string().optional(),
  timestamp: z.string(),
  type: z.string().optional(),
  host: z.string().optional(),
  ip: z.string().optional(),
  curlCommand: z.string().optional(),
});

type Finding = z.infer<typeof findingSchema>;

const outputSchema = outputs({
  findings: port(z.array(findingSchema), {
    label: 'Vulnerability Findings',
    description: 'Array of detected vulnerabilities with severity, tags, and matched URLs.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Complete JSONL output from nuclei for downstream processing.',
  }),
  targetCount: port(z.number(), {
    label: 'Target Count',
    description: 'Number of targets scanned.',
  }),
  findingCount: port(z.number(), {
    label: 'Finding Count',
    description: 'Total number of vulnerabilities detected.',
  }),
  stats: port(
    z.object({
      templatesLoaded: z.number(),
      requestsSent: z.number(),
      duration: z.number(),
    }),
    {
      label: 'Stats',
      description: 'Aggregate scan statistics for the run.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
});

// Runner output schema
const nucleiRunnerOutputSchema = z.object({
  stdout: z.string().optional().default(''),
  stderr: z.string().optional().default(''),
  exitCode: z.number().optional().default(0),
});

const dockerTimeoutSeconds = (() => {
  const raw = process.env.NUCLEI_TIMEOUT_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return 600; // 10 minutes default
  }
  return parsed;
})();

// Retry policy for Nuclei - expensive, long-running scans
const nucleiRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2, // Only retry once for expensive vulnerability scans
  initialIntervalSeconds: 10,
  maximumIntervalSeconds: 60,
  backoffCoefficient: 1.5,
  nonRetryableErrorTypes: ['ContainerError', 'ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'shipsec.nuclei.scan',
  label: 'Nuclei Vulnerability Scanner',
  category: 'security',
  retryPolicy: nucleiRetryPolicy,
  runner: {
    kind: 'docker',
    // Using custom ShipSecAI image instead of projectdiscovery/nuclei:latest because:
    // 1. Pre-installed templates: Avoids 100MB+ download on every scan (templates cached in image)
    // 2. Distroless base: Smaller attack surface, no shell (security hardening)
    // 3. Non-root user: Runs as 'nonroot' user with minimal permissions (UID 65532)
    // 4. ARM64 support: Built for multi-architecture (amd64 + arm64) for M1/M2 Macs
    // 5. Verified -stream flag: Tested and confirmed working for PTY real-time output
    // Image source: github.com/ShipSecAI/docker-images/nuclei
    image: 'ghcr.io/shipsecai/nuclei:latest',
    entrypoint: 'nuclei',
    network: 'bridge',
    timeoutSeconds: dockerTimeoutSeconds,
    // Direct binary execution (distroless image has no shell)
    // PTY compatibility achieved via -stream flag (prevents buffering)
    command: [],
    env: {
      HOME: '/home/nonroot', // Custom image runs as nonroot user
    },
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Run ProjectDiscovery Nuclei vulnerability scanner with custom or built-in templates. Supports quick YAML testing or bulk scans with template archives.',
  ui: {
    slug: 'nuclei',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Fast vulnerability scanner using YAML-based templates. Scan for CVEs, misconfigurations, and security issues.',
    documentation:
      'Nuclei is a fast vulnerability scanner with templates for CVEs, misconfigurations, exposures, and custom security checks. Use built-in templates or upload your own.',
    documentationUrl: 'https://github.com/projectdiscovery/nuclei',
    icon: 'Shield',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    isLatest: true,
    deprecated: false,
    example:
      '`nuclei -l targets.txt -t CVE-2024-1234 -t http-missing-headers -stream` - Scan targets for specific vulnerabilities using template IDs with real-time streaming.',
    examples: [
      'Specific CVE scan: Use templateIds=["CVE-2024-1234", "CVE-2024-5678"] to scan for known vulnerabilities',
      'Custom template testing: Paste YAML directly into customTemplateYaml for rapid iteration',
      'Bulk custom scan: Upload zip archive via Entry Point → File Loader → Nuclei',
      'Comprehensive scan: Combine custom archive + built-in templates for complete coverage',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);

    context.logger.info(`[Nuclei] Starting scan for ${parsedInputs.targets.length} target(s)`);

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    let volume: IsolatedContainerVolume | null = null;

    try {
      const hasCustomArchive = !!parsedInputs.customTemplateArchive;
      const hasCustomYaml = !!parsedInputs.customTemplateYaml;
      const hasBuiltInFilters = !!(
        (parsedInputs.templateIds && parsedInputs.templateIds.length > 0) ||
        (parsedInputs.templatePaths && parsedInputs.templatePaths.length > 0)
      );

      if (!hasCustomArchive && !hasCustomYaml && !hasBuiltInFilters) {
        throw new ValidationError(
          'At least one template source is required: customTemplateArchive, customTemplateYaml, templateIds, or templatePaths',
        );
      }

      // ===== TypeScript: Build nuclei command args =====
      const args: string[] = [
        '-duc', // Disable update check (templates pre-installed in image)
        '-jsonl', // JSONL output format (nuclei v3.6.0+)
        '-stream', // Stream mode: prevents buffering, required for PTY compatibility
        '-verbose', // Show findings in terminal (overrides silent mode)
        '-l',
        '/inputs/targets.txt', // Targets file
      ];

      // Conditionally disable httpx probing
      if (parsedParams.disableHttpx) {
        args.push('-nh');
      }

      // Scan configuration
      args.push('-rl', parsedParams.rateLimit.toString());
      args.push('-c', parsedParams.concurrency.toString());
      args.push('-timeout', parsedParams.timeout.toString());
      args.push('-retries', parsedParams.retries.toString());

      if (parsedParams.updateTemplates) {
        args.push('-update-templates');
      }

      if (parsedParams.followRedirects) {
        args.push('-follow-redirects');
      }

      // In nuclei v3.6.0+, raw HTTP is included by default
      // Use -omit-raw to exclude it when user doesn't want it
      if (!parsedParams.includeRaw) {
        args.push('-omit-raw');
      }

      // ===== TypeScript: Prepare all files for volume =====
      volume = new IsolatedContainerVolume(tenantId, context.runId);
      const files: Record<string, string | Buffer> = {};

      // Always add targets file
      files['targets.txt'] = parsedInputs.targets.join('\n');

      // ===== Handle custom templates =====
      const hasCustomTemplates =
        parsedInputs.customTemplateArchive || parsedInputs.customTemplateYaml;

      if (hasCustomTemplates) {
        // Option 1: Zip archive
        if (parsedInputs.customTemplateArchive) {
          context.logger.info('[Nuclei] Processing template archive...');
          context.emitProgress('Extracting template archive...');

          const zipBuffer = Buffer.from(parsedInputs.customTemplateArchive, 'base64');

          // Validate size (10MB max)
          const sizeMB = zipBuffer.length / (1024 * 1024);
          if (sizeMB > 10) {
            throw new ValidationError(
              `Template archive too large: ${sizeMB.toFixed(2)}MB (max 10MB)`,
              { details: { sizeMB, maxSizeMB: 10 } },
            );
          }

          // Extract zip
          const extractedFiles = await extractAndValidateZip(zipBuffer, context);
          Object.assign(files, extractedFiles);

          context.logger.info(
            `[Nuclei] Extracted ${Object.keys(extractedFiles).length} template files`,
          );
        }

        // Option 2: Single YAML
        if (parsedInputs.customTemplateYaml) {
          context.logger.info('[Nuclei] Processing single YAML template...');
          context.emitProgress('Validating YAML template...');

          // Validate YAML
          validateNucleiTemplate(parsedInputs.customTemplateYaml);

          files['custom-template.yaml'] = parsedInputs.customTemplateYaml;
          args.push('-t', '/inputs/custom-template.yaml');
          context.logger.info('[Nuclei] Single template validated successfully');
        }

        // Add custom templates directory to scan (for archive extractions)
        if (parsedInputs.customTemplateArchive) {
          args.push('-t', '/inputs/');
        }
      }

      // ===== Built-in template filters =====
      // ✅ OPTIMIZATION: Write template IDs to file instead of 500+ -id flags
      if (parsedInputs.templateIds && parsedInputs.templateIds.length > 0) {
        files['template-ids.txt'] = parsedInputs.templateIds.join('\n');
        args.push('-id', '/inputs/template-ids.txt');
        context.logger.info(
          `[Nuclei] Using ${parsedInputs.templateIds.length} template IDs from file`,
        );
      }

      // Initialize volume with all files (targets + templates + template IDs)
      await volume.initialize(files);
      context.logger.info(
        `[Nuclei] Created isolated volume: ${volume.getVolumeName()} (${Object.keys(files).length} files)`,
      );

      if (parsedInputs.templatePaths) {
        parsedInputs.templatePaths.forEach((path) => {
          args.push('-t', path);
        });
      }

      // Log scan configuration
      const templateSources: string[] = [];
      if (parsedInputs.customTemplateArchive) templateSources.push('archive');
      if (parsedInputs.customTemplateYaml) templateSources.push('yaml');
      if (parsedInputs.templateIds)
        templateSources.push(`ids:${parsedInputs.templateIds.join(',')}`);
      if (parsedInputs.templatePaths)
        templateSources.push(`paths:${parsedInputs.templatePaths.join(',')}`);

      context.logger.info(
        `[Nuclei] Template sources: ${templateSources.join(', ') || 'built-in (all)'}`,
      );
      context.logger.info(
        `[Nuclei] Config: rate=${parsedParams.rateLimit}/s, concurrency=${parsedParams.concurrency}, timeout=${parsedParams.timeout}s, stream=enabled`,
      );

      context.emitProgress({
        message: 'Launching nuclei scan...',
        level: 'info',
        data: {
          targets: parsedInputs.targets.slice(0, 5),
          templateSources,
        },
      });

      // ===== Build runner config =====
      const baseRunner = definition.runner as DockerRunnerConfig;
      const runnerConfig: DockerRunnerConfig = {
        kind: 'docker',
        image: baseRunner.image,
        entrypoint: baseRunner.entrypoint,
        network: baseRunner.network,
        timeoutSeconds: baseRunner.timeoutSeconds,
        env: baseRunner.env,
        // ✅ Preserve shell wrapper + append TypeScript-built args
        command: [...(baseRunner.command ?? []), ...args],
        volumes: [
          volume.getVolumeConfig('/inputs', true),
          // ✅ Templates are pre-installed in ghcr.io/shipsecai/nuclei:latest
          // No need for persistent volume since templates are baked into the image
        ],
      };

      // ===== Execute nuclei =====
      const rawRunnerResult = await runComponentWithRunner(
        runnerConfig,
        async () => ({}) as Output,
        { ...parsedInputs, ...parsedParams },
        context,
      );

      // ===== TypeScript: Parse output =====
      const parsedRunnerResult = nucleiRunnerOutputSchema.safeParse(rawRunnerResult);

      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      if (parsedRunnerResult.success) {
        stdout = parsedRunnerResult.data.stdout ?? '';
        stderr = parsedRunnerResult.data.stderr ?? '';
        exitCode = parsedRunnerResult.data.exitCode ?? 0;

        // Nuclei exits with 0 even when findings exist
        if (exitCode !== 0 && !stderr.includes('No results found')) {
          throw new ServiceError(
            stderr ? `Nuclei scan failed: ${stderr}` : `Nuclei exited with code ${exitCode}`,
            { details: { exitCode, stderr: stderr?.slice(0, 500) } },
          );
        }
      } else if (typeof rawRunnerResult === 'string') {
        stdout = rawRunnerResult;
      }

      // Parse findings (TypeScript)
      const findings = parseNucleiOutput(stdout, context);

      if (stderr && !stderr.includes('No results found')) {
        context.logger.info(`[Nuclei] stderr: ${stderr}`);
      }

      // Extract stats (TypeScript)
      const stats = extractStats(stderr, stdout);

      context.logger.info(
        `[Nuclei] Scan complete: ${findings.length} finding(s) from ${parsedInputs.targets.length} target(s)`,
      );

      const output = {
        findings,
        rawOutput: stdout,
        targetCount: parsedInputs.targets.length,
        findingCount: findings.length,
        stats,
      };

      return outputSchema.parse(output);
    } finally {
      // Always cleanup volume
      if (volume) {
        await volume.cleanup();
        context.logger.info('[Nuclei] Cleaned up isolated volume');
      }
    }
  },
});

// ========== Helper Functions (TypeScript) ==========

function validateNucleiTemplate(yamlContent: string): void {
  try {
    const template = yaml.load(yamlContent) as any;

    if (!template || typeof template !== 'object') {
      throw new ValidationError('Invalid YAML: not an object', {
        details: { received: typeof template },
      });
    }

    if (!template.id || typeof template.id !== 'string') {
      throw new ValidationError('Invalid template: missing or invalid "id" field', {
        fieldErrors: { id: ['Template must have a string id field'] },
      });
    }

    if (!template.info || typeof template.info !== 'object') {
      throw new ValidationError('Invalid template: missing or invalid "info" section', {
        fieldErrors: { info: ['Template must have an info section'] },
      });
    }

    // Security checks
    const yamlLower = yamlContent.toLowerCase();
    const dangerousPatterns = [
      'exec:',
      'eval(',
      'system(',
      'shell:',
      'bash:',
      'command:',
      '`',
      '$(',
    ];

    for (const pattern of dangerousPatterns) {
      if (yamlLower.includes(pattern)) {
        throw new ValidationError(
          `Security violation: template contains potentially dangerous pattern: ${pattern}`,
          { details: { pattern, location: 'template_content' } },
        );
      }
    }

    if (template.info.severity) {
      const validSeverities = ['info', 'low', 'medium', 'high', 'critical'];
      if (!validSeverities.includes(template.info.severity.toLowerCase())) {
        throw new ValidationError(
          `Invalid severity: ${template.info.severity}. Must be one of: ${validSeverities.join(', ')}`,
          { fieldErrors: { severity: [`Must be one of: ${validSeverities.join(', ')}`] } },
        );
      }
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error; // Re-throw ValidationErrors as-is
    }
    if (error instanceof Error) {
      throw new ValidationError(`YAML validation failed: ${error.message}`, {
        cause: error,
      });
    }
    throw new ValidationError('YAML validation failed: unknown error');
  }
}

async function extractAndValidateZip(
  zipBuffer: Buffer,
  context: any,
): Promise<Record<string, Buffer>> {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(zipBuffer);
    const zipEntries = zip.getEntries();

    const files: Record<string, Buffer> = {};
    let totalSize = 0;
    const maxSingleFileSize = 1024 * 1024; // 1MB per file

    for (const entry of zipEntries) {
      if (entry.isDirectory) {
        continue;
      }

      if (!entry.entryName.endsWith('.yaml') && !entry.entryName.endsWith('.yml')) {
        context.logger.warn(`[Nuclei] Skipping non-YAML file: ${entry.entryName}`);
        continue;
      }

      if (entry.entryName.includes('..') || entry.entryName.startsWith('/')) {
        context.logger.warn(`[Nuclei] Skipping file with invalid path: ${entry.entryName}`);
        continue;
      }

      const fileData = entry.getData();
      if (fileData.length > maxSingleFileSize) {
        context.logger.warn(
          `[Nuclei] Skipping oversized file: ${entry.entryName} (${(fileData.length / 1024).toFixed(1)}KB)`,
        );
        continue;
      }

      totalSize += fileData.length;

      try {
        validateNucleiTemplate(fileData.toString('utf-8'));
        files[entry.entryName] = fileData;
      } catch (error) {
        context.logger.warn(
          `[Nuclei] Skipping invalid template ${entry.entryName}: ${error instanceof Error ? error.message : 'validation failed'}`,
        );
      }
    }

    if (Object.keys(files).length === 0) {
      throw new ValidationError('No valid YAML templates found in archive', {
        details: { archiveSizeBytes: zipBuffer.length },
      });
    }

    context.logger.info(
      `[Nuclei] Validated ${Object.keys(files).length} templates (${(totalSize / 1024).toFixed(1)}KB total)`,
    );

    return files;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error; // Re-throw ValidationErrors as-is
    }
    if (error instanceof Error) {
      throw new ServiceError(`Failed to extract zip archive: ${error.message}`, {
        cause: error,
      });
    }
    throw new ServiceError('Failed to extract zip archive');
  }
}

function parseNucleiOutput(raw: string, context: any): Finding[] {
  if (!raw || raw.trim().length === 0) {
    context.logger.info('[Nuclei Parser] No output to parse');
    return [];
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  context.logger.info(`[Nuclei Parser] Processing ${lines.length} lines`);

  const findings: Finding[] = [];
  let jsonLineCount = 0;
  let skippedStats = 0;
  let skippedNonJson = 0;

  for (const line of lines) {
    let payload: any = null;
    try {
      payload = JSON.parse(line);
      jsonLineCount++;
    } catch {
      skippedNonJson++;
      continue;
    }

    if (!payload || typeof payload !== 'object') {
      continue;
    }

    // Skip stats lines (they have "duration" and "matched" as a count)
    // Real findings have "template-id" or "template"
    if (payload.duration || (!payload['template-id'] && !payload.template)) {
      skippedStats++;
      continue;
    }

    const findingCandidate: Finding = {
      templateId: payload['template-id'] || payload['template'] || 'unknown',
      name: payload.info?.name || payload.name || 'Unknown',
      severity: (
        payload.info?.severity ||
        payload.severity ||
        'info'
      ).toLowerCase() as Finding['severity'],
      tags: Array.isArray(payload.info?.tags)
        ? payload.info.tags
        : Array.isArray(payload.tags)
          ? payload.tags
          : [],
      matchedAt: payload['matched-at'] || payload.matched || payload.url || payload.host || '',
      extractedResults: Array.isArray(payload['extracted-results'])
        ? payload['extracted-results']
        : undefined,
      request: payload.request,
      response: payload.response,
      timestamp: payload.timestamp || new Date().toISOString(),
      type: payload.type,
      host: payload.host,
      ip: payload.ip,
      curlCommand: payload['curl-command'] || payload.curl,
    };

    const parsedFinding = findingSchema.safeParse(findingCandidate);
    if (parsedFinding.success) {
      findings.push(parsedFinding.data);
    } else {
      context.logger.warn(
        `[Nuclei Parser] Failed to validate finding: ${parsedFinding.error.message}`,
      );
      context.logger.warn(
        `[Nuclei Parser] Invalid finding data: ${JSON.stringify(findingCandidate).substring(0, 200)}`,
      );
    }
  }

  context.logger.info(
    `[Nuclei Parser] Summary: ${findings.length} findings, ${jsonLineCount} JSON lines, ${skippedStats} stats skipped, ${skippedNonJson} non-JSON skipped`,
  );

  return findings;
}

function extractStats(
  stderr: string,
  _output: string,
): { templatesLoaded: number; requestsSent: number; duration: number } {
  const stats = {
    templatesLoaded: 0,
    requestsSent: 0,
    duration: 0,
  };

  const templatesMatch = stderr.match(/(\d+)\s+templates/i);
  if (templatesMatch) {
    stats.templatesLoaded = parseInt(templatesMatch[1], 10);
  }

  const requestsMatch = stderr.match(/(\d+)\s+requests/i);
  if (requestsMatch) {
    stats.requestsSent = parseInt(requestsMatch[1], 10);
  }

  const durationMatch = stderr.match(/(\d+(?:\.\d+)?)\s*s/);
  if (durationMatch) {
    stats.duration = parseFloat(durationMatch[1]);
  }

  return stats;
}

componentRegistry.register(definition);

// Create local type aliases for backward compatibility
type Input = typeof inputSchema;
type Output = typeof outputSchema;

export type { Input as NucleiInput, Output as NucleiOutput };

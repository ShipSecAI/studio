import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  runComponentWithRunner,
  type DockerRunnerConfig,
} from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';
import * as yaml from 'js-yaml';

// Input validation with custom refinement
const inputSchema = z
  .object({
    targets: z
      .array(z.string().min(1, 'Target cannot be empty'))
      .min(1, 'At least one target is required')
      .describe('URLs or IPs to scan for vulnerabilities'),

    // Custom templates - at least one required
    customTemplateArchive: z
      .string()
      .optional()
      .describe('Base64-encoded zip archive containing multiple YAML templates (from File Loader)'),
    customTemplateYaml: z
      .string()
      .optional()
      .describe('Raw YAML content for a single template (for quick testing)'),

    // Built-in template filters (optional)
    templateIds: z
      .array(z.string())
      .optional()
      .describe('Specific template IDs to run (e.g., ["CVE-2024-1234", "http-missing-security-headers"])'),
    templatePaths: z
      .array(z.string())
      .optional()
      .describe('Specific built-in template paths to include (e.g., ["cves/2024/", "http/exposures/"])'),

    // Scan configuration
    rateLimit: z
      .number()
      .int()
      .positive()
      .max(1000)
      .optional()
      .default(150)
      .describe('Maximum requests per second'),
    concurrency: z
      .number()
      .int()
      .positive()
      .max(100)
      .optional()
      .default(25)
      .describe('Number of parallel template executions'),
    timeout: z
      .number()
      .int()
      .positive()
      .max(300)
      .optional()
      .default(10)
      .describe('Timeout per request in seconds'),
    retries: z
      .number()
      .int()
      .min(0)
      .max(5)
      .optional()
      .default(1)
      .describe('Number of retries for failed requests'),

    // Advanced options
    includeRaw: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include raw HTTP requests and responses in output'),
    followRedirects: z
      .boolean()
      .optional()
      .default(false)
      .describe('Follow HTTP redirects during scanning'),
    updateTemplates: z
      .boolean()
      .optional()
      .default(false)
      .describe('Update built-in templates before scanning'),
    disableHttpx: z
      .boolean()
      .optional()
      .default(true)
      .describe('Disable automatic HTTP probing with httpx (faster scans for known URLs)'),
  })
  .refine(
    (data) => {
      // At least one template source must be provided
      const hasCustomArchive = !!data.customTemplateArchive;
      const hasCustomYaml = !!data.customTemplateYaml;
      const hasBuiltInFilters = !!(data.templateIds || data.templatePaths);

      return hasCustomArchive || hasCustomYaml || hasBuiltInFilters;
    },
    {
      message:
        'At least one template source is required: customTemplateArchive, customTemplateYaml, templateIds, or templatePaths',
    },
  );

type Input = z.infer<typeof inputSchema>;

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

const outputSchema = z.object({
  findings: z.array(findingSchema),
  rawOutput: z.string(),
  targetCount: z.number(),
  findingCount: z.number(),
  stats: z.object({
    templatesLoaded: z.number(),
    requestsSent: z.number(),
    duration: z.number(),
  }),
});

type Output = z.infer<typeof outputSchema>;

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

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.nuclei.scan',
  label: 'Nuclei Vulnerability Scanner',
  category: 'security',
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
  inputSchema,
  outputSchema,
  docs: 'Run ProjectDiscovery Nuclei vulnerability scanner with custom or built-in templates. Supports quick YAML testing or bulk scans with template archives.',
  metadata: {
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
    inputs: [
      {
        id: 'targets',
        label: 'Targets',
        dataType: port.list(port.text()),
        required: true,
        description: 'URLs or IP addresses to scan (from subfinder, httpx, or manual input).',
      },
      {
        id: 'customTemplateArchive',
        label: 'Template Archive (Zip)',
        dataType: port.text(),
        required: false,
        description: 'Base64-encoded zip file with multiple templates (connect File Loader output).',
      },
      {
        id: 'customTemplateYaml',
        label: 'Template YAML (Single)',
        dataType: port.text(),
        required: false,
        description: 'Raw YAML content for quick template testing (paste directly or connect).',
      },
      {
        id: 'templateIds',
        label: 'Template IDs',
        dataType: port.list(port.text()),
        required: false,
        description: 'Specific template IDs from nuclei-templates repo (e.g., CVE-2024-1234, http-missing-security-headers).',
      },
    ],
    outputs: [
      {
        id: 'findings',
        label: 'Vulnerability Findings',
        dataType: port.list(port.json()),
        description: 'Array of detected vulnerabilities with severity, tags, and matched URLs.',
      },
      {
        id: 'rawOutput',
        label: 'Raw Output',
        dataType: port.text(),
        description: 'Complete JSONL output from nuclei for downstream processing.',
      },
      {
        id: 'findingCount',
        label: 'Finding Count',
        dataType: port.number(),
        description: 'Total number of vulnerabilities detected.',
      },
    ],
    examples: [
      'Specific CVE scan: Use templateIds=["CVE-2024-1234", "CVE-2024-5678"] to scan for known vulnerabilities',
      'Custom template testing: Paste YAML directly into customTemplateYaml for rapid iteration',
      'Bulk custom scan: Upload zip archive via Manual Trigger → File Loader → Nuclei',
      'Comprehensive scan: Combine custom archive + built-in templates for complete coverage',
    ],
    parameters: [
      {
        id: 'rateLimit',
        label: 'Rate Limit (req/sec)',
        type: 'number',
        min: 1,
        max: 1000,
        default: 150,
        description: 'Maximum requests per second to avoid overwhelming targets.',
      },
      {
        id: 'concurrency',
        label: 'Concurrency',
        type: 'number',
        min: 1,
        max: 100,
        default: 25,
        description: 'Number of parallel template executions.',
      },
      {
        id: 'timeout',
        label: 'Timeout (seconds)',
        type: 'number',
        min: 1,
        max: 300,
        default: 10,
        description: 'Timeout per HTTP request.',
      },
      {
        id: 'retries',
        label: 'Retries',
        type: 'number',
        min: 0,
        max: 5,
        default: 1,
        description: 'Number of retries for failed requests.',
      },
      {
        id: 'includeRaw',
        label: 'Include Raw HTTP',
        type: 'boolean',
        default: false,
        description: 'Include raw HTTP requests/responses in findings (increases output size).',
      },
      {
        id: 'followRedirects',
        label: 'Follow Redirects',
        type: 'boolean',
        default: false,
        description: 'Follow HTTP redirects during scanning.',
      },
      {
        id: 'updateTemplates',
        label: 'Update Templates',
        type: 'boolean',
        default: false,
        description: 'Update built-in template library before scanning (slower, usually not needed as Docker image has latest templates).',
      },
      {
        id: 'disableHttpx',
        label: 'Disable HTTP Probing',
        type: 'boolean',
        default: true,
        description: 'Skip automatic HTTP probing with httpx (faster for known valid URLs).',
      },
    ],
  },
  async execute(rawInput, context) {
    const parsedInput = inputSchema.parse(rawInput);

    context.logger.info(
      `[Nuclei] Starting scan for ${parsedInput.targets.length} target(s)`,
    );

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    let volume: IsolatedContainerVolume | null = null;

    try {
      // ===== TypeScript: Build nuclei command args =====
      const args: string[] = [
        '-duc',            // Disable update check (templates pre-installed in image)
        '-jsonl',          // JSONL output format (nuclei v3.6.0+)
        '-stream',         // Stream mode: prevents buffering, required for PTY compatibility
        '-verbose',        // Show findings in terminal (overrides silent mode)
        '-l', '/inputs/targets.txt',  // Targets file
      ];

      // Conditionally disable httpx probing
      if (parsedInput.disableHttpx) {
        args.push('-nh');
      }

      // Scan configuration
      args.push('-rl', parsedInput.rateLimit.toString());
      args.push('-c', parsedInput.concurrency.toString());
      args.push('-timeout', parsedInput.timeout.toString());
      args.push('-retries', parsedInput.retries.toString());

      if (parsedInput.updateTemplates) {
        args.push('-update-templates');
      }

      if (parsedInput.followRedirects) {
        args.push('-follow-redirects');
      }

      // In nuclei v3.6.0+, raw HTTP is included by default
      // Use -omit-raw to exclude it when user doesn't want it
      if (!parsedInput.includeRaw) {
        args.push('-omit-raw');
      }

      // ===== TypeScript: Prepare all files for volume =====
      volume = new IsolatedContainerVolume(tenantId, context.runId);
      const files: Record<string, string | Buffer> = {};

      // Always add targets file
      files['targets.txt'] = parsedInput.targets.join('\n');

      // ===== Handle custom templates =====
      const hasCustomTemplates =
        parsedInput.customTemplateArchive || parsedInput.customTemplateYaml;

      if (hasCustomTemplates) {
        // Option 1: Zip archive
        if (parsedInput.customTemplateArchive) {
          context.logger.info('[Nuclei] Processing template archive...');
          context.emitProgress('Extracting template archive...');

          const zipBuffer = Buffer.from(parsedInput.customTemplateArchive, 'base64');

          // Validate size (10MB max)
          const sizeMB = zipBuffer.length / (1024 * 1024);
          if (sizeMB > 10) {
            throw new Error(
              `Template archive too large: ${sizeMB.toFixed(2)}MB (max 10MB)`,
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
        if (parsedInput.customTemplateYaml) {
          context.logger.info('[Nuclei] Processing single YAML template...');
          context.emitProgress('Validating YAML template...');

          // Validate YAML
          validateNucleiTemplate(parsedInput.customTemplateYaml);

          files['custom-template.yaml'] = parsedInput.customTemplateYaml;
          args.push('-t', '/inputs/custom-template.yaml');
          context.logger.info('[Nuclei] Single template validated successfully');
        }

        // Add custom templates directory to scan (for archive extractions)
        if (parsedInput.customTemplateArchive) {
          args.push('-t', '/inputs/');
        }
      }

      // ===== Built-in template filters =====
      // ✅ OPTIMIZATION: Write template IDs to file instead of 500+ -id flags
      if (parsedInput.templateIds && parsedInput.templateIds.length > 0) {
        files['template-ids.txt'] = parsedInput.templateIds.join('\n');
        args.push('-id', '/inputs/template-ids.txt');
        context.logger.info(`[Nuclei] Using ${parsedInput.templateIds.length} template IDs from file`);
      }

      // Initialize volume with all files (targets + templates + template IDs)
      await volume.initialize(files);
      context.logger.info(
        `[Nuclei] Created isolated volume: ${volume.getVolumeName()} (${Object.keys(files).length} files)`,
      );

      if (parsedInput.templatePaths) {
        parsedInput.templatePaths.forEach(path => {
          args.push('-t', path);
        });
      }

      // Log scan configuration
      const templateSources: string[] = [];
      if (parsedInput.customTemplateArchive) templateSources.push('archive');
      if (parsedInput.customTemplateYaml) templateSources.push('yaml');
      if (parsedInput.templateIds) templateSources.push(`ids:${parsedInput.templateIds.join(',')}`);
      if (parsedInput.templatePaths)
        templateSources.push(`paths:${parsedInput.templatePaths.join(',')}`);

      context.logger.info(
        `[Nuclei] Template sources: ${templateSources.join(', ') || 'built-in (all)'}`,
      );
      context.logger.info(
        `[Nuclei] Config: rate=${parsedInput.rateLimit}/s, concurrency=${parsedInput.concurrency}, timeout=${parsedInput.timeout}s, stream=enabled`,
      );

      context.emitProgress({
        message: 'Launching nuclei scan...',
        level: 'info',
        data: {
          targets: parsedInput.targets.slice(0, 5),
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
        parsedInput,
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
          throw new Error(
            stderr
              ? `Nuclei scan failed: ${stderr}`
              : `Nuclei exited with code ${exitCode}`,
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
        `[Nuclei] Scan complete: ${findings.length} finding(s) from ${parsedInput.targets.length} target(s)`,
      );

      const output: Output = {
        findings,
        rawOutput: stdout,
        targetCount: parsedInput.targets.length,
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
};

// ========== Helper Functions (TypeScript) ==========

function validateNucleiTemplate(yamlContent: string): void {
  try {
    const template = yaml.load(yamlContent) as any;

    if (!template || typeof template !== 'object') {
      throw new Error('Invalid YAML: not an object');
    }

    if (!template.id || typeof template.id !== 'string') {
      throw new Error('Invalid template: missing or invalid "id" field');
    }

    if (!template.info || typeof template.info !== 'object') {
      throw new Error('Invalid template: missing or invalid "info" section');
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
        throw new Error(
          `Security violation: template contains potentially dangerous pattern: ${pattern}`,
        );
      }
    }

    if (template.info.severity) {
      const validSeverities = ['info', 'low', 'medium', 'high', 'critical'];
      if (!validSeverities.includes(template.info.severity.toLowerCase())) {
        throw new Error(
          `Invalid severity: ${template.info.severity}. Must be one of: ${validSeverities.join(', ')}`,
        );
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`YAML validation failed: ${error.message}`);
    }
    throw new Error('YAML validation failed: unknown error');
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
        context.logger.warn(
          `[Nuclei] Skipping file with invalid path: ${entry.entryName}`,
        );
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
      throw new Error('No valid YAML templates found in archive');
    }

    context.logger.info(
      `[Nuclei] Validated ${Object.keys(files).length} templates (${(totalSize / 1024).toFixed(1)}KB total)`,
    );

    return files;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to extract zip archive: ${error.message}`);
    }
    throw new Error('Failed to extract zip archive');
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
      severity:
        (payload.info?.severity || payload.severity || 'info').toLowerCase() as Finding['severity'],
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
      context.logger.warn(`[Nuclei Parser] Invalid finding data: ${JSON.stringify(findingCandidate).substring(0, 200)}`);
    }
  }

  context.logger.info(
    `[Nuclei Parser] Summary: ${findings.length} findings, ${jsonLineCount} JSON lines, ${skippedStats} stats skipped, ${skippedNonJson} non-JSON skipped`
  );

  return findings;
}

function extractStats(
  stderr: string,
  output: string,
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

export type { Input as NucleiInput, Output as NucleiOutput };

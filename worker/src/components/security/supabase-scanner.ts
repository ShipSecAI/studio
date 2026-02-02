import { z } from 'zod';
import {
  componentRegistry,
  ComponentRetryPolicy,
  runComponentWithRunner,
  ValidationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import type { DockerRunnerConfig } from '@shipsec/component-sdk';
import { IsolatedContainerVolume } from '../../utils/isolated-volume';

// Extract Supabase project ref from a standard URL like https://<project-ref>.supabase.co
function inferProjectRef(supabaseUrl: string): string | null {
  try {
    const host = new URL(supabaseUrl).hostname;
    const m = host.match(/^([a-z0-9]{20})\.supabase\.co$/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

const inputSchema = inputs({
  supabaseUrl: port(
    z
      .string()
      .trim()
      .transform((value) => {
        const refOnly = /^[a-z0-9]{20}$/i.test(value);
        return refOnly ? `https://${value}.supabase.co` : value;
      })
      .refine((v) => {
        try {
          const url = new URL(v);
          return url.protocol === 'https:' && /\.supabase\.co$/i.test(url.hostname);
        } catch {
          return false;
        }
      }, 'Provide https://<project-ref>.supabase.co or a 20-character project ref'),
    {
      label: 'Supabase URL',
      description:
        'Project URL. Example: https://abcdefghijklmno12345.supabase.co. You may also paste just the project ref.',
      connectionType: { kind: 'primitive', name: 'text' },
      valuePriority: 'manual-first',
    },
  ),
  databaseConnectionString: port(
    z
      .string()
      .min(10, 'Postgres connection string is required (Project Settings → Database).')
      .optional(),
    {
      label: 'Database Connection String',
      description:
        'Postgres connection string from Project Settings → Database. You can also set this in Parameters as Database URL.',
      connectionType: { kind: 'primitive', name: 'secret' },
      editor: 'secret',
    },
  ),
  serviceRoleKey: port(
    z.preprocess(
      (v) => (typeof v === 'string' && v.trim().length > 0 ? v : undefined),
      z.string().min(12, 'Service Role key must be at least 12 characters.').optional(),
    ),
    {
      label: 'Service Role Key',
      description: 'Optional Service Role key from Project Settings → API (enables API checks).',
      connectionType: { kind: 'primitive', name: 'secret' },
      editor: 'secret',
    },
  ),
  projectRef: port(
    z
      .string()
      .regex(/^[a-z0-9]{20}$/i, 'Project ref must be a 20 character base36 string')
      .optional(),
    {
      label: 'Project Reference',
      description: 'Optional explicit project ref. Inferred from URL when omitted.',
      connectionType: { kind: 'primitive', name: 'text' },
    },
  ),
});

const parameterSchema = parameters({
  databaseUrl: param(z.string().min(10).optional(), {
    label: 'Database URL',
    editor: 'secret',
    placeholder: 'postgres://postgres:password@db.<ref>.supabase.co:5432/postgres?sslmode=require',
    description: 'Postgres connection string. Takes precedence over the Connection String input.',
    helpText: 'Copy from Supabase → Project Settings → Database → Connection string (URI).',
  }),
  minimumScore: param(z.number().int().min(0).max(100).optional(), {
    label: 'Minimum Score',
    editor: 'number',
    min: 0,
    max: 100,
    description: 'Optional minimum score threshold (0-100).',
  }),
  failOnCritical: param(z.boolean().optional(), {
    label: 'Fail On Critical',
    editor: 'boolean',
    description: 'If true, scanner may exit non-zero when critical issues are found.',
  }),
});

const scannerReportSchema = z
  .object({
    project_ref: z.string().optional(),
    score: z.number().optional(),
    summary: z
      .object({
        total_checks: z.number().optional(),
        passed: z.number().optional(),
        failed: z.number().optional(),
        skipped: z.number().optional(),
      })
      .partial()
      .optional(),
    issues: z.array(z.any()).optional(),
  })
  .passthrough();

const outputSchema = outputs({
  projectRef: port(z.string().nullable(), {
    label: 'Project Ref',
    description: 'Supabase project reference for the scan.',
  }),
  score: port(z.number().nullable(), {
    label: 'Security Score',
    description: '0–100 score computed by the scanner.',
  }),
  summary: port(z.unknown().optional(), {
    label: 'Summary',
    description: 'Summary metadata from the scanner output.',
    allowAny: true,
    reason: 'Scanner summary payloads can vary by Supabase project configuration.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  issues: port(z.array(z.unknown()).optional(), {
    label: 'Issues',
    description: 'Array of issues flagged by the scanner.',
    allowAny: true,
    reason: 'Scanner issue payloads can vary by Supabase project configuration.',
    connectionType: { kind: 'list', element: { kind: 'primitive', name: 'json' } },
  }),
  report: port(z.unknown(), {
    label: 'Scanner Report',
    description: 'Full JSON report produced by the scanner.',
    allowAny: true,
    reason: 'Scanner report payloads can vary by Supabase project configuration.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  rawOutput: port(z.string(), {
    label: 'Raw Output',
    description: 'Raw console output for debugging.',
  }),
  errors: port(z.array(z.string()).optional(), {
    label: 'Errors',
    description: 'Errors captured during the scan.',
  }),
});

// Retry policy for Supabase Scanner
const supabaseScannerRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
};

const definition = defineComponent({
  id: 'shipsec.supabase.scanner',
  label: 'Supabase Security Scanner',
  category: 'security',
  retryPolicy: supabaseScannerRetryPolicy,
  // Base runner; volumes and command are finalised dynamically in execute()
  runner: {
    kind: 'docker',
    image: 'ghcr.io/shipsecai/supabase-scanner:latest',
    network: 'bridge',
    // Distroless image (no shell) - use image's ENTRYPOINT directly
    // ENTRYPOINT: ["/usr/bin/python3", "/app/supabase_scanner.py"]
    // Config path passed as command argument
    command: [],
    timeoutSeconds: 180,
  },
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: 'Runs the official Supabase Security Scanner inside Docker with a generated config. Produces a JSON report.',
  ui: {
    slug: 'supabase-scanner',
    version: '1.0.0',
    type: 'scan',
    category: 'security',
    description:
      'Audit a Supabase project for security posture (RLS, policies, roles, storage buckets, risky extensions).',
    documentation:
      'Provide your Supabase URL, Postgres connection string, and Service Role key. The scanner runs read-only checks.',
    documentationUrl: 'https://github.com/shipsecai/supabase-scanner',
    icon: 'ShieldCheck',
    author: { name: 'ShipSecAI', type: 'shipsecai' },
    isLatest: true,
    deprecated: false,
    example:
      'Use in CI or ad-hoc to generate a 0–100 security score and list of issues with remediation tips.',
    examples: [
      'Scan production Supabase projects during PR validation and publish findings into the run timeline.',
      'Run periodic audits and store the JSON report for trend analysis.',
    ],
  },
  async execute({ inputs, params }, context) {
    const parsedInputs = inputSchema.parse(inputs);
    const parsedParams = parameterSchema.parse(params);
    const databaseConnectionString = (
      parsedInputs.databaseConnectionString ?? parsedParams.databaseUrl
    )?.trim();
    const projectRef = parsedInputs.projectRef ?? inferProjectRef(parsedInputs.supabaseUrl);

    if (!databaseConnectionString) {
      throw new ValidationError(
        'Provide a Database URL (Postgres connection string) via Database URL or Connection String.',
        { fieldErrors: { databaseUrl: ['Database URL is required.'] } },
      );
    }

    if (!projectRef) {
      throw new ValidationError(
        'Could not infer Supabase project ref from URL. Please provide a valid https://<project-ref>.supabase.co URL or set projectRef explicitly.',
        { fieldErrors: { supabaseUrl: ['Invalid or missing project reference'] } },
      );
    }

    const runnerPayload = {
      ...parsedInputs,
      ...parsedParams,
      projectRef,
      databaseConnectionString,
    };

    const tenantId = (context as any).tenantId ?? 'default-tenant';
    const volume = new IsolatedContainerVolume(tenantId, context.runId);
    const mountPath = '/data';
    const configFilename = 'scanner_config.yaml';
    const outputFilename = 'report.json';
    const containerConfigPath = `${mountPath}/${configFilename}`;
    const containerOutputFile = `${mountPath}/${outputFilename}`;

    // Build scanner_config.yaml to place inside the isolated volume
    const configYamlLines: string[] = [];
    configYamlLines.push('project:');
    configYamlLines.push(`  ref: ${projectRef}`);
    configYamlLines.push('database:');
    configYamlLines.push(`  connection_string: ${JSON.stringify(databaseConnectionString)}`);
    if (parsedInputs.serviceRoleKey && parsedInputs.serviceRoleKey.trim().length > 0) {
      configYamlLines.push('api:');
      configYamlLines.push(`  service_role_key: ${JSON.stringify(parsedInputs.serviceRoleKey)}`);
    }
    configYamlLines.push('scanner:');
    configYamlLines.push('  output:');
    configYamlLines.push('    format: json');
    configYamlLines.push(`    file: ${containerOutputFile}`);
    // Tuning thresholds – avoid non‑zero exit unless explicitly requested
    configYamlLines.push('thresholds:');
    if (typeof parsedParams.minimumScore === 'number') {
      configYamlLines.push(`  minimum_score: ${parsedParams.minimumScore}`);
    } else {
      configYamlLines.push('  minimum_score: 0');
    }
    configYamlLines.push(
      `  fail_on_critical: ${parsedParams.failOnCritical === true ? 'true' : 'false'}`,
    );

    const configYaml = configYamlLines.join('\n') + '\n';
    let stdoutCombined = '';
    const errors: string[] = [];
    let volumeInitialized = false;

    // Build runner with isolated volume mounts
    // Distroless image uses ENTRYPOINT directly, config path passed as command arg
    const baseRunner = definition.runner as DockerRunnerConfig;
    const runner: DockerRunnerConfig = {
      kind: 'docker',
      image: baseRunner.image,
      network: baseRunner.network,
      timeoutSeconds: baseRunner.timeoutSeconds,
      env: { ...(baseRunner.env ?? {}) },
      // Pass config path as command argument to image's ENTRYPOINT
      command: [containerConfigPath],
      volumes: [],
    };

    let report: unknown = {};
    let score: number | null = null;
    let summary: unknown | undefined;
    let issues: unknown[] | undefined;

    try {
      const volumeName = await volume.initialize({ [configFilename]: configYaml });
      volumeInitialized = true;
      context.logger.info(`[SupabaseScanner] Created isolated volume: ${volumeName}`);

      runner.volumes = [volume.getVolumeConfig(mountPath, false)];

      try {
        const result = await runComponentWithRunner(
          runner,
          async () => ({}),
          runnerPayload,
          context,
        );
        if (typeof result === 'string') {
          stdoutCombined = result;
        } else if (result && typeof result === 'object') {
          try {
            stdoutCombined = JSON.stringify(result);
          } catch {
            stdoutCombined = '[object]';
          }
        }
      } catch (err) {
        const msg = (err as Error)?.message ?? 'Unknown error';
        context.logger.error(`[SupabaseScanner] Scanner failed: ${msg}`);
        errors.push(msg);
      }

      // Read JSON report from the mounted output file
      try {
        const files = await volume.readFiles([outputFilename]);
        const text = files[outputFilename];
        try {
          const parsed = JSON.parse(text);
          const safe = scannerReportSchema.safeParse(parsed);
          report = parsed;
          if (safe.success) {
            score = safe.data.score ?? null;
            summary = safe.data.summary;
            issues = Array.isArray(safe.data.issues) ? (safe.data.issues as unknown[]) : undefined;
          }
          stdoutCombined = text.trim();
        } catch (_e) {
          report = { raw: text };
          stdoutCombined = text.trim();
        }
      } catch (_e) {
        context.logger.error('[SupabaseScanner] Output JSON file not found or unreadable.');
        errors.push('Scanner output file not found.');
      }
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Unknown error';
      context.logger.error(`[SupabaseScanner] Scanner failed: ${msg}`);
      errors.push(msg);
    } finally {
      if (volumeInitialized) {
        await volume.cleanup();
        context.logger.info('[SupabaseScanner] Cleaned up isolated volume');
      }
    }

    const output: Output = {
      projectRef: projectRef ?? null,
      score,
      summary,
      issues,
      report,
      rawOutput: stdoutCombined ?? '',
      errors: errors.length > 0 ? errors : undefined,
    };

    return outputSchema.parse(output);
  },
});

componentRegistry.register(definition);

// Create local type aliases for backward compatibility
type Input = (typeof inputSchema)['__inferred'];
type Output = (typeof outputSchema)['__inferred'];

export type { Input as SupabaseScannerInput, Output as SupabaseScannerOutput };

import { z } from 'zod';
import {
  componentRegistry,
  ComponentDefinition,
  ComponentRetryPolicy,
  port,
  runComponentWithRunner,
  ValidationError,
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

const inputSchema = z
  .object({
    supabaseUrl: z
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
    databaseConnectionString: z
      .string()
      .min(10, 'Postgres connection string is required (Project Settings → Database).')
      .optional(),
    // Alias accepted by UI as a parameter
    databaseUrl: z.string().min(10).optional(),
    serviceRoleKey: z
      .preprocess((v) => (typeof v === 'string' && v.trim().length > 0 ? v : undefined),
        z.string().min(12, 'Service Role key must be at least 12 characters.').optional(),
      ),
    projectRef: z
      .string()
      .regex(/^[a-z0-9]{20}$/i, 'Project ref must be a 20 character base36 string')
      .optional(),
    // Optional tuning
    minimumScore: z.number().int().min(0).max(100).optional(),
    failOnCritical: z.boolean().optional(),
  })
  .transform((params) => {
    const ref = params.projectRef ?? inferProjectRef(params.supabaseUrl);
    const db = (params.databaseConnectionString ?? params.databaseUrl)?.trim();
    return { ...params, projectRef: ref, databaseConnectionString: db };
  })
  .superRefine((val, ctx) => {
    if (!val.databaseConnectionString || val.databaseConnectionString.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['databaseUrl'],
        message: 'Provide a Database URL (Postgres connection string) via Database URL or Connection String.',
      });
    }
  });

type Input = z.infer<typeof inputSchema>;

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

type Output = {
  projectRef: string | null;
  score: number | null;
  summary?: unknown;
  issues?: unknown[];
  report: unknown; // full JSON from the scanner
  rawOutput: string; // combined stdout and/or file contents for debugging
  errors?: string[];
};

const outputSchema: z.ZodType<Output> = z.object({
  projectRef: z.string().nullable(),
  score: z.number().nullable(),
  summary: z.unknown().optional(),
  issues: z.array(z.unknown()).optional(),
  report: z.unknown(),
  rawOutput: z.string(),
  errors: z.array(z.string()).optional(),
});

// Retry policy for Supabase Scanner
const supabaseScannerRetryPolicy: ComponentRetryPolicy = {
  maxAttempts: 2,
  initialIntervalSeconds: 5,
  maximumIntervalSeconds: 30,
  backoffCoefficient: 2,
  nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError'],
};

const definition: ComponentDefinition<Input, Output> = {
  id: 'shipsec.supabase.scanner',
  label: 'Supabase Security Scanner',
  category: 'security',
  retryPolicy: supabaseScannerRetryPolicy,
  // Base runner; volumes and command are finalised dynamically in execute()
  runner: {
    kind: 'docker',
    image: 'ghcr.io/shipsecai/supabase-scanner:latest',
    network: 'bridge',
    // Entry-point from the image handles a single CLI argument: the config path
    // We set the argument in execute() via command: ['/configs/scanner_config.yaml']
    command: ['/configs/scanner_config.yaml'],
    timeoutSeconds: 180,
  },
  inputSchema,
  outputSchema,
  docs:
    'Runs the official Supabase Security Scanner inside Docker with a generated config. Produces a JSON report.',
  metadata: {
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
    inputs: [
      {
        id: 'supabaseUrl',
        label: 'Supabase URL',
        dataType: port.text(),
        required: true,
        description:
          'Project URL. Example: https://abcdefghijklmno12345.supabase.co. You may also paste just the project ref (abcdefghijklmno12345) in other fields if supported.',
        valuePriority: 'manual-first',
      },
      {
        id: 'databaseConnectionString',
        label: 'Database Connection String',
        dataType: port.secret(),
        required: false,
        description: 'Postgres connection string from Project Settings → Database. You can also set this in Parameters as Database URL.',
      },
      {
        id: 'serviceRoleKey',
        label: 'Service Role Key',
        dataType: port.secret(),
        required: false,
        description: 'Optional Service Role key from Project Settings → API (enables API checks).',
      },
      {
        id: 'projectRef',
        label: 'Project Reference',
        dataType: port.text(),
        required: false,
        description: 'Optional explicit project ref. Inferred from URL when omitted.',
      },
      {
        id: 'minimumScore',
        label: 'Minimum Score',
        dataType: port.number(),
        required: false,
        description: 'Optional minimum score threshold (0–100).',
      },
      {
        id: 'failOnCritical',
        label: 'Fail On Critical',
        dataType: port.boolean(),
        required: false,
        description: 'If true, scanner may exit non‑zero when critical issues are found.',
      },
    ],
    parameters: [
      {
        id: 'databaseUrl',
        label: 'Database URL',
        type: 'secret',
        required: false,
        placeholder: 'postgres://postgres:password@db.<ref>.supabase.co:5432/postgres?sslmode=require',
        description: 'Postgres connection string. Takes precedence over the Connection String input.',
        helpText: 'Copy from Supabase → Project Settings → Database → Connection string (URI).',
      },
    ],
    outputs: [
      {
        id: 'report',
        label: 'Scanner Report',
        dataType: port.json(),
        description: 'Full JSON report produced by the scanner.',
      },
      {
        id: 'score',
        label: 'Security Score',
        dataType: port.number(),
        description: '0–100 score computed by the scanner.',
      },
      {
        id: 'rawOutput',
        label: 'Raw Output',
        dataType: port.text(),
        description: 'Raw console output for debugging.',
      },
    ],
    examples: [
      'Scan production Supabase projects during PR validation and publish findings into the run timeline.',
      'Run periodic audits and store the JSON report for trend analysis.',
    ],
  },
  async execute(params, context) {
    const input = inputSchema.parse(params);

    if (!input.projectRef) {
      throw new ValidationError(
        'Could not infer Supabase project ref from URL. Please provide a valid https://<project-ref>.supabase.co URL or set projectRef explicitly.',
        { fieldErrors: { supabaseUrl: ['Invalid or missing project reference'] } },
      );
    }

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
    configYamlLines.push(`  ref: ${input.projectRef}`);
    configYamlLines.push('database:');
    configYamlLines.push(`  connection_string: ${JSON.stringify(input.databaseConnectionString)}`);
    if (input.serviceRoleKey && input.serviceRoleKey.trim().length > 0) {
      configYamlLines.push('api:');
      configYamlLines.push(`  service_role_key: ${JSON.stringify(input.serviceRoleKey)}`);
    }
    configYamlLines.push('scanner:');
    configYamlLines.push('  output:');
    configYamlLines.push('    format: json');
    configYamlLines.push(`    file: ${containerOutputFile}`);
    // Tuning thresholds – avoid non‑zero exit unless explicitly requested
    configYamlLines.push('thresholds:');
    if (typeof input.minimumScore === 'number') {
      configYamlLines.push(`  minimum_score: ${input.minimumScore}`);
    } else {
      configYamlLines.push('  minimum_score: 0');
    }
    configYamlLines.push(`  fail_on_critical: ${input.failOnCritical === true ? 'true' : 'false'}`);

    const configYaml = configYamlLines.join('\n') + '\n';
    let stdoutCombined = '';
    const errors: string[] = [];
    let volumeInitialized = false;

    // Build runner with isolated volume mounts
    const baseRunner = definition.runner;
    const runner: DockerRunnerConfig = {
      ...(baseRunner.kind === 'docker'
        ? baseRunner
        : { kind: 'docker', image: 'ghcr.io/shipsecai/supabase-scanner:latest', command: [containerConfigPath] }),
      env: { ...(baseRunner.kind === 'docker' ? baseRunner.env ?? {} : {}) },
      command: [containerConfigPath],
      volumes: [],
    } as DockerRunnerConfig;

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
        const result = await runComponentWithRunner(runner, async () => ({}), input, context);
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
        } catch (e) {
          report = { raw: text };
          stdoutCombined = text.trim();
        }
      } catch (e) {
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
      projectRef: input.projectRef ?? null,
      score,
      summary,
      issues,
      report,
      rawOutput: stdoutCombined ?? '',
      errors: errors.length > 0 ? errors : undefined,
    };

    return outputSchema.parse(output);
  },
};

componentRegistry.register(definition);

export type { Input as SupabaseScannerInput, Output as SupabaseScannerOutput };

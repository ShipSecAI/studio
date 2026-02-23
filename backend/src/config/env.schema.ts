import { z } from 'zod';
import {
  databaseUrlSchema,
  temporalConfigSchema,
  secretStoreKeySchema,
  stringToBoolean,
} from '@shipsec/shared';

/**
 * AUTH_PROVIDER: trims, lowercases, and defaults unknown values to 'local'.
 * Preserves the tolerant normalization from auth.config.ts.
 */
const authProviderSchema = z
  .string()
  .optional()
  .default('local')
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['local', 'clerk']).catch('local'));

export const backendEnvSchema = z
  .object({
    // --- Conditionally required (depend on ingest-services flags) ---
    DATABASE_URL: z.string().optional(),
    LOG_KAFKA_BROKERS: z.string().optional(),

    // --- Required ---
    SECRET_STORE_MASTER_KEY: secretStoreKeySchema,

    // --- With defaults ---
    PORT: z.coerce.number().optional().default(3211),
    HOST: z.string().optional().default('0.0.0.0'),
    SKIP_INGEST_SERVICES: stringToBoolean(false),
    ENABLE_INGEST_SERVICES: stringToBoolean(true),

    // --- Auth ---
    AUTH_PROVIDER: authProviderSchema,
    CLERK_SECRET_KEY: z.string().optional(),
    CLERK_PUBLISHABLE_KEY: z.string().optional(),
    AUTH_LOCAL_ALLOW_UNAUTHENTICATED: stringToBoolean(true),
    AUTH_LOCAL_API_KEY: z.string().optional().default(''),
    ADMIN_USERNAME: z.string().optional().default('admin'),
    ADMIN_PASSWORD: z.string().optional().default('admin'),

    // --- Optional services ---
    REDIS_URL: z.string().optional(),
    SESSION_SECRET: z.string().optional().default(''),
    WEBHOOK_BASE_URL: z.string().optional(),

    // --- OpenSearch ---
    OPENSEARCH_URL: z.string().optional(),
    OPENSEARCH_USERNAME: z.string().optional(),
    OPENSEARCH_PASSWORD: z.string().optional(),
    OPENSEARCH_DASHBOARDS_URL: z.string().optional().default(''),

    // --- Loki ---
    LOKI_URL: z.string().optional(),
    LOKI_TENANT_ID: z.string().optional().default(''),
    LOKI_USERNAME: z.string().optional().default(''),
    LOKI_PASSWORD: z.string().optional().default(''),

    // --- MinIO ---
    MINIO_ROOT_USER: z.string().optional(),
    MINIO_ROOT_PASSWORD: z.string().optional(),

    // --- GitHub OAuth ---
    GITHUB_OAUTH_CLIENT_ID: z.string().optional(),
    GITHUB_OAUTH_CLIENT_SECRET: z.string().optional(),

    // --- Zoom OAuth ---
    ZOOM_OAUTH_CLIENT_ID: z.string().optional(),
    ZOOM_OAUTH_CLIENT_SECRET: z.string().optional(),

    // --- Platform ---
    PLATFORM_API_URL: z.string().optional().default(''),
    PLATFORM_SERVICE_TOKEN: z.string().optional().default(''),
    PLATFORM_API_TIMEOUT_MS: z.string().optional().default(''),

    // --- GitHub Template Library ---
    GITHUB_TEMPLATE_REPO: z
      .string()
      .optional()
      .default('shipsecai/workflow-templates')
      .refine((v) => v.includes('/'), {
        message: 'GITHUB_TEMPLATE_REPO must be in owner/repo format',
      }),
    GITHUB_TEMPLATE_BRANCH: z.string().optional().default('main'),
    GITHUB_TEMPLATE_TOKEN: z.string().optional(),

    // --- Temporal ---
    TEMPORAL_BOOTSTRAP_DEMO: stringToBoolean(false),
  })
  .merge(temporalConfigSchema)
  .superRefine((data, ctx) => {
    // Match the runtime guard in node-io.module.ts / trace.module.ts:
    //   ingestEnabled = ENABLE_INGEST_SERVICES !== false && SKIP_INGEST_SERVICES !== true
    const ingestRequired = data.ENABLE_INGEST_SERVICES && !data.SKIP_INGEST_SERVICES;
    if (ingestRequired) {
      if (!data.DATABASE_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message:
            'DATABASE_URL is required (set SKIP_INGEST_SERVICES=true or ENABLE_INGEST_SERVICES=false to skip)',
        });
      } else {
        const parsed = databaseUrlSchema.safeParse(data.DATABASE_URL);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            ctx.addIssue({ ...issue, path: ['DATABASE_URL'] });
          }
        }
      }

      if (!data.LOG_KAFKA_BROKERS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LOG_KAFKA_BROKERS'],
          message:
            'LOG_KAFKA_BROKERS is required (set SKIP_INGEST_SERVICES=true or ENABLE_INGEST_SERVICES=false to skip)',
        });
      }
    }

    // Clerk keys required when AUTH_PROVIDER is clerk
    if (data.AUTH_PROVIDER === 'clerk') {
      if (!data.CLERK_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLERK_SECRET_KEY'],
          message: 'CLERK_SECRET_KEY is required when AUTH_PROVIDER=clerk',
        });
      }
      if (!data.CLERK_PUBLISHABLE_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CLERK_PUBLISHABLE_KEY'],
          message: 'CLERK_PUBLISHABLE_KEY is required when AUTH_PROVIDER=clerk',
        });
      }
    }
  });

export type BackendEnvConfig = z.infer<typeof backendEnvSchema>;

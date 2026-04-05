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
    NODE_ENV: z.string().optional().default('development'),
    PORT: z.coerce.number().optional().default(3211),
    HOST: z.string().optional().default('0.0.0.0'),
    SHIPSEC_ENV: z.string().optional(),
    REQUEST_BODY_LIMIT: z.string().optional().default('1mb'),
    SKIP_INGEST_SERVICES: stringToBoolean(false),
    ENABLE_INGEST_SERVICES: stringToBoolean(true),

    // --- Instance ---
    SHIPSEC_INSTANCE: z.coerce.number().optional().default(0),

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

    // --- Internal service auth ---
    INTERNAL_SERVICE_TOKEN: z.string().optional().default(''),
    INTEGRATION_STORE_MASTER_KEY: z.string().optional(),
    ALLOW_INSECURE_INTERNAL_ENDPOINTS: stringToBoolean(false),

    // --- Tool Registry Redis ---
    TOOL_REGISTRY_REDIS_URL: z.string().optional(),

    // --- ClickHouse ---
    CLICKHOUSE_URL: z.string().optional(),
    CLICKHOUSE_DATABASE: z.string().optional().default('shipsec'),
    CLICKHOUSE_USERNAME: z.string().optional(),
    CLICKHOUSE_PASSWORD: z.string().optional(),

    // --- Loki ---
    LOKI_URL: z.string().optional(),
    LOKI_TENANT_ID: z.string().optional().default(''),
    LOKI_USERNAME: z.string().optional().default(''),
    LOKI_PASSWORD: z.string().optional().default(''),

    // --- MinIO ---
    MINIO_ROOT_USER: z.string().optional(),
    MINIO_ROOT_PASSWORD: z.string().optional(),
    MINIO_ENDPOINT: z.string().optional().default('localhost'),
    MINIO_PORT: z.coerce.number().optional().default(9000),
    MINIO_USE_SSL: stringToBoolean(false),
    MINIO_ACCESS_KEY: z.string().optional().default('minioadmin'),
    MINIO_SECRET_KEY: z.string().optional().default('minioadmin'),
    MINIO_BUCKET_NAME: z.string().optional().default('shipsec-files'),

    // --- Kafka client/group/topic customization ---
    LOG_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-backend'),
    LOG_KAFKA_GROUP_ID: z.string().optional().default('shipsec-log-ingestor'),
    LOG_KAFKA_TOPIC: z.string().optional().default('telemetry.logs'),
    EVENT_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-backend-events'),
    EVENT_KAFKA_GROUP_ID: z.string().optional().default('shipsec-event-ingestor'),
    EVENT_KAFKA_TOPIC: z.string().optional().default('telemetry.events'),
    AGENT_TRACE_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-backend-agent-trace'),
    AGENT_TRACE_KAFKA_GROUP_ID: z.string().optional().default('shipsec-backend-agent-trace'),
    AGENT_TRACE_KAFKA_TOPIC: z.string().optional().default('telemetry.agent-trace'),
    NODE_IO_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-backend-node-io'),
    NODE_IO_KAFKA_GROUP_ID: z.string().optional().default('shipsec-backend-node-io'),
    NODE_IO_KAFKA_TOPIC: z.string().optional().default('telemetry.node-io'),
    ASSET_EVENT_KAFKA_TOPIC: z.string().optional().default('asset.events'),

    // --- GitHub App ---
    GITHUB_APP_ID: z.string().optional(),
    GITHUB_APP_SLUG: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY: z.string().optional(),
    GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),
    GITHUB_APP_CLIENT_ID: z.string().optional(),
    GITHUB_APP_CLIENT_SECRET: z.string().optional(),
    GITHUB_API_URL: z.string().optional().default('https://api.github.com'),
    GITHUB_URL: z.string().optional().default('https://github.com'),

    // --- Zoom OAuth ---
    ZOOM_OAUTH_CLIENT_ID: z.string().optional(),
    ZOOM_OAUTH_CLIENT_SECRET: z.string().optional(),
    ZOOM_OAUTH_SCOPES: z.string().optional(),

    // --- Slack OAuth ---
    SLACK_OAUTH_CLIENT_ID: z.string().optional(),
    SLACK_OAUTH_CLIENT_SECRET: z.string().optional(),
    SLACK_OAUTH_SCOPES: z.string().optional(),

    // --- Slack Bot ---
    SLACK_BOT_ENABLED: z.enum(['true', 'false']).optional().default('false'),
    SLACK_SIGNING_SECRET: z.string().optional(),

    // --- AWS ---
    SHIPSEC_AWS_REGION: z.string().optional(),
    SHIPSEC_AWS_ACCESS_KEY_ID: z.string().optional(),
    SHIPSEC_AWS_SECRET_ACCESS_KEY: z.string().optional(),
    SHIPSEC_AWS_SESSION_TOKEN: z.string().optional(),
    SHIPSEC_AWS_STRICT_IDENTITY_CHECK: stringToBoolean(true),
    SHIPSEC_AWS_STS_DURATION_SECONDS: z.coerce.number().optional().default(3600),
    SHIPSEC_PLATFORM_ROLE_ARN: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_DEFAULT_REGION: z.string().optional(),

    // --- LiteLLM ---
    LITELLM_PROXY_URL: z.string().optional(),
    LITELLM_MASTER_KEY: z.string().optional(),

    // --- Platform ---
    PLATFORM_API_URL: z.string().optional().default(''),
    PLATFORM_SERVICE_TOKEN: z.string().optional().default(''),
    PLATFORM_API_TIMEOUT_MS: z.string().optional().default(''),

    // --- Feature flags ---
    ASSET_DISCOVERY_ENABLED: stringToBoolean(true),
    MCP_SYNC_TEMPLATES_ON_STARTUP: stringToBoolean(false),

    // --- Migration / version check ---
    SHIPSEC_SKIP_MIGRATION_CHECK: stringToBoolean(false),
    SHIPSEC_VERSION_CHECK_URL: z.string().optional(),
    SHIPSEC_VERSION_CHECK_TIMEOUT_MS: z.coerce.number().optional().default(5000),
    SHIPSEC_VERSION_CHECK_DISABLED: stringToBoolean(false),
    SHIPSEC_VERSION_CHECK_VERSION: z.string().optional(),

    // --- CORS ---
    CORS_EXTRA_ORIGINS: z.string().optional(),

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

    const shipsecEnv = data.SHIPSEC_ENV?.trim().toLowerCase();
    const requiresRedis =
      data.NODE_ENV === 'production' || shipsecEnv === 'prod' || shipsecEnv === 'staging';
    if (requiresRedis && !data.REDIS_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'REDIS_URL is required when running in production, staging, or prod',
      });
    }
  });

export type BackendEnvConfig = z.infer<typeof backendEnvSchema>;

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Explicit string→boolean coercion that avoids the JS footgun where
 * `Boolean("false")` is `true`. Accepts 'true', 'false', '', or undefined.
 */
export function stringToBoolean(defaultValue: boolean = false) {
  return z
    .enum(['true', 'false', ''])
    .optional()
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true');
}

/**
 * Format Zod errors into a readable table for console output.
 */
export function formatEnvErrors(error: z.ZodError): string {
  const lines: string[] = [];
  const maxVarLen = Math.max(...error.issues.map((i) => i.path.join('.').length || 3), 8);

  lines.push(`${'Variable'.padEnd(maxVarLen)}  Error`);
  lines.push(`${'─'.repeat(maxVarLen)}  ${'─'.repeat(40)}`);

  for (const issue of error.issues) {
    const varName = issue.path.join('.') || '(root)';
    lines.push(`${varName.padEnd(maxVarLen)}  ${issue.message}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Reusable schemas for env vars shared across services
// ---------------------------------------------------------------------------

/** DATABASE_URL — must start with postgresql:// */
export const databaseUrlSchema = z
  .string({ error: 'DATABASE_URL is required' })
  .startsWith('postgresql://', { message: 'DATABASE_URL must start with postgresql://' });

/** Temporal connection configuration */
export const temporalConfigSchema = z.object({
  TEMPORAL_ADDRESS: z.string().optional().default('localhost:7233'),
  TEMPORAL_NAMESPACE: z.string().optional().default('shipsec-dev'),
  TEMPORAL_TASK_QUEUE: z.string().optional().default('shipsec-dev'),
});

/** MinIO / S3-compatible storage configuration */
export const minioConfigSchema = z.object({
  MINIO_ENDPOINT: z.string().optional().default('localhost'),
  MINIO_PORT: z.coerce.number().optional().default(9000),
  MINIO_ACCESS_KEY: z.string().optional().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().optional().default('minioadmin'),
  MINIO_USE_SSL: stringToBoolean(false),
  MINIO_BUCKET_NAME: z.string().optional().default('shipsec-files'),
});

/** SECRET_STORE_MASTER_KEY — exactly 32 characters */
export const secretStoreKeySchema = z
  .string({ error: 'SECRET_STORE_MASTER_KEY is required' })
  .length(32, { message: 'SECRET_STORE_MASTER_KEY must be exactly 32 characters' });

/** LOG_KAFKA_BROKERS — comma-separated string → array of strings */
export const kafkaBrokersSchema = z
  .string({ error: 'LOG_KAFKA_BROKERS is required' })
  .min(1, 'LOG_KAFKA_BROKERS must not be empty')
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

import { z } from 'zod';
import {
  databaseUrlSchema,
  temporalConfigSchema,
  minioConfigSchema,
  secretStoreKeySchema,
  kafkaBrokersSchema,
} from '@shipsec/shared';

export const workerEnvSchema = z
  .object({
    // --- Required ---
    DATABASE_URL: databaseUrlSchema,
    SECRET_STORE_MASTER_KEY: secretStoreKeySchema,
    LOG_KAFKA_BROKERS: kafkaBrokersSchema,

    // --- With defaults ---
    BACKEND_URL: z.string().optional().default('http://localhost:3211'),

    // --- Optional Kafka client IDs ---
    EVENT_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-worker-events'),
    AGENT_TRACE_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-worker-agent-trace'),
    NODE_IO_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-worker-node-io'),
    LOG_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-worker'),

    // --- Terminal Redis ---
    TERMINAL_REDIS_URL: z.string().optional(),
    TERMINAL_REDIS_MAXLEN: z.coerce.number().optional().default(5000),

    // --- Loki ---
    LOKI_URL: z.string().optional(),
    LOKI_TENANT_ID: z.string().optional().default(''),
    LOKI_USERNAME: z.string().optional().default(''),
    LOKI_PASSWORD: z.string().optional().default(''),

    // --- OpenSearch ---
    OPENSEARCH_URL: z.string().optional(),
    OPENSEARCH_USERNAME: z.string().optional(),
    OPENSEARCH_PASSWORD: z.string().optional(),
    OPENSEARCH_DASHBOARDS_URL: z.string().optional().default(''),

    // --- AI provider keys (all optional) ---
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
  })
  .merge(temporalConfigSchema)
  .merge(minioConfigSchema);

export type WorkerEnvConfig = z.infer<typeof workerEnvSchema>;

import { z } from 'zod';
import {
  databaseUrlSchema,
  temporalConfigSchema,
  minioConfigSchema,
  secretStoreKeySchema,
  kafkaBrokersSchema,
  stringToBoolean,
} from '@shipsec/shared';

export const workerEnvSchema = z
  .object({
    // --- Required ---
    DATABASE_URL: databaseUrlSchema,
    SECRET_STORE_MASTER_KEY: secretStoreKeySchema,
    LOG_KAFKA_BROKERS: kafkaBrokersSchema,

    // --- Instance ---
    SHIPSEC_INSTANCE: z.coerce.number().optional().default(0),

    // --- With defaults ---
    BACKEND_URL: z.string().optional().default('http://localhost:3211'),

    // --- Kafka client IDs ---
    EVENT_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-worker-events'),
    AGENT_TRACE_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-worker-agent-trace'),
    NODE_IO_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-worker-node-io'),
    LOG_KAFKA_CLIENT_ID: z.string().optional().default('shipsec-worker'),

    // --- Kafka topics ---
    LOG_KAFKA_TOPIC: z.string().optional().default('telemetry.logs'),
    EVENT_KAFKA_TOPIC: z.string().optional().default('telemetry.events'),
    AGENT_TRACE_KAFKA_TOPIC: z.string().optional().default('telemetry.agent-trace'),
    NODE_IO_KAFKA_TOPIC: z.string().optional().default('telemetry.node-io'),
    ASSET_EVENT_KAFKA_TOPIC: z.string().optional().default('asset.events'),

    // --- Internal service auth ---
    INTERNAL_SERVICE_TOKEN: z.string().optional().default(''),

    // --- Terminal Redis ---
    REDIS_URL: z.string().optional(),
    TERMINAL_REDIS_MAXLEN: z.coerce.number().optional().default(5000),

    // --- Loki ---
    LOKI_URL: z.string().optional(),
    LOKI_TENANT_ID: z.string().optional().default(''),
    LOKI_USERNAME: z.string().optional().default(''),
    LOKI_PASSWORD: z.string().optional().default(''),

    // --- ClickHouse ---
    CLICKHOUSE_URL: z.string().optional(),
    CLICKHOUSE_DATABASE: z.string().optional().default('shipsec'),
    CLICKHOUSE_USERNAME: z.string().optional(),
    CLICKHOUSE_PASSWORD: z.string().optional(),

    // --- K8s execution ---
    EXECUTION_MODE: z.string().optional(),
    K8S_JOB_NAMESPACE: z.string().optional().default('shipsec-workloads'),
    K8S_JOB_SERVICE_ACCOUNT: z.string().optional(),
    K8S_IMAGE_PULL_SECRET: z.string().optional(),
    K8S_JOB_IMAGE_PULL_POLICY: z.string().optional().default('IfNotPresent'),
    K8S_JOB_NODE_SELECTOR_JSON: z.string().optional(),
    K8S_JOB_TOLERATIONS_JSON: z.string().optional(),
    K8S_JOB_POD_SECURITY_CONTEXT_JSON: z.string().optional(),
    K8S_JOB_CONTAINER_SECURITY_CONTEXT_JSON: z.string().optional(),
    GCS_VOLUME_BUCKET: z.string().optional(),

    // --- Org/auth context ---
    DEFAULT_ORGANIZATION_ID: z.string().optional(),
    ORGANIZATION_ID: z.string().optional(),
    STUDIO_API_USERNAME: z.string().optional(),
    STUDIO_API_PASSWORD: z.string().optional(),
    ADMIN_USERNAME: z.string().optional().default('admin'),
    ADMIN_PASSWORD: z.string().optional().default('admin'),

    // --- AI provider keys (all optional) ---
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    CHAT_AI_MODEL_ID: z.string().optional(),

    // --- AI providers (extended) ---
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_BASE_URL: z.string().optional(),
    OPENAI_BASE_URL: z.string().optional(),
    OPENROUTER_BASE_URL: z.string().optional().default('https://openrouter.ai/api/v1'),
    OPENROUTER_HTTP_REFERER: z.string().optional(),
    OPENROUTER_APP_TITLE: z.string().optional().default('ShipSec Studio'),

    // --- AWS ---
    AWS_REGION: z.string().optional(),
    AWS_DEFAULT_REGION: z.string().optional(),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_SESSION_TOKEN: z.string().optional(),
    AWS_PROFILE: z.string().optional(),

    // --- Cartography / Neo4j ---
    NEO4J_URI: z.string().optional().default('bolt://localhost:7687'),
    NEO4J_USER: z.string().optional().default(''),
    NEO4J_PASSWORD: z.string().optional().default(''),
    NEO4J_DATABASE: z.string().optional().default('neo4j'),
    CARTOGRAPHY_IMAGE: z.string().optional().default('ghcr.io/cartography-cncf/cartography:latest'),
    CARTOGRAPHY_NEO4J_URI: z.string().optional().default('bolt://neo4j:7687'),
    CARTOGRAPHY_DOCKER_NETWORK: z.string().optional().default('shipsec-network'),
    CARTOGRAPHY_AWS_REQUESTED_SYNCS: z
      .string()
      .optional()
      .default(
        'iam,s3,dynamodb,ec2:instance,ec2:security_group,ec2:subnet,ec2:network_acls,ec2:vpc,ec2:volumes,ec2:load_balancer,ec2:load_balancer_v2,ecr,ecs,eks,elasticache,lambda_function,kms,rds,route53,apigateway,secretsmanager,sqs,acm:certificate,cloudfront,cloudtrail,guardduty,sns',
      ),

    // --- Component I/O paths ---
    SHIPSEC_INPUT_PATH: z.string().optional().default('/shipsec-output/input.json'),
    SHIPSEC_OUTPUT_PATH: z.string().optional().default('/shipsec-output/result.json'),

    // --- Component timeouts ---
    HTTPX_TIMEOUT_SECONDS: z.coerce.number().optional(),
    NUCLEI_TIMEOUT_SECONDS: z.coerce.number().optional(),
    AMASS_TIMEOUT_SECONDS: z.coerce.number().optional(),
    NAABU_TIMEOUT_SECONDS: z.coerce.number().optional(),
    NOTIFY_TIMEOUT_SECONDS: z.coerce.number().optional(),

    // --- Debug ---
    DEBUG_LOGS_CONSOLE: stringToBoolean(false),
    SKIP_CONTAINER_CLEANUP: stringToBoolean(false),
  })
  .merge(temporalConfigSchema)
  .merge(minioConfigSchema);

export type WorkerEnvConfig = z.infer<typeof workerEnvSchema>;

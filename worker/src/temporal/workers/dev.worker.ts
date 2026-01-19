import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'minio';
import { Worker, NativeConnection } from '@temporalio/worker';
import { status as grpcStatus } from '@grpc/grpc-js';
import Long from 'long';
import { isGrpcServiceError } from '@temporalio/client';
import { config } from 'dotenv';
import {
  runComponentActivity,
  setRunMetadataActivity,
  finalizeRunActivity,
  initializeComponentActivityServices,
} from '../activities/run-component.activity';
import {
  createHumanInputRequestActivity,
  cancelHumanInputRequestActivity,
  initializeHumanInputActivity,
  expireHumanInputRequestActivity,
} from '../activities/human-input.activity';
import { prepareRunPayloadActivity } from '../activities/run-dispatcher.activity';
import { recordTraceEventActivity, initializeTraceActivity } from '../activities/trace.activity';

// ... (existing imports)

import {
  ArtifactAdapter,
  FileStorageAdapter,
  SecretsAdapter,
  RedisTerminalStreamAdapter,
  KafkaLogAdapter,
  KafkaTraceAdapter,
  KafkaAgentTracePublisher,
  KafkaNodeIOAdapter,
} from '../../adapters';
import { ConfigurationError } from '@shipsec/component-sdk';
import * as schema from '../../adapters/schema';

// Load environment variables from .env file
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../..', '.env') });

if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

async function main() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? 'shipsec-default';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'shipsec-dev';
  const workflowsPath = join(dirname(fileURLToPath(import.meta.url)), '../workflows');

  console.log(`🔌 Connecting to Temporal at ${address}...`);
  console.log(`📋 Worker Configuration:`);
  console.log(`   - Address: ${address}`);
  console.log(`   - Namespace: ${namespace}`);
  console.log(`   - Task Queue: ${taskQueue}`);
  console.log(`   - Workflows Path: ${workflowsPath}`);
  console.log(`   - Node ENV: ${process.env.NODE_ENV}`);

  // Create connection first
  console.log(`🔗 Establishing connection to Temporal...`);
  const connection = await NativeConnection.connect({
    address,
  });

  console.log(`✅ Connected to Temporal at ${address}`);

  await ensureTemporalNamespace(connection, namespace);

  // Initialize database connection for worker
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new ConfigurationError('DATABASE_URL is not set', {
      configKey: 'DATABASE_URL',
    });
  }
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  console.log(`✅ Connected to database`);

  // Initialize MinIO client
  const minioEndpoint = process.env.MINIO_ENDPOINT ?? 'localhost';
  const minioPort = parseInt(process.env.MINIO_PORT ?? '9000', 10);
  const minioAccessKey = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
  const minioSecretKey = process.env.MINIO_SECRET_KEY ?? 'minioadmin';
  const minioUseSSL = process.env.MINIO_USE_SSL === 'true';
  const minioBucketName = process.env.MINIO_BUCKET_NAME ?? 'shipsec-files';

  const minioClient = new Client({
    endPoint: minioEndpoint,
    port: minioPort,
    useSSL: minioUseSSL,
    accessKey: minioAccessKey,
    secretKey: minioSecretKey,
  });

  console.log(`✅ Connected to MinIO at ${minioEndpoint}:${minioPort}`);

  // Create service adapters (implementing SDK interfaces)
  const storageAdapter = new FileStorageAdapter(minioClient, db, minioBucketName);
  const artifactAdapter = new ArtifactAdapter(minioClient, db, minioBucketName);
  const secretsAdapter = new SecretsAdapter(db);

  const kafkaBrokerEnv = process.env.LOG_KAFKA_BROKERS;
  const kafkaBrokers = kafkaBrokerEnv
    ? kafkaBrokerEnv
        .split(',')
        .map((broker) => broker.trim())
        .filter(Boolean)
    : [];

  if (kafkaBrokers.length === 0) {
    throw new ConfigurationError('LOG_KAFKA_BROKERS must be configured for workflow logging', {
      configKey: 'LOG_KAFKA_BROKERS',
    });
  }

  const traceAdapter = new KafkaTraceAdapter({
    brokers: kafkaBrokers,
    topic: process.env.EVENT_KAFKA_TOPIC ?? 'telemetry.events',
    clientId: process.env.EVENT_KAFKA_CLIENT_ID ?? 'shipsec-worker-events',
  });

  const agentTracePublisher = new KafkaAgentTracePublisher({
    brokers: kafkaBrokers,
    topic: process.env.AGENT_TRACE_KAFKA_TOPIC ?? 'telemetry.agent-trace',
    clientId: process.env.AGENT_TRACE_KAFKA_CLIENT_ID ?? 'shipsec-worker-agent-trace',
  });

  const nodeIOAdapter = new KafkaNodeIOAdapter(
    {
      brokers: kafkaBrokers,
      topic: process.env.NODE_IO_KAFKA_TOPIC ?? 'telemetry.node-io',
      clientId: process.env.NODE_IO_KAFKA_CLIENT_ID ?? 'shipsec-worker-node-io',
    },
    storageAdapter,
  );

  let logAdapter: KafkaLogAdapter;
  try {
    logAdapter = new KafkaLogAdapter({
      brokers: kafkaBrokers,
      topic: process.env.LOG_KAFKA_TOPIC ?? 'telemetry.logs',
      clientId: process.env.LOG_KAFKA_CLIENT_ID ?? 'shipsec-worker',
    });
    console.log(`✅ Kafka logging enabled (${kafkaBrokers.join(', ')})`);
  } catch (error) {
    console.error('❌ Failed to initialize Kafka logging', error);
    throw error;
  }

  const terminalRedisUrl = process.env.TERMINAL_REDIS_URL;
  let terminalStream: RedisTerminalStreamAdapter | undefined;
  if (terminalRedisUrl) {
    try {
      const redis = new Redis(terminalRedisUrl);
      const maxEntries = Number(process.env.TERMINAL_REDIS_MAXLEN ?? '5000');
      terminalStream = new RedisTerminalStreamAdapter(redis, { maxEntries });
      console.log(`✅ Terminal Redis streaming enabled (${terminalRedisUrl})`);
    } catch (error) {
      console.error('⚠️ Failed to initialize terminal Redis streaming', error);
    }
  } else {
    console.warn('⚠️ TERMINAL_REDIS_URL not set; terminal streaming disabled');
  }

  // Initialize global services for activities
  initializeComponentActivityServices({
    storage: storageAdapter,
    trace: traceAdapter,
    nodeIO: nodeIOAdapter,
    logs: logAdapter,
    secrets: secretsAdapter,
    artifacts: artifactAdapter.factory(),
    terminalStream,
    agentTracePublisher,
  });

  // Initialize human input activity with database, trace and backend URL
  const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:3211';
  initializeHumanInputActivity({
    database: db,
    trace: traceAdapter,
    baseUrl: backendUrl,
  });

  // Initialize trace activity
  initializeTraceActivity({
    trace: traceAdapter,
  });

  console.log(`✅ Service adapters initialized`);

  console.log(`🏗️ Creating Temporal worker...`);
  console.log(
    `   - Activities: ${Object.keys({
      runComponentActivity,
      setRunMetadataActivity,
      finalizeRunActivity,
      prepareRunPayloadActivity,
      createHumanInputRequestActivity,
      cancelHumanInputRequestActivity,
      recordTraceEventActivity,
    }).join(', ')}`,
  );

  console.log(`🔍 Worker Configuration Details:`);
  console.log(`   - Workflows Path: ${workflowsPath}`);
  console.log(
    `   - Activities Count: ${
      Object.keys({
        runComponentActivity,
        setRunMetadataActivity,
        finalizeRunActivity,
        prepareRunPayloadActivity,
      }).length
    }`,
  );
  console.log(`   - Task Queue: ${taskQueue}`);
  console.log(`   - Namespace: ${namespace}`);

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities: {
      runComponentActivity,
      setRunMetadataActivity,
      finalizeRunActivity,
      prepareRunPayloadActivity,
      createHumanInputRequestActivity,
      cancelHumanInputRequestActivity,
      expireHumanInputRequestActivity,
      recordTraceEventActivity,
    },
    bundlerOptions: {
      ignoreModules: ['child_process'],
      webpackConfigHook: (config: any) => {
        // Ensure node-pty native bindings are not bundled (they only load at runtime on the host)
        if (Array.isArray(config?.externals)) {
          config.externals.push({ 'node-pty': 'commonjs node-pty' });
        } else if (typeof config?.externals === 'object' && config.externals !== null) {
          config.externals = {
            ...config.externals,
            'node-pty': 'commonjs node-pty',
          };
        } else {
          config.externals = {
            'node-pty': 'commonjs node-pty',
          };
        }

        // Force webpack to transpile TypeScript with ts-loader instead of swc-loader.
        // swc native bindings can fail to load on some Node/OS combos when installed via Bun.
        try {
          const require = createRequire(import.meta.url);
          if (config?.module?.rules && Array.isArray(config.module.rules)) {
            config.module.rules = config.module.rules.map((rule: any) => {
              const usesSwc =
                typeof rule?.use === 'object' &&
                rule.use?.loader &&
                /swc-loader/.test(String(rule.use.loader));
              const isTsRule = rule && rule.test && rule.test.toString() === /\.ts$/.toString();
              if (usesSwc || isTsRule) {
                return {
                  ...rule,
                  test: /\.ts$/,
                  exclude: /node_modules/,
                  use: {
                    loader: require.resolve('ts-loader'),
                    options: {
                      transpileOnly: true,
                      compilerOptions: { target: 'ES2017' },
                    },
                  },
                };
              }
              return rule;
            });
          }
        } catch (_err) {
          console.warn(
            'Failed to apply webpackConfigHook override; falling back to default SWC loader',
            _err,
          );
        }
        return config;
      },
    },
    // Add worker options to ensure proper task handling
    maxConcurrentWorkflowTaskExecutions: 10,
    maxConcurrentActivityTaskExecutions: 10,
    maxConcurrentLocalActivityExecutions: 10,
    stickyQueueScheduleToStartTimeout: '10m',
  });

  console.log(
    `🚛 Temporal worker ready (namespace=${namespace}, taskQueue=${taskQueue}, workflowsPath=${workflowsPath})`,
  );

  // Log worker capabilities
  console.log(`📋 Worker Capabilities:`);
  console.log(`   - Workflow Tasks: Enabled`);
  console.log(`   - Activity Tasks: Enabled`);
  console.log(`   - Max Concurrent Workflow Tasks: 10`);
  console.log(`   - Max Concurrent Activity Tasks: 10`);
  console.log(`📡 Starting to poll for tasks on queue: ${taskQueue}`);

  // Worker is now ready to receive tasks
  console.log(`📊 Worker successfully created and configured for task processing`);
  console.log(`🎯 Worker will now listen for workflow tasks on queue: ${taskQueue}`);

  console.log(`⏳ Worker is now running and waiting for tasks...`);

  // Set up periodic status logging
  setInterval(() => {
    console.log(
      `💓 Worker heartbeat - Still polling on queue: ${taskQueue} (${new Date().toISOString()})`,
    );

    // Log worker stats to see if we're receiving any tasks
    console.log(`📊 Worker stats check:`, {
      taskQueue,
      namespace,
      timestamp: new Date().toISOString(),
      workerBuildId: worker.options.buildId || 'default',
    });
  }, 15000); // Log every 15 seconds for better debugging

  console.log(`🚀 Starting worker.run() - this will block and listen for tasks...`);
  await worker.run();
}

main().catch((error) => {
  console.error('💥 Temporal worker failed to start:', {
    error: error.message,
    stack: error.stack,
    code: error.code,
    details: error.details,
  });
  process.exit(1);
});

async function ensureTemporalNamespace(connection: NativeConnection, namespace: string) {
  try {
    await connection.workflowService.describeNamespace({ namespace });
    console.log(`✅ Temporal namespace "${namespace}" is ready`);
    return;
  } catch (error) {
    if (!(isGrpcServiceError(error) && error.code === grpcStatus.NOT_FOUND)) {
      throw error;
    }
  }

  console.warn(`⚠️ Temporal namespace "${namespace}" not found; attempting to create it`);

  try {
    const defaultRetentionDays = 7;
    await connection.workflowService.registerNamespace({
      namespace,
      workflowExecutionRetentionPeriod: {
        seconds: Long.fromNumber(defaultRetentionDays * 24 * 60 * 60),
        nanos: 0,
      },
    });
    console.log(`✅ Temporal namespace "${namespace}" created`);
  } catch (error) {
    if (isGrpcServiceError(error) && error.code === grpcStatus.ALREADY_EXISTS) {
      console.log(`✅ Temporal namespace "${namespace}" already exists`);
      return;
    }
    throw error;
  }
}

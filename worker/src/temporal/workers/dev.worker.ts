import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { Pool } from 'pg';
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
  FileStorageAdapter,
  LokiLogAdapter,
  LokiLogClient,
  SecretsAdapter,
  TraceAdapter,
} from '../../adapters';
import * as schema from '../../adapters/schema';

// Load environment variables from .env file
config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../..', '.env') });

async function main() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? 'shipsec-default';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'shipsec-dev';
  const workflowsPath = join(dirname(fileURLToPath(import.meta.url)), '../workflows');

  console.log(`🔌 Connecting to Temporal at ${address}...`);

  // Create connection first
  const connection = await NativeConnection.connect({
    address,
  });

  console.log(`✅ Connected to Temporal`);

  await ensureTemporalNamespace(connection, namespace);

  // Initialize database connection for worker
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
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
  const traceAdapter = new TraceAdapter(db);
  const secretsAdapter = new SecretsAdapter();

  const lokiUrl = process.env.LOKI_URL;
  let logAdapter: LokiLogAdapter | undefined;
  if (lokiUrl) {
    try {
      const lokiClient = new LokiLogClient({
        baseUrl: lokiUrl,
        tenantId: process.env.LOKI_TENANT_ID,
        username: process.env.LOKI_USERNAME,
        password: process.env.LOKI_PASSWORD,
      });
      logAdapter = new LokiLogAdapter(lokiClient, db);
      console.log(`✅ Loki logging enabled (${lokiUrl})`);
    } catch (error) {
      console.error('⚠️ Failed to initialize Loki logging, continuing without it', error);
    }
  } else {
    console.warn('⚠️ LOKI_URL not set; Loki log streaming disabled');
  }

  // Initialize global services for activities
  initializeComponentActivityServices({
    storage: storageAdapter,
    trace: traceAdapter,
    logs: logAdapter,
    secrets: secretsAdapter,
  });

  console.log(`✅ Service adapters initialized`);

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities: {
      runComponentActivity,
      setRunMetadataActivity,
      finalizeRunActivity,
    },
  });

  console.log(
    `🚛 Temporal worker ready (namespace=${namespace}, taskQueue=${taskQueue}, workflowsPath=${workflowsPath})`,
  );
  console.log(`📡 Polling for tasks on queue: ${taskQueue}`);

  await worker.run();
}

main().catch((error) => {
  console.error('Temporal worker failed', error);
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

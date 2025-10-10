import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'minio';
import { Worker, NativeConnection } from '@temporalio/worker';
import { config } from 'dotenv';
import { runWorkflowActivity, initializeActivityServices } from '../activities/run-workflow.activity';
import { FileStorageAdapter, TraceAdapter } from '../../adapters';
import * as schema from '../../adapters/schema/files.schema';

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
  const traceAdapter = new TraceAdapter();

  // Initialize global services for activities
  initializeActivityServices(storageAdapter, traceAdapter);

  console.log(`✅ Service adapters initialized`);

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities: {
      runWorkflowActivity,
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


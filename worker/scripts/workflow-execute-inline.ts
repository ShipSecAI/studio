import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { config } from 'dotenv';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

import '../src/components';
import { executeWorkflow } from '../src/temporal/workflow-runner';
import type { WorkflowDefinition } from '../src/temporal/types';
import { FileStorageAdapter, TraceAdapter } from '../src/adapters';
import * as schema from '../src/adapters/schema';

async function loadDefinition(pool: Pool, workflowId: string): Promise<WorkflowDefinition> {
  const { rows } = await pool.query<{ compiled_definition: WorkflowDefinition | null }>(
    'SELECT compiled_definition FROM workflows WHERE id=$1',
    [workflowId],
  );
  const definition = rows[0]?.compiled_definition;
  if (!definition) {
    throw new Error(`Workflow ${workflowId} has no compiled definition`);
  }
  return definition;
}

async function main() {
  const workflowId = process.argv[2] ?? 'f38c93d7-e0fb-47b1-bbfc-fdb6cd19a325';
  const fileId = process.argv[3] ?? '3a21f08e-5ea1-47fd-b0f8-3a057ce24321';

  const __dirname = dirname(fileURLToPath(import.meta.url));
  config({ path: join(__dirname, '..', '.env') });

  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://shipsec:shipsec@localhost:5433/shipsec';
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  const minioBucket = process.env.MINIO_BUCKET_NAME ?? 'shipsec-files';
  const minioEndpoint = process.env.MINIO_ENDPOINT ?? 'localhost';
  const minioPort = parseInt(process.env.MINIO_PORT ?? '9000', 10);
  const minioAccessKey = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
  const minioSecretKey = process.env.MINIO_SECRET_KEY ?? 'minioadmin';
  const minioUseSSL = process.env.MINIO_USE_SSL === 'true';

  const { Client: MinioClient } = await import('minio');
  const minioClient = new MinioClient({
    endPoint: minioEndpoint,
    port: minioPort,
    useSSL: minioUseSSL,
    accessKey: minioAccessKey,
    secretKey: minioSecretKey,
  });

  const storage = new FileStorageAdapter(minioClient, db, minioBucket);
  const trace = new TraceAdapter(db);

  const definition = await loadDefinition(pool, workflowId);

  const runId = `inline-${randomUUID()}`;
  trace.setRunMetadata(runId, { workflowId });
  const result = await executeWorkflow(
    definition,
    { inputs: { input1: fileId } },
    { runId, storage, trace },
  );

  console.log(JSON.stringify({ runId, result }, null, 2));

  trace.finalizeRun(runId);

  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

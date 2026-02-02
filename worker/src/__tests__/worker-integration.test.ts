import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { NativeConnection } from '@temporalio/worker';
import { Client } from '@temporalio/client';
import { Client as MinioClient } from 'minio';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { FileStorageAdapter } from '../adapters/file-storage.adapter';
import * as schema from '../adapters/schema';
import '../components'; // Register all components

const enableWorkerIntegration =
  process.env.ENABLE_WORKER_INTEGRATION_TESTS === 'true' ||
  process.env.RUN_WORKER_INTEGRATION_TESTS === 'true';
const workerDescribe = enableWorkerIntegration ? describe : describe.skip;

if (!enableWorkerIntegration) {
  console.warn(
    'Skipping worker integration tests. Set ENABLE_WORKER_INTEGRATION_TESTS=true (or RUN_WORKER_INTEGRATION_TESTS=true) to enable.',
  );
}

workerDescribe('Worker Integration Tests', () => {
  let temporalClient: Client;
  let minioClient: MinioClient;
  let pool: Pool;
  let fileStorageAdapter: FileStorageAdapter;
  let db: NodePgDatabase<typeof schema>;

  // Use the test task queue - tests submit workflows to the test worker (pm2: shipsec-test-worker)
  // Main worker uses 'shipsec-default', test worker uses 'test-worker-integration'
  const taskQueue = 'test-worker-integration';
  const testNamespace = process.env.TEMPORAL_NAMESPACE || 'shipsec-dev';

  beforeAll(async () => {
    console.log('🚀 Starting worker integration test setup...');
    console.log(`   Task Queue: ${taskQueue}`);
    console.log(`   Namespace: ${testNamespace}`);

    // Connect to Temporal (running in docker-compose)
    temporalClient = new Client({
      connection: await NativeConnection.connect({
        address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      }),
      namespace: testNamespace,
    });

    // Initialize MinIO
    minioClient = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    });

    // Initialize PostgreSQL
    const connectionString =
      process.env.DATABASE_URL || 'postgresql://shipsec:shipsec@localhost:5433/shipsec';
    pool = new Pool({ connectionString });
    db = drizzle(pool, { schema });

    // Initialize adapters
    const bucketName = process.env.MINIO_BUCKET_NAME || 'shipsec-files';
    fileStorageAdapter = new FileStorageAdapter(minioClient, db, bucketName);

    // Ensure bucket exists
    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName, 'us-east-1');
    }

    console.log('✅ Worker integration test setup complete');
    console.log(`   Tests will submit workflows to: ${taskQueue} queue`);
    console.log('   Note: Worker should be running via pm2\n');
  });

  afterAll(async () => {
    await pool.end();
    temporalClient.connection.close();
    console.log('✅ Worker integration test teardown complete');
  });

  describe('Workflow Execution', () => {
    it('should execute a simple workflow with trigger component', async () => {
      // Import workflow function dynamically
      const { shipsecWorkflowRun } = await import('../temporal/workflows');

      // Create a minimal workflow DSL
      const workflowDSL = {
        version: 1,
        title: 'Test Workflow',
        description: 'Integration test workflow',
        config: {
          environment: 'test',
          timeoutSeconds: 30,
        },
        entrypoint: {
          ref: 'trigger',
        },
        nodes: {
          trigger: { ref: 'trigger' },
        },
        edges: [],
        dependencyCounts: {
          trigger: 0,
        },
        actions: [
          {
            ref: 'trigger',
            componentId: 'core.workflow.entrypoint',
            params: {
              payload: {
                test: true,
                message: 'Integration test',
              },
            },
            inputOverrides: {},
            dependsOn: [],
            inputMappings: {},
          },
        ],
      };

      const workflowId = `test-workflow-${randomUUID()}`;
      const runId = `test-run-${randomUUID()}`;

      // Start workflow
      const handle = await temporalClient.workflow.start(shipsecWorkflowRun, {
        taskQueue,
        workflowId,
        args: [
          {
            runId,
            workflowId,
            definition: workflowDSL,
            inputs: {},
          },
        ],
      });

      // Wait for result (with timeout)
      const result = await handle.result();

      // Verify result
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.outputs).toBeDefined();
      expect((result.outputs as any).trigger).toEqual({});
    });

    it('should inject services into components during execution', async () => {
      const { shipsecWorkflowRun } = await import('../temporal/workflows');

      // Upload a test file first
      const fileId = randomUUID();
      const fileName = 'integration-test.txt';
      const content = 'Integration test file content';
      const buffer = Buffer.from(content);

      await fileStorageAdapter.uploadFile(fileId, fileName, buffer, 'text/plain');

      // Create workflow that uses file-loader
      const workflowDSL = {
        version: 1,
        title: 'File Loader Test',
        description: 'Test service injection',
        config: {
          environment: 'test',
          timeoutSeconds: 30,
        },
        entrypoint: {
          ref: 'trigger',
        },
        nodes: {
          trigger: { ref: 'trigger' },
          loader: { ref: 'loader' },
        },
        edges: [
          {
            id: 'trigger->loader',
            sourceRef: 'trigger',
            targetRef: 'loader',
            kind: 'success' as const,
          },
        ],
        dependencyCounts: {
          trigger: 0,
          loader: 1,
        },
        actions: [
          {
            ref: 'trigger',
            componentId: 'core.workflow.entrypoint',
            params: {},
            inputOverrides: {},
            dependsOn: [],
            inputMappings: {},
          },
          {
            ref: 'loader',
            componentId: 'core.file.loader',
            params: {
              fileId,
            },
            inputOverrides: {},
            dependsOn: ['trigger'],
            inputMappings: {},
          },
        ],
      };

      const workflowId = `test-file-workflow-${randomUUID()}`;
      const runId = `test-file-run-${randomUUID()}`;

      // Start workflow
      const handle = await temporalClient.workflow.start(shipsecWorkflowRun, {
        taskQueue,
        workflowId,
        args: [
          {
            runId,
            workflowId,
            definition: workflowDSL,
            inputs: {},
          },
        ],
      });

      // Wait for result
      const result = await handle.result();

      // Verify file was loaded
      expect(result.success).toBe(true);
      const loader = (result.outputs as any).loader;
      expect(loader).toBeDefined();
      expect(loader.file).toBeDefined();
      expect(loader.file.id).toBe(fileId);
      expect(loader.file.name).toBe(fileName);
      expect(loader.file.mimeType).toBe('text/plain');
      expect(loader.file.size).toBe(buffer.length);

      // Content should be base64 encoded
      const decodedContent = Buffer.from(loader.file.content, 'base64').toString();
      expect(decodedContent).toBe(content);
      expect(loader.textContent).toBe(content);

      // Cleanup
      await minioClient.removeObject(process.env.MINIO_BUCKET_NAME || 'shipsec-files', fileId);
    }, 60000);

    it('should handle workflow failures gracefully', async () => {
      const { shipsecWorkflowRun } = await import('../temporal/workflows');

      // Create workflow with non-existent file (valid UUID format)
      const nonExistentFileId = randomUUID();

      const workflowDSL = {
        version: 1,
        title: 'Failing Workflow',
        description: 'Test error handling',
        config: {
          environment: 'test',
          timeoutSeconds: 30,
        },
        entrypoint: {
          ref: 'loader',
        },
        nodes: {
          loader: { ref: 'loader' },
        },
        edges: [],
        dependencyCounts: {
          loader: 0,
        },
        actions: [
          {
            ref: 'loader',
            componentId: 'core.file.loader',
            params: {
              fileId: nonExistentFileId,
            },
            inputOverrides: {},
            dependsOn: [],
            inputMappings: {},
          },
        ],
      };

      const workflowId = `test-fail-workflow-${randomUUID()}`;
      const runId = `test-fail-run-${randomUUID()}`;

      // Start workflow
      const handle = await temporalClient.workflow.start(shipsecWorkflowRun, {
        taskQueue,
        workflowId,
        args: [
          {
            runId,
            workflowId,
            definition: workflowDSL,
            inputs: {},
          },
        ],
      });

      // Wait for result - should fail
      const result = await handle.result();

      // Verify failure is captured
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // Error should mention file not being found
      expect(
        result.error?.includes('not found') ||
          result.error?.includes('does not exist') ||
          result.error?.includes('NotFound'),
      ).toBe(true);
    }, 60000);

    it('should execute multi-step workflow with dependencies', async () => {
      const { shipsecWorkflowRun } = await import('../temporal/workflows');

      // Create workflow with multiple steps
      const workflowDSL = {
        version: 1,
        title: 'Multi-Step Workflow',
        description: 'Test dependency execution',
        config: {
          environment: 'test',
          timeoutSeconds: 30,
        },
        entrypoint: {
          ref: 'trigger',
        },
        nodes: {
          trigger: { ref: 'trigger' },
          step2: { ref: 'step2' },
          step3: { ref: 'step3' },
        },
        edges: [
          {
            id: 'trigger->step2',
            sourceRef: 'trigger',
            targetRef: 'step2',
            kind: 'success' as const,
          },
          {
            id: 'step2->step3',
            sourceRef: 'step2',
            targetRef: 'step3',
            kind: 'success' as const,
          },
        ],
        dependencyCounts: {
          trigger: 0,
          step2: 1,
          step3: 1,
        },
        actions: [
          {
            ref: 'trigger',
            componentId: 'core.workflow.entrypoint',
            params: {
              payload: { step: 1 },
            },
            inputOverrides: {},
            dependsOn: [],
            inputMappings: {},
          },
          {
            ref: 'step2',
            componentId: 'core.workflow.entrypoint',
            params: {
              payload: { step: 2 },
            },
            inputOverrides: {},
            dependsOn: ['trigger'],
            inputMappings: {},
          },
          {
            ref: 'step3',
            componentId: 'core.workflow.entrypoint',
            params: {
              payload: { step: 3 },
            },
            inputOverrides: {},
            dependsOn: ['step2'],
            inputMappings: {},
          },
        ],
      };

      const workflowId = `test-multi-workflow-${randomUUID()}`;
      const runId = `test-multi-run-${randomUUID()}`;

      // Start workflow
      const handle = await temporalClient.workflow.start(shipsecWorkflowRun, {
        taskQueue,
        workflowId,
        args: [
          {
            runId,
            workflowId,
            definition: workflowDSL,
            inputs: {},
          },
        ],
      });

      // Wait for result
      const result = await handle.result();

      // Verify all steps executed
      expect(result.success).toBe(true);
      const outputs = result.outputs as any;
      expect(outputs.trigger).toEqual({});
      expect(outputs.step2).toEqual({});
      expect(outputs.step3).toEqual({});
    }, 60000);

    it('should route error edges when an activity fails', async () => {
      const { shipsecWorkflowRun } = await import('../temporal/workflows');

      const missingFileId = randomUUID();

      const workflowDSL = {
        version: 1,
        title: 'Error Edge Workflow',
        description: 'Failure should schedule error handler',
        config: {
          environment: 'test',
          timeoutSeconds: 30,
        },
        entrypoint: {
          ref: 'trigger',
        },
        nodes: {
          trigger: { ref: 'trigger' },
          willFail: { ref: 'willFail' },
          errorHandler: { ref: 'errorHandler' },
        },
        edges: [
          {
            id: 'trigger->willFail',
            sourceRef: 'trigger',
            targetRef: 'willFail',
            kind: 'success' as const,
          },
          {
            id: 'willFail->errorHandler',
            sourceRef: 'willFail',
            targetRef: 'errorHandler',
            kind: 'error' as const,
          },
        ],
        dependencyCounts: {
          trigger: 0,
          willFail: 1,
          errorHandler: 0,
        },
        actions: [
          {
            ref: 'trigger',
            componentId: 'core.workflow.entrypoint',
            params: {},
            inputOverrides: {},
            dependsOn: [],
            inputMappings: {},
          },
          {
            ref: 'willFail',
            componentId: 'core.file.loader',
            params: { fileId: missingFileId },
            inputOverrides: {},
            dependsOn: ['trigger'],
            inputMappings: {},
          },
          {
            ref: 'errorHandler',
            componentId: 'core.console.log',
            params: {
              data: 'handled upstream failure',
              label: 'error-handler',
            },
            inputOverrides: {},
            dependsOn: [],
            inputMappings: {},
          },
        ],
      };

      const workflowId = `error-edge-workflow-${randomUUID()}`;
      const runId = `error-edge-run-${randomUUID()}`;

      const handle = await temporalClient.workflow.start(shipsecWorkflowRun, {
        taskQueue,
        workflowId,
        args: [
          {
            runId,
            workflowId,
            definition: workflowDSL,
            inputs: {},
          },
        ],
      });

      const result = await handle.result();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 500));

      const traces = await db
        .select()
        .from(schema.workflowTraces)
        .where(eq(schema.workflowTraces.runId, runId))
        .orderBy(schema.workflowTraces.sequence);

      const failureEvent = traces.find(
        (trace) => trace.nodeRef === 'willFail' && trace.type === 'NODE_FAILED',
      );

      expect(failureEvent).toBeDefined();
      expect(failureEvent?.error ?? '').toMatch(/not found|does not exist|NotFound/i);
    }, 60000);

    it('should persist ordered traces for parallel branches', async () => {
      const { shipsecWorkflowRun } = await import('../temporal/workflows');

      const workflowDSL = {
        version: 1,
        title: 'Trace Order Workflow',
        description: 'Ensures trace events remain ordered across concurrent branches',
        config: {
          environment: 'test',
          timeoutSeconds: 30,
        },
        entrypoint: {
          ref: 'trigger',
        },
        nodes: {
          trigger: { ref: 'trigger' },
          branchA: { ref: 'branchA' },
          branchB: { ref: 'branchB' },
        },
        edges: [
          {
            id: 'trigger->branchA',
            sourceRef: 'trigger',
            targetRef: 'branchA',
            kind: 'success' as const,
          },
          {
            id: 'trigger->branchB',
            sourceRef: 'trigger',
            targetRef: 'branchB',
            kind: 'success' as const,
          },
        ],
        dependencyCounts: {
          trigger: 0,
          branchA: 1,
          branchB: 1,
        },
        actions: [
          {
            ref: 'trigger',
            componentId: 'core.workflow.entrypoint',
            params: {},
            inputOverrides: {},
            dependsOn: [],
            inputMappings: {},
          },
          {
            ref: 'branchA',
            componentId: 'core.console.log',
            params: { data: 'branchA' },
            inputOverrides: {},
            dependsOn: ['trigger'],
            inputMappings: {},
          },
          {
            ref: 'branchB',
            componentId: 'core.console.log',
            params: { data: 'branchB' },
            inputOverrides: {},
            dependsOn: ['trigger'],
            inputMappings: {},
          },
        ],
      };

      const workflowId = `trace-order-workflow-${randomUUID()}`;
      const runId = `trace-order-run-${randomUUID()}`;

      const handle = await temporalClient.workflow.start(shipsecWorkflowRun, {
        taskQueue,
        workflowId,
        args: [
          {
            runId,
            workflowId,
            definition: workflowDSL,
            inputs: {},
          },
        ],
      });

      const result = await handle.result();
      expect(result.success).toBe(true);

      // allow asynchronous persistence to flush
      await new Promise((resolve) => setTimeout(resolve, 500));

      const traces = await db
        .select()
        .from(schema.workflowTraces)
        .where(eq(schema.workflowTraces.runId, runId))
        .orderBy(schema.workflowTraces.sequence);

      expect(traces.length).toBeGreaterThanOrEqual(6);

      const sequences = traces.map((trace) => trace.sequence);
      sequences.forEach((sequence, index) => {
        expect(sequence).toBe(index + 1);
      });

      const completedNodes = new Set(
        traces.filter((trace) => trace.type === 'NODE_COMPLETED').map((trace) => trace.nodeRef),
      );

      expect(completedNodes.has('branchA')).toBe(true);
      expect(completedNodes.has('branchB')).toBe(true);
    }, 60000);
  });

  describe('Worker Connection and Setup', () => {
    it('should verify Temporal server is reachable', async () => {
      // Try to get server info
      const connection = temporalClient.connection;
      expect(connection).toBeDefined();

      // Verify we can list workflows (even if empty)
      const workflows = temporalClient.workflow.list();
      let count = 0;
      for await (const _workflow of workflows) {
        count++;
        if (count > 10) break; // Just verify we can iterate
      }

      // If we get here without errors, connection is good
      expect(true).toBe(true);
    });

    it('should verify database connection is working', async () => {
      // Simple query to verify DB is accessible
      const result = await pool.query('SELECT NOW()');
      expect(result.rows).toBeDefined();
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should verify MinIO connection is working', async () => {
      const bucketName = process.env.MINIO_BUCKET_NAME || 'shipsec-files';
      const exists = await minioClient.bucketExists(bucketName);

      // Either bucket exists or we can create it
      if (!exists) {
        await minioClient.makeBucket(bucketName, 'us-east-1');
      }

      const finalCheck = await minioClient.bucketExists(bucketName);
      expect(finalCheck).toBe(true);
    });
  });
});

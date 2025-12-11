import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promises as fs } from 'node:fs';

import { config } from 'dotenv';
import { Pool } from 'pg';
import { Connection, Client } from '@temporalio/client';

import type { WorkflowDefinition } from '../src/temporal/types';
import { shipsecWorkflowRun } from '../src/temporal/workflows';
import '../src/components';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://shipsec:shipsec@localhost:5433/shipsec';
const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'shipsec-dev';
const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? 'shipsec-default';

const OUTPUT_DIR = join(__dirname, '..', 'benchmarks');

const longLivedDefinition: WorkflowDefinition = {
  version: 1,
  title: 'Long Lived Workflow',
  description: 'Sequential chain of delayed activities to exercise trace/log pipeline.',
  entrypoint: { ref: 'start' },
  config: {
    environment: 'test',
    timeoutSeconds: 900,
  },
  nodes: {
    start: { ref: 'start', label: 'Start' },
    step1: { ref: 'step1', label: 'Step 1' },
    step2: { ref: 'step2', label: 'Step 2' },
    step3: { ref: 'step3', label: 'Step 3' },
    step4: { ref: 'step4', label: 'Step 4' },
    step5: { ref: 'step5', label: 'Step 5' },
    step6: { ref: 'step6', label: 'Step 6' },
    step7: { ref: 'step7', label: 'Step 7' },
    step8: { ref: 'step8', label: 'Step 8' },
    step9: { ref: 'step9', label: 'Step 9' },
    step10: { ref: 'step10', label: 'Step 10' },
  },
  edges: [
    { id: 'start->step1', sourceRef: 'start', targetRef: 'step1', kind: 'success' },
    { id: 'step1->step2', sourceRef: 'step1', targetRef: 'step2', kind: 'success' },
    { id: 'step2->step3', sourceRef: 'step2', targetRef: 'step3', kind: 'success' },
    { id: 'step3->step4', sourceRef: 'step3', targetRef: 'step4', kind: 'success' },
    { id: 'step4->step5', sourceRef: 'step4', targetRef: 'step5', kind: 'success' },
    { id: 'step5->step6', sourceRef: 'step5', targetRef: 'step6', kind: 'success' },
    { id: 'step6->step7', sourceRef: 'step6', targetRef: 'step7', kind: 'success' },
    { id: 'step7->step8', sourceRef: 'step7', targetRef: 'step8', kind: 'success' },
    { id: 'step8->step9', sourceRef: 'step8', targetRef: 'step9', kind: 'success' },
    { id: 'step9->step10', sourceRef: 'step9', targetRef: 'step10', kind: 'success' },
  ],
  dependencyCounts: {
    start: 0,
    step1: 1,
    step2: 1,
    step3: 1,
    step4: 1,
    step5: 1,
    step6: 1,
    step7: 1,
    step8: 1,
    step9: 1,
    step10: 1,
  },
  actions: [
    {
      ref: 'start',
      componentId: 'core.workflow.entrypoint',
      params: {},
      dependsOn: [],
      inputMappings: {},
    },
    ...Array.from({ length: 10 }, (_, index) => index + 1).map((idx) => ({
      ref: `step${idx}`,
      componentId: 'test.sleep.parallel',
      params: { delay: 200 + idx * 50, label: `step-${idx}` },
      dependsOn: [idx === 1 ? 'start' : `step${idx - 1}`],
      inputMappings: {},
    })),
  ],
};

type TraceRow = {
  sequence: number;
  node_ref: string;
  type: string;
  timestamp: string;
  level: string;
  message?: string | null;
  error?: string | null;
};

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function collectTraces(pool: Pool, runId: string): Promise<TraceRow[]> {
  const result = await pool.query<TraceRow>(
    `SELECT sequence, node_ref, type, timestamp, level, message, error
     FROM workflow_traces
     WHERE run_id = $1
     ORDER BY sequence ASC`,
    [runId],
  );

  return result.rows;
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: TEMPORAL_NAMESPACE });

  try {
    const runId = `long-lived-${randomUUID()}`;
    console.log(`Starting long-lived workflow ${runId}`);
    const start = Date.now();

    const handle = await client.workflow.start(shipsecWorkflowRun, {
      workflowId: runId,
      taskQueue: TEMPORAL_TASK_QUEUE,
      args: [
        {
          runId,
          workflowId: 'long-lived-synthetic',
          definition: longLivedDefinition,
          inputs: {},
        },
      ],
    });

    const result = await handle.result();
    const durationMs = Date.now() - start;
    console.log(`Workflow completed in ${durationMs}ms`);

    const traces = await collectTraces(pool, runId);
    await ensureOutputDir();
    const snapshotPath = join(OUTPUT_DIR, `long-lived-trace-${runId}.json`);
    await fs.writeFile(
      snapshotPath,
      JSON.stringify({ runId, durationMs, completed: result, traces }, null, 2),
      'utf8',
    );

    console.log(`Trace snapshot written to ${snapshotPath}`);
    console.log(`Trace events captured: ${traces.length}`);
  } finally {
    await client.connection.close();
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Failed to execute long-lived workflow', err);
    process.exit(1);
  });
}

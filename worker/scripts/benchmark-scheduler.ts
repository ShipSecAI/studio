import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promises as fs } from 'node:fs';

import { config } from 'dotenv';
import { Connection, Client } from '@temporalio/client';

import type { WorkflowDefinition } from '../src/temporal/types';
import { shipsecWorkflowRun } from '../src/temporal/workflows';
import { executeWorkflow } from '../src/temporal/workflow-runner';
import '../src/components';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? 'shipsec-dev';
const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? 'shipsec-default';
const OUTPUT_DIR = join(__dirname, '..', 'benchmarks');

type BenchmarkMode = 'serial' | 'parallel';
type BenchmarkEngine = 'inline' | 'temporal';

interface BenchmarkResult {
  engine: BenchmarkEngine;
  mode: BenchmarkMode;
  runs: number;
  durations: number[];
  averageMs: number;
}

const serialDefinition: WorkflowDefinition = {
  version: 1,
  title: 'Serial Benchmark Workflow',
  description: 'Three sequential steps executed one after the other',
  entrypoint: { ref: 'start' },
  config: {
    environment: 'test',
    timeoutSeconds: 120,
  },
  nodes: {
    start: { ref: 'start' },
    stepA: { ref: 'stepA' },
    stepB: { ref: 'stepB' },
    stepC: { ref: 'stepC' },
  },
  edges: [
    { id: 'start->stepA', sourceRef: 'start', targetRef: 'stepA', kind: 'success' },
    { id: 'stepA->stepB', sourceRef: 'stepA', targetRef: 'stepB', kind: 'success' },
    { id: 'stepB->stepC', sourceRef: 'stepB', targetRef: 'stepC', kind: 'success' },
  ],
  dependencyCounts: {
    start: 0,
    stepA: 1,
    stepB: 1,
    stepC: 1,
  },
  actions: [
    { ref: 'start', componentId: 'core.workflow.entrypoint', params: {}, dependsOn: [], inputMappings: {} },
    { ref: 'stepA', componentId: 'test.sleep.parallel', params: { delay: 150, label: 'A' }, dependsOn: ['start'], inputMappings: {} },
    { ref: 'stepB', componentId: 'test.sleep.parallel', params: { delay: 150, label: 'B' }, dependsOn: ['stepA'], inputMappings: {} },
    { ref: 'stepC', componentId: 'test.sleep.parallel', params: { delay: 150, label: 'C' }, dependsOn: ['stepB'], inputMappings: {} },
  ],
};

const parallelDefinition: WorkflowDefinition = {
  version: 1,
  title: 'Parallel Benchmark Workflow',
  description: 'Two branches executed concurrently before merging',
  entrypoint: { ref: 'start' },
  config: {
    environment: 'test',
    timeoutSeconds: 120,
  },
  nodes: {
    start: { ref: 'start' },
    branch1: { ref: 'branch1' },
    branch2: { ref: 'branch2' },
    merge: { ref: 'merge', joinStrategy: 'all' },
  },
  edges: [
    { id: 'start->branch1', sourceRef: 'start', targetRef: 'branch1', kind: 'success' },
    { id: 'start->branch2', sourceRef: 'start', targetRef: 'branch2', kind: 'success' },
    { id: 'branch1->merge', sourceRef: 'branch1', targetRef: 'merge', kind: 'success' },
    { id: 'branch2->merge', sourceRef: 'branch2', targetRef: 'merge', kind: 'success' },
  ],
  dependencyCounts: {
    start: 0,
    branch1: 1,
    branch2: 1,
    merge: 2,
  },
  actions: [
    { ref: 'start', componentId: 'core.workflow.entrypoint', params: {}, dependsOn: [], inputMappings: {} },
    { ref: 'branch1', componentId: 'test.sleep.parallel', params: { delay: 150, label: 'branch-1' }, dependsOn: ['start'], inputMappings: {} },
    { ref: 'branch2', componentId: 'test.sleep.parallel', params: { delay: 150, label: 'branch-2' }, dependsOn: ['start'], inputMappings: {} },
    { ref: 'merge', componentId: 'core.console.log', params: { data: 'merge complete' }, dependsOn: ['branch1', 'branch2'], inputMappings: {} },
  ],
};

async function runTemporalBenchmark(
  client: Client,
  definition: WorkflowDefinition,
  iterations: number,
  label: BenchmarkMode,
): Promise<BenchmarkResult> {
  const durations: number[] = [];

  for (let i = 0; i < iterations; i += 1) {
    const runId = `${label}-${randomUUID()}`;
    const start = Date.now();

    const handle = await client.workflow.start(shipsecWorkflowRun, {
      workflowId: runId,
      taskQueue: TEMPORAL_TASK_QUEUE,
      args: [
        {
          runId,
          workflowId: `benchmark-${label}`,
          definition,
          inputs: {},
        },
      ],
    });

    await handle.result();
    durations.push(Date.now() - start);
  }

  const averageMs = durations.reduce((sum, value) => sum + value, 0) / durations.length;

  return {
    engine: 'temporal',
    mode: label,
    runs: iterations,
    durations,
    averageMs,
  };
}

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function runInlineBenchmark(
  definition: WorkflowDefinition,
  iterations: number,
  label: BenchmarkMode,
): Promise<BenchmarkResult> {
  const durations: number[] = [];

  for (let i = 0; i < iterations; i += 1) {
    const runId = `${label}-inline-${randomUUID()}`;
    const start = Date.now();

    const result = await executeWorkflow(definition, {}, { runId });
    if (!result.success) {
      throw new Error(`Inline benchmark ${label} failed: ${result.error}`);
    }

    durations.push(Date.now() - start);
  }

  const averageMs = durations.reduce((sum, value) => sum + value, 0) / durations.length;

  return {
    engine: 'inline',
    mode: label,
    runs: iterations,
    durations,
    averageMs,
  };
}

async function main() {
  const iterations = Number.parseInt(process.env.BENCHMARK_ITERATIONS ?? '3', 10);

  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  const client = new Client({ connection, namespace: TEMPORAL_NAMESPACE });

  try {
    console.log(`Running benchmark with ${iterations} iteration(s) per mode...`);

    const inlineSerial = await runInlineBenchmark(serialDefinition, iterations, 'serial');
    const inlineParallel = await runInlineBenchmark(parallelDefinition, iterations, 'parallel');
    const temporalSerial = await runTemporalBenchmark(client, serialDefinition, iterations, 'serial');
    const temporalParallel = await runTemporalBenchmark(
      client,
      parallelDefinition,
      iterations,
      'parallel',
    );

    const summaryRows = [inlineSerial, inlineParallel, temporalSerial, temporalParallel].map(
      (result) => ({
        Engine: result.engine,
        Mode: result.mode,
        Runs: result.runs,
        'Average (ms)': result.averageMs.toFixed(2),
      }),
    );

    console.table(summaryRows);

    await ensureOutputDir();
    const snapshotPath = join(
      OUTPUT_DIR,
      `scheduler-benchmark-${Date.now()}.json`,
    );
    await fs.writeFile(
      snapshotPath,
      JSON.stringify(
        {
          iterations,
          inline: {
            serial: inlineSerial,
            parallel: inlineParallel,
          },
          temporal: {
            serial: temporalSerial,
            parallel: temporalParallel,
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`Benchmark snapshot written to ${snapshotPath}`);
  } finally {
    await client.connection.close();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Benchmark run failed', err);
    process.exit(1);
  });
}

import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { config } from 'dotenv';
import { Pool } from 'pg';
import { Connection, Client } from '@temporalio/client';

import type { WorkflowDefinition } from '../src/temporal/types';
import { shipsecWorkflowRun } from '../src/temporal/workflows';

type ListEntry = {
  workflowId: string;
  runId: string;
  status: string;
  startTime: string;
  closeTime?: string;
  inputs?: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

function parseArgs() {
  const args = process.argv.slice(2);
  let workflowRecordId: string | undefined;
  let fileId: string | undefined;
  let limit = 5;
  let shouldRun = false;
  let list = true;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--workflow':
        workflowRecordId = args[++i];
        break;
      case '--file':
        fileId = args[++i];
        break;
      case '--limit':
        limit = Number.parseInt(args[++i] ?? '', 10) || limit;
        break;
      case '--run':
        shouldRun = true;
        break;
      case '--no-list':
        list = false;
        break;
      default:
        console.warn(`Unknown arg: ${arg}`);
    }
  }

  if (!workflowRecordId) {
    throw new Error('Missing required --workflow <id>');
  }

  if (shouldRun && !fileId) {
    throw new Error('Running workflow requires --file <fileId>');
  }

  return {
    workflowRecordId,
    fileId,
    limit,
    shouldRun,
    list,
  };
}

async function loadDefinition(pool: Pool, workflowRecordId: string): Promise<WorkflowDefinition> {
  const { rows } = await pool.query<{ compiled_definition: WorkflowDefinition | null }>(
    'SELECT compiled_definition FROM workflows WHERE id=$1',
    [workflowRecordId],
  );

  const definition = rows[0]?.compiled_definition;
  if (!definition) {
    throw new Error(`Workflow ${workflowRecordId} has no compiled definition`);
  }

  return definition;
}

async function listRuns(
  client: Client,
  workflowRecordId: string,
  definition: WorkflowDefinition,
  limit: number,
): Promise<ListEntry[]> {
  const runs: ListEntry[] = [];
  const maxMatches = Math.max(limit * 3, limit);

  const subfinderRef = definition.actions.find((action) => action.componentId === 'shipsec.subfinder.run')?.ref;
  const query = 'WorkflowType = "shipsecWorkflowRun"';

  for await (const info of client.workflow.list({ query, pageSize: 50 })) {
    if (runs.length >= maxMatches) {
      break;
    }

    const handle = client.workflow.getHandle(info.workflowId, info.runId);
    const history = await handle.fetchHistory();
    const events = history.events ?? [];
    const startedEvent = events.find((event) => event.workflowExecutionStartedEventAttributes);

    if (!startedEvent || !startedEvent.workflowExecutionStartedEventAttributes) {
      continue;
    }

    const { workflowExecutionStartedEventAttributes } = startedEvent;
    const payloads = workflowExecutionStartedEventAttributes.input?.payloads ?? [];
    const args = await Promise.all(
      payloads.map((payload) => client.options.loadedDataConverter.payloadConverter.fromPayload(payload)),
    );
    const firstArg = args[0];

    if (!firstArg || typeof firstArg !== 'object' || (firstArg as any).workflowId !== workflowRecordId) {
      continue;
    }

    const entry: ListEntry = {
      workflowId: info.workflowId,
      runId: info.runId,
      status: info.status.name,
      startTime: info.startTime.toISOString(),
      closeTime: info.closeTime?.toISOString(),
      inputs: (firstArg as any).inputs as Record<string, unknown>,
    };

    try {
      const result = await handle.result();
      entry.result = result;
      const outputs = (result as any)?.outputs ?? {};
      if (subfinderRef && outputs[subfinderRef]) {
        entry.result = {
          ...result,
          subfinder: outputs[subfinderRef],
        };
      }
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
    }

    runs.push(entry);
  }

  return runs
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, limit);
}

async function runWorkflow(
  client: Client,
  definition: WorkflowDefinition,
  workflowRecordId: string,
  fileId: string,
): Promise<{ runId: string; result: unknown }> {
  const temporalWorkflowId = `shipsec-run-${randomUUID()}`;
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE ?? 'shipsec-default';

  const handle = await client.workflow.start(shipsecWorkflowRun, {
    workflowId: temporalWorkflowId,
    taskQueue,
    args: [
      {
        runId: temporalWorkflowId,
        workflowId: workflowRecordId,
        definition,
        inputs: {
          input1: fileId,
        },
      },
    ],
  });

  const result = await handle.result();
  return { runId: temporalWorkflowId, result };
}

async function main() {
  const { workflowRecordId, fileId, limit, shouldRun, list } = parseArgs();

  const __dirname = dirname(fileURLToPath(import.meta.url));
  config({ path: join(__dirname, '..', '.env') });

  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://shipsec:shipsec@localhost:5433/shipsec',
  });

  const definition = await loadDefinition(pool, workflowRecordId);

  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'shipsec-dev';

  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });

  try {
    if (list) {
      const runs = await listRuns(client, workflowRecordId, definition, limit);
      console.log('--- Existing Runs ---');
      if (runs.length === 0) {
        console.log('No runs found for workflow', workflowRecordId);
      } else {
        for (const run of runs) {
          console.log(JSON.stringify(run, null, 2));
        }
      }
      console.log('---------------------');
    }

    if (shouldRun && fileId) {
      console.log('Starting new workflow run...');
      const { runId, result } = await runWorkflow(client, definition, workflowRecordId, fileId);
      console.log('--- New Run Result ---');
      console.log(JSON.stringify({ runId, result }, null, 2));
      console.log('----------------------');
    }
  } finally {
    await connection.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

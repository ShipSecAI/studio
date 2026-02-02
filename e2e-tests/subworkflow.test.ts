/**
 * E2E Tests - Subworkflow (core.workflow.call)
 *
 * Validates that a parent workflow can call a child workflow and consume its outputs.
 *
 * These tests require:
 * - Backend API running on http://localhost:3211
 * - Worker running and component registry loaded
 * - Temporal, Postgres, and other infrastructure running
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const API_BASE = 'http://localhost:3211/api/v1';
const HEADERS = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

// Only run E2E tests when RUN_E2E is set
const runE2E = process.env.RUN_E2E === 'true';

// Check if services are available synchronously
const servicesAvailableSync = (() => {
  if (!runE2E) {
    return false;
  }
  try {
    const result = Bun.spawnSync([
      'curl', '-sf', '--max-time', '1',
      '-H', `x-internal-token: ${HEADERS['x-internal-token']}`,
      `${API_BASE}/health`
    ], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
})();

// Check if services are available (async - used in beforeAll)
async function checkServicesAvailable(): Promise<boolean> {
  if (!runE2E) {
    return false;
  }
  try {
    const healthRes = await fetch(`${API_BASE}/health`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(2000),
    });
    return healthRes.ok;
  } catch {
    return false;
  }
}

const e2eDescribe = (runE2E && servicesAvailableSync) ? describe : describe.skip;

function e2eTest(
  name: string,
  optionsOrFn: { timeout?: number } | (() => void | Promise<void>),
  fn?: () => void | Promise<void>
): void {
  if (runE2E && servicesAvailableSync) {
    if (typeof optionsOrFn === 'function') {
      test(name, optionsOrFn);
    } else if (fn) {
      (test as any)(name, optionsOrFn, fn);
    }
  } else {
    const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn!;
    test.skip(name, actualFn);
  }
}

// Helper function to poll workflow run status
async function pollRunStatus(runId: string, timeoutMs = 180000): Promise<{ status: string }> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, { headers: HEADERS });
    const s = await res.json();
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(s.status)) {
      return s;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Workflow run ${runId} did not complete within ${timeoutMs}ms`);
}

// Helper to get trace events
async function getTraceEvents(runId: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, { headers: HEADERS });
  if (!res.ok) {
    return [];
  }
  const trace = await res.json();
  return trace?.events ?? [];
}

// Helper to create a workflow
async function createWorkflow(workflow: any): Promise<string> {
  const res = await fetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(workflow),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Workflow creation failed: ${res.status} - ${error}`);
  }
  const { id } = await res.json();
  return id;
}

// Helper to run a workflow
async function runWorkflow(workflowId: string, inputs: Record<string, unknown> = {}): Promise<string> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ inputs }),
  });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Workflow run failed: ${res.status} - ${error}`);
  }
  const { runId } = await res.json();
  return runId;
}

let servicesAvailable = false;

beforeAll(async () => {
  if (!runE2E) {
    console.log('\n  Subworkflow E2E: Skipping (RUN_E2E not set)');
    return;
  }

  console.log('\n  Subworkflow E2E: Verifying services...');
  servicesAvailable = await checkServicesAvailable();
  if (!servicesAvailable) {
    console.log('    Backend API is not available. Tests will be skipped.');
    return;
  }
  console.log('    Backend API is running');
});

afterAll(async () => {
  console.log('\n  Cleanup: Run "bun e2e-tests/cleanup.ts" to remove test workflows');
});

e2eDescribe('Subworkflow E2E Tests', () => {

  e2eTest('Child workflow output is consumed by parent', { timeout: 120000 }, async () => {
    console.log('\n  Test: Child workflow output consumed by parent');

    // Step 1: Create the CHILD workflow
    // Uses core.logic.script to compute 21 * input multiplier
    // Edge wires start.multiplier -> compute.mult
    const childWorkflow = {
      name: 'Test: Child Workflow',
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: {
            label: 'Start',
            config: {
              params: {
                runtimeInputs: [
                  { id: 'multiplier', label: 'Multiplier', type: 'number', required: true },
                ],
              },
            },
          },
        },
        {
          id: 'compute',
          type: 'core.logic.script',
          position: { x: 200, y: 0 },
          data: {
            label: 'Compute',
            config: {
              params: {
                variables: [
                  { name: 'mult', type: 'number' },
                ],
                returns: [
                  { name: 'result', type: 'number' },
                  { name: 'description', type: 'string' },
                ],
                code: `export async function script(input: Input): Promise<Output> {
  const mult = typeof input.mult === 'number' ? input.mult : 1;
  const result = 21 * mult;
  return {
    result,
    description: \`21 times \${mult} equals \${result}\`
  };
}`,
              },
            },
          },
        },
      ],
      edges: [
        // Wire start -> compute (execution dependency)
        { id: 'e1', source: 'start', target: 'compute' },
        // Wire start.multiplier -> compute.mult (data flow)
        { id: 'e2', source: 'start', target: 'compute', sourceHandle: 'multiplier', targetHandle: 'mult' },
      ],
    };

    const childWorkflowId = await createWorkflow(childWorkflow);
    console.log(`    Child Workflow ID: ${childWorkflowId}`);

    // Step 2: Create the PARENT workflow
    // - calls the child with multiplier=2 (should produce 42)
    // - consumes the child's result in a subsequent script node
    const parentWorkflow = {
      name: 'Test: Parent Consumes Child Output',
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: {
            label: 'Start',
            config: { params: { runtimeInputs: [] } },
          },
        },
        {
          id: 'call-child',
          type: 'core.workflow.call',
          position: { x: 200, y: 0 },
          data: {
            label: 'Call Child',
            config: {
              params: {
                workflowId: childWorkflowId,
                versionStrategy: 'latest',
                timeoutSeconds: 60,
                childRuntimeInputs: [
                  { id: 'multiplier', label: 'Multiplier', type: 'number', required: true },
                ],
              },
              inputOverrides: {
                // Pass multiplier = 2, so child should compute 21 * 2 = 42
                multiplier: 2,
              },
            },
          },
        },
        {
          id: 'consume',
          type: 'core.logic.script',
          position: { x: 400, y: 0 },
          data: {
            label: 'Consume Result',
            config: {
              params: {
                variables: [
                  { name: 'childOutput', type: 'json' },
                ],
                returns: [
                  { name: 'finalAnswer', type: 'number' },
                  { name: 'confirmation', type: 'string' },
                ],
                code: `export async function script(input: Input): Promise<Output> {
  const childOutput = input.childOutput || {};
  const compute = childOutput.compute || {};
  return {
    finalAnswer: compute.result ?? -1,
    confirmation: compute.description ?? 'not found'
  };
}`,
              },
            },
          },
        },
      ],
      edges: [
        // Wire start -> call-child (execution dependency)
        { id: 'e1', source: 'start', target: 'call-child' },
        // Wire call-child -> consume (execution dependency)
        { id: 'e2', source: 'call-child', target: 'consume' },
        // Wire call-child.result -> consume.childOutput (data flow)
        { id: 'e3', source: 'call-child', target: 'consume', sourceHandle: 'result', targetHandle: 'childOutput' },
      ],
    };

    const parentWorkflowId = await createWorkflow(parentWorkflow);
    console.log(`    Parent Workflow ID: ${parentWorkflowId}`);

    // Step 3: Run the parent workflow
    const runId = await runWorkflow(parentWorkflowId);
    console.log(`    Run ID: ${runId}`);

    // Step 4: Wait for completion
    const result = await pollRunStatus(runId);
    console.log(`    Status: ${result.status}`);

    expect(result.status).toBe('COMPLETED');

    // Step 5: Get trace events and verify outputs
    const events = await getTraceEvents(runId);

    // Find the call-child completed event with child output
    const callChildCompleted = events.find(
      (e: any) => e.type === 'COMPLETED' && e.nodeId === 'call-child'
    );
    expect(callChildCompleted).toBeDefined();
    console.log(`    call-child output: ${JSON.stringify(callChildCompleted.outputSummary)}`);

    // Verify child run linkage
    expect(callChildCompleted.metadata?.childRunId).toBeDefined();
    console.log(`    Child Run ID: ${callChildCompleted.metadata.childRunId}`);

    // The result should contain the child workflow outputs
    const childResult = callChildCompleted.outputSummary?.result;
    expect(childResult).toBeDefined();
    expect(childResult.compute).toBeDefined();
    expect(childResult.compute.result).toBe(42);
    expect(childResult.compute.description).toContain('42');

    // Find the consume node completed event
    const consumeCompleted = events.find(
      (e: any) => e.type === 'COMPLETED' && e.nodeId === 'consume'
    );
    expect(consumeCompleted).toBeDefined();
    console.log(`    consume output: ${JSON.stringify(consumeCompleted.outputSummary)}`);

    // Verify the parent successfully consumed the child's output
    expect(consumeCompleted.outputSummary?.finalAnswer).toBe(42);
    expect(consumeCompleted.outputSummary?.confirmation).toContain('42');

    console.log('    SUCCESS: Parent consumed child output correctly');
  });

});

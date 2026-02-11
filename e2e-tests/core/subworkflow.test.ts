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

import { expect, beforeAll, afterAll } from 'bun:test';

import {
  e2eDescribe,
  e2eTest,
  pollRunStatus,
  getTraceEvents,
  createWorkflow,
  runWorkflow,
  checkServicesAvailable,
} from '../helpers/e2e-harness';

let servicesAvailable = false;

beforeAll(async () => {
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
        { id: 'e1', source: 'start', target: 'compute' },
        { id: 'e2', source: 'start', target: 'compute', sourceHandle: 'multiplier', targetHandle: 'mult' },
      ],
    };

    const childWorkflowId = await createWorkflow(childWorkflow);
    console.log(`    Child Workflow ID: ${childWorkflowId}`);

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
        { id: 'e1', source: 'start', target: 'call-child' },
        { id: 'e2', source: 'call-child', target: 'consume' },
        { id: 'e3', source: 'call-child', target: 'consume', sourceHandle: 'result', targetHandle: 'childOutput' },
      ],
    };

    const parentWorkflowId = await createWorkflow(parentWorkflow);
    console.log(`    Parent Workflow ID: ${parentWorkflowId}`);

    const runId = await runWorkflow(parentWorkflowId);
    console.log(`    Run ID: ${runId}`);

    const result = await pollRunStatus(runId);
    console.log(`    Status: ${result.status}`);

    expect(result.status).toBe('COMPLETED');

    const events = await getTraceEvents(runId);

    const callChildCompleted = events.find(
      (e: any) => e.type === 'COMPLETED' && e.nodeId === 'call-child'
    );
    expect(callChildCompleted).toBeDefined();
    console.log(`    call-child output: ${JSON.stringify(callChildCompleted.outputSummary)}`);

    expect(callChildCompleted.metadata?.childRunId).toBeDefined();
    console.log(`    Child Run ID: ${callChildCompleted.metadata.childRunId}`);

    const childResult = callChildCompleted.outputSummary?.result;
    expect(childResult).toBeDefined();
    expect(childResult.compute).toBeDefined();
    expect(childResult.compute.result).toBe(42);
    expect(childResult.compute.description).toContain('42');

    const consumeCompleted = events.find(
      (e: any) => e.type === 'COMPLETED' && e.nodeId === 'consume'
    );
    expect(consumeCompleted).toBeDefined();
    console.log(`    consume output: ${JSON.stringify(consumeCompleted.outputSummary)}`);

    expect(consumeCompleted.outputSummary?.finalAnswer).toBe(42);
    expect(consumeCompleted.outputSummary?.confirmation).toContain('42');

    console.log('    SUCCESS: Parent consumed child output correctly');
  });

});

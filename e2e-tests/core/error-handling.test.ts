/**
 * E2E Tests - Error Handling
 *
 * Validates error handling refactor across different error types and retry scenarios.
 *
 * These tests require:
 * - Backend API running on http://localhost:3211
 * - Worker running and component registry loaded
 * - Temporal, Postgres, and other infrastructure running
 */

import { expect, beforeAll, afterAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  pollRunStatus,
  getTraceEvents,
  checkServicesAvailable,
} from '../helpers/e2e-harness';

// Helper function to fetch error events from trace
async function fetchErrorEvents(runId: string) {
  const events = await getTraceEvents(runId);
  return events.filter((t: any) => t.type === 'FAILED' && t.nodeId === 'error-gen');
}

// Helper function to create workflow and run it
async function createAndRunWorkflow(name: string, config: any) {
  const wf = {
    name: `Test: ${name}`,
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
      },
      {
        id: 'error-gen',
        type: 'test.error.generator',
        position: { x: 200, y: 0 },
        data: {
          label: name,
          config: { params: config },
        },
      },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'error-gen' }],
  };

  const res = await fetch(`${API_BASE}/workflows`, { method: 'POST', headers: HEADERS, body: JSON.stringify(wf) });
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Workflow creation failed: ${res.status} - ${error}`);
  }
  const { id } = await res.json();
  console.log(`  Workflow ID: ${id}`);

  const runRes = await fetch(`${API_BASE}/workflows/${id}/run`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ inputs: {} }) });
  if (!runRes.ok) {
    const error = await runRes.text();
    throw new Error(`Workflow run failed: ${runRes.status} - ${error}`);
  }
  const { runId } = await runRes.json();
  console.log(`  Run ID: ${runId}`);

  return { workflowId: id, runId };
}

// Track if services are available (set in beforeAll)
let servicesAvailable = false;

// Setup and teardown
beforeAll(async () => {
  console.log('\n  E2E Test Suite: Error Handling');
  servicesAvailable = await checkServicesAvailable();
  if (!servicesAvailable) {
    console.log('  Backend API is not available. Tests will be skipped.');
    return;
  }
  console.log('  Backend API is running');
});

afterAll(async () => {
  console.log('  Cleanup: Run "bun e2e-tests/cleanup.ts" to remove test workflows');
});

e2eDescribe('Error Handling E2E Tests', () => {
  e2eTest('Permanent Service Error - fails with max retries', { timeout: 180000 }, async () => {
    console.log('\n  Test: Permanent Service Error');

    const { runId } = await createAndRunWorkflow('Permanent Service Error', {
      mode: 'fail',
      errorType: 'ServiceError',
      errorMessage: 'Critical service failure',
      failUntilAttempt: 5,
    });

    const result = await pollRunStatus(runId);
    console.log(`  Status: ${result.status}`);
    expect(result.status).toBe('COMPLETED');

    const errorEvents = await fetchErrorEvents(runId);
    console.log(`  Error attempts: ${errorEvents.length}`);
    expect(errorEvents.length).toBe(4);

    errorEvents.forEach((ev: any, idx: number) => {
      console.log(`  Error attempt ${idx + 1}: ${ev.error.message}`);
      expect(ev.error.details.currentAttempt).toBe(idx + 1);
      expect(ev.error.details.targetAttempt).toBe(5);
    });
  });

  e2eTest('Retryable Success - succeeds after 3 attempts', { timeout: 180000 }, async () => {
    console.log('\n  Test: Retryable Success');

    const { runId } = await createAndRunWorkflow('Retryable Success', {
      mode: 'fail',
      errorType: 'ServiceError',
      errorMessage: 'Transient service failure',
      failUntilAttempt: 3,
    });

    const result = await pollRunStatus(runId);
    console.log(`  Status: ${result.status}`);
    expect(result.status).toBe('COMPLETED');

    const errorEvents = await fetchErrorEvents(runId);
    console.log(`  Error attempts: ${errorEvents.length}`);
    expect(errorEvents.length).toBe(2);

    errorEvents.forEach((ev: any, idx: number) => {
      expect(ev.error.details.currentAttempt).toBe(idx + 1);
      expect(ev.error.details.targetAttempt).toBe(3);
    });
  });

  e2eTest('Validation Error - fails immediately without retries', { timeout: 180000 }, async () => {
    console.log('\n  Test: Validation Error Details');

    const { runId } = await createAndRunWorkflow('Validation Error Details', {
      mode: 'fail',
      errorType: 'ValidationError',
      errorMessage: 'Invalid parameters provided',
      alwaysFail: true,
      errorDetails: {
        fieldErrors: {
          api_key: ['Token is expired', 'Must be a valid UUID'],
          region: ['Unsupported region: mars-west-1'],
        },
      },
    });

    const result = await pollRunStatus(runId);
    console.log(`  Status: ${result.status}`);
    expect(result.status).toBe('FAILED');

    const errorEvents = await fetchErrorEvents(runId);
    console.log(`  Error attempts: ${errorEvents.length}`);
    expect(errorEvents.length).toBe(1);

    const error = errorEvents[0];
    expect(error.error.type).toBe('ValidationError');
    expect(error.error.details.fieldErrors).toBeDefined();
    expect(error.error.details.fieldErrors.api_key).toContain('Token is expired');
    expect(error.error.details.fieldErrors.region.some((err: string) => err.includes('Unsupported region'))).toBe(true);
  });

  e2eTest('Timeout Error - succeeds after retries with timeout details', { timeout: 240000 }, async () => {
    console.log('\n  Test: Timeout Error');

    const { runId } = await createAndRunWorkflow('Timeout Error', {
      mode: 'fail',
      errorType: 'TimeoutError',
      errorMessage: 'The third-party API took too long',
      failUntilAttempt: 4,
    });

    const result = await pollRunStatus(runId);
    console.log(`  Status: ${result.status}`);
    expect(result.status).toBe('COMPLETED');

    const errorEvents = await fetchErrorEvents(runId);
    console.log(`  Error attempts: ${errorEvents.length}`);
    expect(errorEvents.length).toBe(3);

    const error = errorEvents[0];
    expect(error.error.type).toBe('TimeoutError');
    expect(error.error.message).toContain('took too long');
    expect(error.error.details.alwaysFail).toBe(false);
  });

  e2eTest('Custom Retry Policy - fails immediately after maxAttempts: 2', { timeout: 180000 }, async () => {
    console.log('\n  Test: Custom Retry Policy');

    const wf = {
      name: 'Test: Custom Retry Policy',
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
        },
        {
          id: 'error-gen',
          type: 'test.error.retry-limited',
          position: { x: 200, y: 0 },
          data: {
            label: 'Retry Limited',
            config: {
              params: {
                mode: 'fail',
                errorType: 'ServiceError',
                errorMessage: 'Should fail early',
                failUntilAttempt: 4,
              },
            },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'error-gen' }],
    };

    const res = await fetch(`${API_BASE}/workflows`, { method: 'POST', headers: HEADERS, body: JSON.stringify(wf) });
    if (!res.ok) throw new Error(`Workflow creation failed: ${res.status}`);
    const { id } = await res.json();
    console.log(`  Workflow ID: ${id}`);

    const runRes = await fetch(`${API_BASE}/workflows/${id}/run`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ inputs: {} }) });
    if (!runRes.ok) throw new Error(`Workflow run failed: ${runRes.status}`);
    const { runId } = await runRes.json();
    console.log(`  Run ID: ${runId}`);

    const result = await pollRunStatus(runId);
    console.log(`  Status: ${result.status}`);
    expect(result.status).toBe('FAILED');

    const errorEvents = await fetchErrorEvents(runId);
    console.log(`  Error attempts: ${errorEvents.length}`);
    expect(errorEvents.length).toBe(2);

    const lastError = errorEvents[errorEvents.length - 1];
    expect(lastError.error.details.currentAttempt).toBe(2);
  });
});

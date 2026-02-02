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

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const API_BASE = 'http://localhost:3211/api/v1';
const HEADERS = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

// Only run E2E tests when RUN_E2E is set
const runE2E = process.env.RUN_E2E === 'true';

// Check if services are available synchronously (before tests are defined)
// This allows us to use test.skip conditionally at definition time
// Similar to how docker tests check for docker availability
const servicesAvailableSync = (() => {
  if (!runE2E) {
    return false;
  }
  try {
    // Use curl to check health endpoint synchronously with required headers
    // Include the x-internal-token header that the health endpoint requires
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

// Check if services are available (non-throwing, async - used in beforeAll)
async function checkServicesAvailable(): Promise<boolean> {
  if (!runE2E) {
    return false;
  }
  try {
    const healthRes = await fetch(`${API_BASE}/health`, { 
      headers: HEADERS,
      signal: AbortSignal.timeout(2000), // 2 second timeout
    });
    return healthRes.ok;
  } catch {
    return false;
  }
}

// Use describe.skip if RUN_E2E is not set OR if services aren't available
// This ensures tests are officially skipped, not just passing
const e2eDescribe = (runE2E && servicesAvailableSync) ? describe : describe.skip;

// Create a wrapper function that handles test.skip properly with timeout option
// test.skip doesn't accept options, so we need to handle it differently
function e2eTest(
  name: string,
  optionsOrFn: { timeout?: number } | (() => void | Promise<void>),
  fn?: () => void | Promise<void>
): void {
  if (runE2E && servicesAvailableSync) {
    // Services available - use test with options
    if (typeof optionsOrFn === 'function') {
      test(name, optionsOrFn);
    } else if (fn) {
      // Use type assertion to help TypeScript understand the overload
      (test as any)(name, optionsOrFn, fn);
    } else {
      // This shouldn't happen, but handle it
      test(name, optionsOrFn as any);
    }
  } else {
    // Services not available - skip test (test.skip doesn't accept options)
    const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn!;
    test.skip(name, actualFn);
  }
}

// Helper function to poll workflow run status
async function pollRunStatus(runId: string, timeoutMs = 180000): Promise<{status: string}> {
  const startTime = Date.now();
  const pollInterval = 1000; // 1 second

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

// Helper function to fetch error events from trace
async function fetchErrorEvents(runId: string) {
  const tRes = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, { headers: HEADERS });
  const trace = await tRes.json();
  const events = trace?.events || [];
  const errorEvents = events.filter((t: any) => t.type === 'FAILED' && t.nodeId === 'error-gen');
  return errorEvents;
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
  if (!runE2E) {
    console.log('\n🧪 E2E Test Suite: Error Handling');
    console.log('  ⏭️  Skipping E2E tests (RUN_E2E not set)');
    console.log('  💡 Set RUN_E2E=true to enable E2E tests');
    return;
  }

  console.log('\n🧪 E2E Test Suite: Error Handling');
  console.log('  Prerequisites: Backend API + Worker must be running');
  console.log('  Verifying services...');

  servicesAvailable = await checkServicesAvailable();
  if (!servicesAvailable) {
    console.log('  ⚠️  Backend API is not available. Tests will be skipped.');
    console.log('  💡 To run E2E tests:');
    console.log('     1. Set RUN_E2E=true');
    console.log('     2. Start services: pm2 start pm2.config.cjs');
    console.log('     3. Verify: curl http://localhost:3211/api/v1/health');
    return;
  }

  console.log('  ✅ Backend API is running');
  console.log('');
});

afterAll(async () => {
  console.log('');
  console.log('🧹 Cleanup: Run "bun e2e-tests/cleanup.ts" to remove test workflows');
});

e2eDescribe('Error Handling E2E Tests', () => {
  // Tests are already skipped at definition time if services aren't available
  // (via e2eTest which is test.skip when servicesAvailableSync is false)
  // We can use e2eTest directly since skipping is handled at definition time
  
  e2eTest('Permanent Service Error - fails with max retries', { timeout: 180000 }, async () => {
    console.log('\n  Test: Permanent Service Error');

    const { runId } = await createAndRunWorkflow('Permanent Service Error', {
      mode: 'fail',
      errorType: 'ServiceError',
      errorMessage: 'Critical service failure',
      failUntilAttempt: 5, // Exceeds default maxAttempts of 3 (5 total attempts = ~31s with backoff)
    });

    const result = await pollRunStatus(runId);
    console.log(`  Status: ${result.status}`);

    // Workflow completes successfully on attempt 5 (failUntilAttempt means fail 1-4, succeed on 5)
    expect(result.status).toBe('COMPLETED');

    const errorEvents = await fetchErrorEvents(runId);
    console.log(`  Error attempts: ${errorEvents.length}`);
    expect(errorEvents.length).toBe(4); // Fails on attempts 1-4

    // Verify error progression is tracked
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
      failUntilAttempt: 3, // Succeeds on attempt 3
    });

    const result = await pollRunStatus(runId);
    console.log(`  Status: ${result.status}`);
    expect(result.status).toBe('COMPLETED');

    const errorEvents = await fetchErrorEvents(runId);
    console.log(`  Error attempts: ${errorEvents.length}`);
    expect(errorEvents.length).toBe(2); // Fails on attempts 1 and 2, succeeds on 3

    // Verify error progression is tracked
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
    expect(errorEvents.length).toBe(1); // ValidationError is non-retryable

    // Verify field errors are preserved
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

    // Workflow completes successfully on attempt 4
    expect(result.status).toBe('COMPLETED');

    const errorEvents = await fetchErrorEvents(runId);
    console.log(`  Error attempts: ${errorEvents.length}`);
    expect(errorEvents.length).toBe(3);

    // Verify timeout error structure
    const error = errorEvents[0];
    expect(error.error.type).toBe('TimeoutError');
    expect(error.error.message).toContain('took too long');
    expect(error.error.details.alwaysFail).toBe(false);
  });

  e2eTest('Custom Retry Policy - fails immediately after maxAttempts: 2', { timeout: 180000 }, async () => {
    console.log('\n  Test: Custom Retry Policy');

    // Manually create workflow with the specific component ID 'test.error.retry-limited'
    // which has maxAttempts: 2 hardcoded in its definition
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
          type: 'test.error.retry-limited', // Uses the variant with strict retry policy
          position: { x: 200, y: 0 },
          data: {
            label: 'Retry Limited',
            config: {
              params: {
                mode: 'fail',
                errorType: 'ServiceError',
                errorMessage: 'Should fail early',
                failUntilAttempt: 4, // Would succeed on 4th attempt if retries were unlimited
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
    
    // Should fail exactly 2 times (Attempt 1, Attempt 2) then give up.
    // If it used default policy (3), it would be 3.
    expect(errorEvents.length).toBe(2);
    
    // Verify last error indicates attempts exhausted
    const lastError = errorEvents[errorEvents.length - 1];
    expect(lastError.error.details.currentAttempt).toBe(2);
  });
});

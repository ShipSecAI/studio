/**
 * E2E Tests - Workflow Analytics
 *
 * Validates analytics sink ingestion into ClickHouse and analytics query API.
 *
 * Requirements:
 * - Backend API running
 * - Worker running and component registry loaded
 * - ClickHouse running on http://localhost:8123
 */

import { expect, beforeAll, afterAll } from 'bun:test';
import {
  API_BASE,
  HEADERS,
  runE2E,
  e2eDescribe,
  e2eTest,
  createWorkflow,
  runWorkflow,
  pollRunStatus,
  checkServicesAvailable,
} from '../helpers/e2e-harness';

async function pollAnalytics(runId: string, timeoutMs = 60000): Promise<number> {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        filters: [{ field: 'run_id', op: 'eq', value: runId }],
        size: 1,
      }),
    });

    if (res.ok) {
      const body = await res.json();
      const total = body?.total ?? 0;
      if (total > 0) {
        return total;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`ClickHouse documents not indexed for runId ${runId} within ${timeoutMs}ms`);
}

let servicesAvailable = false;

beforeAll(async () => {
  if (!runE2E) {
    console.log('\n  Analytics E2E: Skipping (RUN_E2E not set)');
    return;
  }

  console.log('\n  Analytics E2E: Verifying services...');
  servicesAvailable = await checkServicesAvailable();
  if (!servicesAvailable) {
    console.log('    Required services are not available. Tests will be skipped.');
    return;
  }
  console.log('    Backend API and ClickHouse are running');
});

afterAll(async () => {
  console.log('\n  Cleanup: Run "bun e2e-tests/cleanup.ts" to remove test workflows');
});

e2eDescribe('Workflow Analytics E2E Tests', () => {
  e2eTest('Analytics Sink indexes results into ClickHouse', { timeout: 180000 }, async () => {
    console.log('\n  Test: Analytics Sink indexing');

    const workflow = {
      name: 'Test: Analytics Sink E2E',
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
          id: 'fixture',
          type: 'test.analytics.fixture',
          position: { x: 200, y: 0 },
          data: {
            label: 'Analytics Fixture',
            config: {
              params: {},
            },
          },
        },
        {
          id: 'sink',
          type: 'core.analytics.sink',
          position: { x: 400, y: 0 },
          data: {
            label: 'Analytics Sink',
            config: {
              params: {
                dataInputs: [
                  { id: 'results', label: 'Results', sourceTag: 'fixture' },
                ],
                assetKeyField: 'auto',
                failOnError: true,
              },
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'fixture' },
        { id: 'e2', source: 'fixture', target: 'sink' },
        {
          id: 'e3',
          source: 'fixture',
          target: 'sink',
          sourceHandle: 'results',
          targetHandle: 'results',
        },
      ],
    };

    const workflowId = await createWorkflow(workflow);
    const runId = await runWorkflow(workflowId);

    const status = await pollRunStatus(runId);
    expect(status.status).toBe('COMPLETED');

    const total = await pollAnalytics(runId);
    expect(total).toBeGreaterThan(0);

    const analyticsRes = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        filters: [{ field: 'run_id', op: 'eq', value: runId }],
        size: 5,
      }),
    });

    expect(analyticsRes.ok).toBe(true);
    const analyticsBody = await analyticsRes.json();
    expect(analyticsBody.total).toBeGreaterThan(0);
  });
});

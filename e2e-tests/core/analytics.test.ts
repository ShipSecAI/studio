/**
 * E2E Tests - Workflow Analytics
 *
 * Validates analytics sink ingestion into OpenSearch and analytics query API.
 *
 * Requirements:
 * - Backend API running
 * - Worker running and component registry loaded
 * - OpenSearch running on http://localhost:9200
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

const OPENSEARCH_URL = process.env.OPENSEARCH_URL ?? 'http://localhost:9200';

async function pollOpenSearch(runId: string, timeoutMs = 60000): Promise<number> {
  const startTime = Date.now();
  const pollInterval = 2000;

  const query = {
    size: 1,
    query: {
      term: {
        'shipsec.run_id': runId,
      },
    },
  };

  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(`${OPENSEARCH_URL}/security-findings-*/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    });

    if (res.ok) {
      const body = await res.json();
      const total =
        typeof body?.hits?.total === 'object'
          ? body.hits.total.value ?? 0
          : body?.hits?.total ?? 0;

      if (total > 0) {
        return total;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`OpenSearch documents not indexed for runId ${runId} within ${timeoutMs}ms`);
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
  console.log('    Backend API and OpenSearch are running');
});

afterAll(async () => {
  console.log('\n  Cleanup: Run "bun e2e-tests/cleanup.ts" to remove test workflows');
});

e2eDescribe('Workflow Analytics E2E Tests', () => {
  e2eTest('Analytics Sink indexes results into OpenSearch', { timeout: 180000 }, async () => {
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

    const total = await pollOpenSearch(runId);
    expect(total).toBeGreaterThan(0);

    const analyticsRes = await fetch(`${API_BASE}/analytics/query`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        query: {
          term: {
            'shipsec.run_id': runId,
          },
        },
        size: 5,
      }),
    });

    expect(analyticsRes.ok).toBe(true);
    const analyticsBody = await analyticsRes.json();
    expect(analyticsBody.total).toBeGreaterThan(0);
  });
});

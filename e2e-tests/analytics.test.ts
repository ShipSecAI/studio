/**
 * E2E Tests - Workflow Analytics
 *
 * Validates analytics sink ingestion into OpenSearch and analytics query API.
 *
 * Requirements:
 * - Backend API running on http://localhost:3211
 * - Worker running and component registry loaded
 * - OpenSearch running on http://localhost:9200
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const API_BASE = 'http://localhost:3211/api/v1';
const OPENSEARCH_URL = process.env.OPENSEARCH_URL ?? 'http://localhost:9200';
const HEADERS = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

const runE2E = process.env.RUN_E2E === 'true';

const servicesAvailableSync = (() => {
  if (!runE2E) return false;
  try {
    const backend = Bun.spawnSync(
      [
        'curl',
        '-sf',
        '--max-time',
        '1',
        '-H',
        `x-internal-token: ${HEADERS['x-internal-token']}`,
        `${API_BASE}/health`,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    if (backend.exitCode !== 0) return false;

    const opensearch = Bun.spawnSync(
      ['curl', '-sf', '--max-time', '1', `${OPENSEARCH_URL}/_cluster/health`],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    return opensearch.exitCode === 0;
  } catch {
    return false;
  }
})();

async function checkServicesAvailable(): Promise<boolean> {
  if (!runE2E) return false;
  try {
    const healthRes = await fetch(`${API_BASE}/health`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(2000),
    });
    if (!healthRes.ok) return false;

    const osRes = await fetch(`${OPENSEARCH_URL}/_cluster/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return osRes.ok;
  } catch {
    return false;
  }
}

const e2eDescribe = runE2E && servicesAvailableSync ? describe : describe.skip;

function e2eTest(
  name: string,
  optionsOrFn: { timeout?: number } | (() => void | Promise<void>),
  fn?: () => void | Promise<void>,
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

async function pollRunStatus(runId: string, timeoutMs = 180000): Promise<{ status: string }> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, { headers: HEADERS });
    const s = await res.json();
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(s.status)) {
      return s;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Workflow run ${runId} did not complete within ${timeoutMs}ms`);
}

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

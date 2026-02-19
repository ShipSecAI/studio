/**
 * E2E Tests - Billing Usage
 *
 * Validates that workflow runs are counted toward the monthly usage meter.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { getApiBaseUrl } from './helpers/api-base';

const API_BASE = getApiBaseUrl();
const HEADERS = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

const runE2E = process.env.RUN_E2E === 'true';

async function checkServicesAvailable(): Promise<boolean> {
  if (!runE2E) return false;
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

async function pollRunStatus(runId: string, timeoutMs = 60000): Promise<{ status: string }> {
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

const e2eDescribe = runE2E ? describe : describe.skip;

e2eDescribe('Billing Usage E2E Tests', () => {
  let servicesAvailable = false;

  beforeAll(async () => {
    servicesAvailable = await checkServicesAvailable();
    if (!servicesAvailable) {
      console.log('    Backend API is not available. Skipping Billing Usage E2E tests.');
    }
  });

  test('workflow run increments billing usage counter', async () => {
    if (!servicesAvailable) return;

    const beforeUsageRes = await fetch(`${API_BASE}/billing/usage`, { headers: HEADERS });
    expect(beforeUsageRes.ok).toBe(true);
    const beforeUsage = await beforeUsageRes.json();

    const workflow = {
      name: 'Test: Billing Usage',
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          position: { x: 0, y: 0 },
          data: { label: 'Start', config: { params: { runtimeInputs: [] } } },
        },
        {
          id: 'script',
          type: 'core.logic.script',
          position: { x: 200, y: 0 },
          data: {
            label: 'No-op',
            config: {
              params: {
                variables: [],
                returns: [{ name: 'ok', type: 'boolean' }],
                code: `export async function script(): Promise<Output> { return { ok: true }; }`,
              },
            },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'script' }],
    };

    const createRes = await fetch(`${API_BASE}/workflows`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(workflow),
    });
    expect(createRes.ok).toBe(true);
    const created = await createRes.json();
    const workflowId = created.id as string;

    const runRes = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ inputs: {} }),
    });
    expect(runRes.ok).toBe(true);
    const { runId } = await runRes.json();

    const status = await pollRunStatus(runId);
    expect(status.status).toBe('COMPLETED');

    const afterUsageRes = await fetch(`${API_BASE}/billing/usage`, { headers: HEADERS });
    expect(afterUsageRes.ok).toBe(true);
    const afterUsage = await afterUsageRes.json();

    expect(afterUsage.workflowRuns.used).toBe(beforeUsage.workflowRuns.used + 1);
  });
});


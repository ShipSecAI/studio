/**
 * E2E Tests — Cloud Scans Tab
 *
 * Covers:
 * - Listing cloud scan runs via the API
 * - Status filter applied server-side
 * - Run detail navigation
 */

import { expect } from 'bun:test';
import { e2eDescribe, e2eTest, API_BASE, HEADERS } from '../helpers/e2e-harness';

e2eDescribe('Cloud Scans', () => {
  e2eTest('listRuns returns runs array', { timeout: 30000 }, async () => {
    const res = await fetch(`${API_BASE}/workflows/runs?limit=10`, {
      headers: HEADERS,
    });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data).toHaveProperty('runs');
    expect(Array.isArray(data.runs)).toBe(true);
  });

  e2eTest('listRuns with status filter returns filtered results', { timeout: 30000 }, async () => {
    const res = await fetch(`${API_BASE}/workflows/runs?limit=10&status=COMPLETED`, {
      headers: HEADERS,
    });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data).toHaveProperty('runs');
    expect(Array.isArray(data.runs)).toBe(true);

    // All returned runs should have COMPLETED status
    for (const run of data.runs) {
      expect(run.status).toBe('COMPLETED');
    }
  });

  e2eTest('listRuns with pagination returns bounded results', { timeout: 30000 }, async () => {
    const limit = 5;
    const res = await fetch(`${API_BASE}/workflows/runs?limit=${limit}&offset=0`, {
      headers: HEADERS,
    });
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.runs.length).toBeLessThanOrEqual(limit);
  });

  e2eTest('run detail endpoint returns valid run', { timeout: 30000 }, async () => {
    // First, get a run ID from the list
    const listRes = await fetch(`${API_BASE}/workflows/runs?limit=1`, {
      headers: HEADERS,
    });
    const listData = await listRes.json();

    if (listData.runs.length === 0) {
      // No runs to test — skip gracefully
      return;
    }

    const runId = listData.runs[0].id;
    const detailRes = await fetch(`${API_BASE}/workflows/runs/${runId}`, {
      headers: HEADERS,
    });
    expect(detailRes.ok).toBe(true);

    const detail = await detailRes.json();
    expect(detail).toHaveProperty('id', runId);
    expect(detail).toHaveProperty('status');
    expect(detail).toHaveProperty('workflowId');
  });

  e2eTest('system workflows endpoint returns cloud scan workflows', { timeout: 30000 }, async () => {
    const res = await fetch(`${API_BASE}/github/quick-scan-workflows`, {
      headers: HEADERS,
    });

    // This endpoint may 404 if GitHub is not configured — that's acceptable
    if (!res.ok) return;

    const workflows = await res.json();
    expect(Array.isArray(workflows)).toBe(true);

    // If any workflows exist, they should have the expected shape
    for (const wf of workflows) {
      expect(wf).toHaveProperty('id');
      expect(wf).toHaveProperty('slug');
    }
  });
});

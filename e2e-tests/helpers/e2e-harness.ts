/**
 * Shared E2E Test Harness
 *
 * Extracts common boilerplate used across all E2E test files:
 * - API_BASE / HEADERS constants
 * - Service availability checks (sync + async)
 * - Skip-aware describe/test wrappers
 * - Workflow CRUD helpers
 * - Secret management helpers
 * - Webhook helpers
 * - Run polling
 */

import { describe, test } from 'bun:test';

import { getApiBaseUrl } from './api-base';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const API_BASE = getApiBaseUrl();

export const HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

// ---------------------------------------------------------------------------
// E2E gate flags
// ---------------------------------------------------------------------------

export const runE2E = process.env.RUN_E2E === 'true';
export const runCloudE2E = process.env.RUN_CLOUD_E2E === 'true';

// ---------------------------------------------------------------------------
// Service availability
// ---------------------------------------------------------------------------

/** Synchronous health check (runs at module load, before tests are defined). */
export function servicesAvailableSync(): boolean {
  if (!runE2E) return false;
  try {
    const result = Bun.spawnSync(
      [
        'curl', '-sf', '--max-time', '1',
        '-H', `x-internal-token: ${HEADERS['x-internal-token']}`,
        `${API_BASE}/health`,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Async health check for use in beforeAll hooks. */
export async function checkServicesAvailable(): Promise<boolean> {
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

// Evaluate once at module load so every importer shares the same value.
const _servicesOk = servicesAvailableSync();

/** Whether E2E is enabled AND the backend is reachable. */
export function isE2EReady(): boolean {
  return runE2E && _servicesOk;
}

// ---------------------------------------------------------------------------
// Skip-aware test wrappers
// ---------------------------------------------------------------------------

/**
 * `describe` that auto-skips when E2E is disabled or services are down.
 * For cloud tests pass `{ cloud: true }` to also require RUN_CLOUD_E2E.
 */
export function e2eDescribe(
  name: string,
  fn: () => void,
  opts?: { cloud?: boolean },
): void {
  const enabled = opts?.cloud
    ? runE2E && runCloudE2E && _servicesOk
    : runE2E && _servicesOk;
  (enabled ? describe : describe.skip)(name, fn);
}

/**
 * `test` that auto-skips when E2E is disabled or services are down.
 * Supports an optional options object (e.g. `{ timeout: 120000 }`).
 */
export function e2eTest(
  name: string,
  optionsOrFn: { timeout?: number } | (() => void | Promise<void>),
  fn?: () => void | Promise<void>,
): void {
  if (isE2EReady()) {
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

// ---------------------------------------------------------------------------
// Workflow helpers
// ---------------------------------------------------------------------------

/** Create a workflow, returns its ID. */
export async function createWorkflow(workflow: any): Promise<string> {
  const res = await fetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(workflow),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Workflow creation failed: ${res.status} ${text}`);
  }
  const { id } = await res.json();
  return id;
}

/** Run a workflow, returns the runId. */
export async function runWorkflow(
  workflowId: string,
  inputs: Record<string, unknown> = {},
): Promise<string> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ inputs }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Workflow run failed: ${res.status} ${text}`);
  }
  const { runId } = await res.json();
  return runId;
}

/** Poll until a run reaches a terminal status. */
export async function pollRunStatus(
  runId: string,
  timeoutMs = 180000,
): Promise<{ status: string }> {
  const startTime = Date.now();
  const pollInterval = 1000;

  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, {
      headers: HEADERS,
    });
    const s = await res.json();
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED'].includes(s.status)) {
      return s;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Workflow run ${runId} did not complete within ${timeoutMs}ms`);
}

/** Fetch trace events for a run. */
export async function getTraceEvents(runId: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}/workflows/runs/${runId}/trace`, {
    headers: HEADERS,
  });
  if (!res.ok) return [];
  const trace = await res.json();
  return trace?.events ?? [];
}

// ---------------------------------------------------------------------------
// Secret helpers
// ---------------------------------------------------------------------------

export async function listSecrets(): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch(`${API_BASE}/secrets`, { headers: HEADERS });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to list secrets: ${res.status} ${text}`);
  }
  return res.json();
}

export async function createOrRotateSecret(
  name: string,
  value: string,
): Promise<string> {
  const secrets = await listSecrets();
  const existing = secrets.find((s) => s.name === name);
  if (!existing) {
    const res = await fetch(`${API_BASE}/secrets`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ name, value }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create secret: ${res.status} ${text}`);
    }
    const secret = await res.json();
    return secret.id as string;
  }

  const res = await fetch(`${API_BASE}/secrets/${existing.id}/rotate`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({ value }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to rotate secret: ${res.status} ${text}`);
  }
  return existing.id;
}

// ---------------------------------------------------------------------------
// Webhook helpers
// ---------------------------------------------------------------------------

export async function createWebhook(config: any): Promise<any> {
  const res = await fetch(`${API_BASE}/webhooks/configurations`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error(`Webhook creation failed: ${await res.text()}`);
  }
  return res.json();
}

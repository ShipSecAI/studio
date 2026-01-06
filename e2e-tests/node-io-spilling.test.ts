/**
 * E2E Tests - Node I/O Spilling
 *
 * Validates that large node inputs and outputs are correctly spilled to object storage
 * and can be retrieved via the backend API.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const API_BASE = 'http://localhost:3211/api/v1';
const HEADERS = {
  'Content-Type': 'application/json',
  'x-internal-token': 'local-internal-token',
};

const runE2E = process.env.RUN_E2E === 'true';

const servicesAvailableSync = (() => {
  if (!runE2E) return false;
  try {
    const result = Bun.spawnSync([
      'curl', '-sf', '--max-time', '1',
      '-H', `x-internal-token: ${HEADERS['x-internal-token']}`,
      `${API_BASE}/health`
    ], { stdout: 'pipe', stderr: 'pipe' });
    return result.exitCode === 0;
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
    } else {
      test(name, optionsOrFn as any);
    }
  } else {
    const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn!;
    test.skip(name, actualFn);
  }
}

async function pollRunStatus(runId: string, timeoutMs = 180000): Promise<{status: string}> {
  const startTime = Date.now();
  console.log(`  [Debug] Polling status for ${runId}...`);
  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, { headers: HEADERS });
    const s = await res.json();
    console.log(`  [Debug] Current status: ${s.status} (${Math.round((Date.now() - startTime)/1000)}s)`);
    if (['COMPLETED', 'FAILED', 'CANCELLED', 'TERMINATED'].includes(s.status)) {
      return s;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Workflow run ${runId} did not complete within ${timeoutMs}ms`);
}

async function fetchNodeIO(runId: string, nodeRef: string, full = false) {
  const url = `${API_BASE}/workflows/runs/${runId}/node-io/${nodeRef}${full ? '?full=true' : ''}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to fetch node I/O: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

async function createAndRunLargeOutputWorkflow() {
  const scriptCode = `
export async function script(input: any) {
  // Generate ~2MB of data
  // Each item is approx 40 bytes + index string, so 50,000 items is ~2MB+
  const largeArray = Array.from({ length: 50000 }, (_, i) => ({
    index: i,
    message: "This is a bloat message to test spilling logic in the telemetry pipeline"
  }));
  return { results: largeArray };
}
  `.trim();

  const wf = {
    name: "Test: Node I/O Spilling",
    nodes: [
      {
        id: 'start',
        type: 'core.workflow.entrypoint',
        position: { x: 0, y: 0 },
        data: { label: 'Start', config: { runtimeInputs: [] } },
      },
      {
        id: 'large-gen',
        type: 'core.logic.script',
        position: { x: 200, y: 0 },
        data: {
          label: 'Generate Large Output',
          config: {
            code: scriptCode,
            variables: [],
            returns: [{ name: 'results', type: 'json' }]
          },
        },
      },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'large-gen' }],
  };

  const res = await fetch(`${API_BASE}/workflows`, { method: 'POST', headers: HEADERS, body: JSON.stringify(wf) });
  if (!res.ok) throw new Error(`Workflow creation failed: ${res.status}`);
  const { id } = await res.json();

  const runRes = await fetch(`${API_BASE}/workflows/${id}/run`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ inputs: {} }) });
  if (!runRes.ok) throw new Error(`Workflow run failed: ${runRes.status}`);
  const { runId } = await runRes.json();

  return { workflowId: id, runId };
}

beforeAll(async () => {
  if (!runE2E) return;
  const available = await checkServicesAvailable();
  if (!available) {
    console.log('  ⚠️  Backend API is not available for Spilling E2E tests.');
  }
});

e2eDescribe('Node I/O Spilling E2E Tests', () => {
  e2eTest('Large script output spills to object storage and is retrievable', { timeout: 180000 }, async () => {
    console.log('\n  Test: Large Output Spilling');

    const { runId } = await createAndRunLargeOutputWorkflow();
    console.log(`  Run ID: ${runId}`);

    const result = await pollRunStatus(runId);
    console.log(`  Workflow Status: ${result.status}`);
    expect(result.status).toBe('COMPLETED');

    // Wait a moment for Kafka ingestion to catch up
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Fetch Node I/O for the generator node (explicitly requesting full output)
    const nodeIO = await fetchNodeIO(runId, 'large-gen', true);
    
    console.log(`  Inputs Spilled: ${nodeIO.inputsSpilled} (${nodeIO.inputsSize} bytes)`);
    console.log(`  Outputs Spilled: ${nodeIO.outputsSpilled} (${nodeIO.outputsSize} bytes)`);

    // Verify spilling occurred (threshold is 100KB)
    expect(nodeIO.outputsSpilled).toBe(true);
    expect(nodeIO.outputsSize).toBeGreaterThan(100 * 1024);

    // Verify data integrity - the backend should have automatically retrieved the data from MinIO
    expect(nodeIO.outputs).toBeDefined();
    expect(nodeIO.outputs.results).toBeDefined();
    expect(Array.isArray(nodeIO.outputs.results)).toBe(true);
    expect(nodeIO.outputs.results.length).toBe(50000);
    expect(nodeIO.outputs.results[0].message).toContain('bloat message');
    
    console.log(`  ✅ Successfully retrieved ${nodeIO.outputs.results.length} items from spilled storage`);
  });
});

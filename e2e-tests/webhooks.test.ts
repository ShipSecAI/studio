/**
 * E2E Tests - Smart Webhooks
 * 
 * Validates the creation, testing, and triggering of Smart Webhooks with custom parsing scripts.
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
    }
  } else {
    const actualFn = typeof optionsOrFn === 'function' ? optionsOrFn : fn!;
    test.skip(name, actualFn);
  }
}

// Helper: Poll run status
async function pollRunStatus(runId: string, timeoutMs = 60000): Promise<{ status: string }> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const res = await fetch(`${API_BASE}/workflows/runs/${runId}/status`, { headers: HEADERS });
    const s = await res.json();
    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(s.status)) return s;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Workflow run ${runId} timed out`);
}

// Helper: Create workflow
async function createWorkflow(workflow: any): Promise<string> {
  const res = await fetch(`${API_BASE}/workflows`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(workflow),
  });
  if (!res.ok) throw new Error(`Workflow creation failed: ${await res.text()}`);
  const { id } = await res.json();
  return id;
}

// Helper: Create webhook
async function createWebhook(config: any): Promise<any> {
    const res = await fetch(`${API_BASE}/webhooks/configurations`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error(`Webhook creation failed: ${await res.text()}`);
    return res.json();
}

beforeAll(async () => {
    if (!runE2E) {
        console.log('\n  Webhook E2E: Skipping (RUN_E2E not set)');
        return;
    }
    const available = await checkServicesAvailable();
    if (!available) console.log('    Backend API is not available. Skipping.');
});

e2eDescribe('Smart Webhooks E2E Tests', () => {

  e2eTest('Webhook transforms GitHub payload and triggers workflow', { timeout: 60000 }, async () => {
    console.log('\n  Test: Webhook transforms GitHub payload');

    // 1. Create a simple workflow
    const workflowId = await createWorkflow({
      name: 'Test: Webhook Target',
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          data: {
            label: 'Start',
            config: {
              params: {
                runtimeInputs: [
                  { id: 'repo_name', label: 'Repo', type: 'text', required: true },
                  { id: 'is_push', label: 'Is Push', type: 'text', required: true },
                ],
              },
            },
          },
          position: { x: 0, y: 0 },
        },
        {
          id: 'end',
          type: 'core.logic.script',
          data: {
            label: 'Process',
            config: {
              params: {
                variables: [
                    { name: 'repo', type: 'string' },
                    { name: 'push', type: 'string' }
                ],
                returns: [{ name: 'ok', type: 'boolean' }],
                code: 'export async function script(input) { return { ok: input.push === "true" }; }',
              },
            },
          },
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
          { id: 'e1', source: 'start', target: 'end' },
          { id: 'e2', source: 'start', target: 'end', sourceHandle: 'repo_name', targetHandle: 'repo' },
          { id: 'e3', source: 'start', target: 'end', sourceHandle: 'is_push', targetHandle: 'push' },
      ],
    });

    console.log(`    Workflow created: ${workflowId}`);

    // 2. Create a smart webhook
    const it = await createWebhook({
      workflowId,
      name: 'GitHub Push Hook',
      description: 'Parses GitHub push events',
      parsingScript: `
        export async function script(input) {
          const { payload, headers } = input;
          return {
            repo_name: payload.repository?.full_name || 'unknown',
            is_push: headers['x-github-event'] === 'push' ? 'true' : 'false'
          };
        }
      `,
      expectedInputs: [
        { id: 'repo_name', label: 'Repo', type: 'text', required: true },
        { id: 'is_push', label: 'Is Push', type: 'text', required: true },
      ],
    });

    const webhookId = it.id;
    const webhookPath = it.webhookPath;
    console.log(`    Webhook created: ${webhookId} (path: ${webhookPath})`);

    // 3. Test the script standalone
    const testRes = await fetch(`${API_BASE}/webhooks/configurations/test-script`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({
            parsingScript: it.parsingScript,
            testPayload: { repository: { full_name: 'ShipSecAI/studio' } },
            testHeaders: { 'x-github-event': 'push' }
        })
    });
    const testData = await testRes.json();
    expect(testData.success).toBe(true);
    expect(testData.parsedData.repo_name).toBe('ShipSecAI/studio');
    expect(testData.parsedData.is_push).toBe('true');
    console.log('    ✓ Script test successful');

    // 4. Trigger the webhook via public endpoint
    const triggerRes = await fetch(`${API_BASE}/webhooks/inbound/${webhookPath}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-github-event': 'push'
        },
        body: JSON.stringify({
            repository: { full_name: 'ShipSecAI/studio' }
        })
    });
    
    if (!triggerRes.ok) {
        console.error(`    ✗ Trigger failed: ${triggerRes.status} ${await triggerRes.text()}`);
    }
    expect(triggerRes.ok).toBe(true);
    const { runId } = await triggerRes.json();
    expect(runId).toBeDefined();
    console.log(`    ✓ Triggered! Run ID: ${runId}`);

    // 5. Verify workflow execution
    const status = await pollRunStatus(runId);
    expect(status.status).toBe('COMPLETED');
    console.log('    ✓ Workflow execution COMPLETED');
  });

});

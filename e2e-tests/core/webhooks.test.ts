/**
 * E2E Tests - Smart Webhooks
 *
 * Validates the creation, testing, and triggering of Smart Webhooks with custom parsing scripts.
 */

import { expect, beforeAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  pollRunStatus,
  createWorkflow,
  createWebhook,
  checkServicesAvailable,
} from '../helpers/e2e-harness';

beforeAll(async () => {
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
    console.log('    Script test successful');

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
        console.error(`    Trigger failed: ${triggerRes.status} ${await triggerRes.text()}`);
    }
    expect(triggerRes.ok).toBe(true);
    const { runId } = await triggerRes.json();
    expect(runId).toBeDefined();
    console.log(`    Triggered! Run ID: ${runId}`);

    // 5. Verify workflow execution
    const status = await pollRunStatus(runId);
    expect(status.status).toBe('COMPLETED');
    console.log('    Workflow execution COMPLETED');
  });

});

/**
 * E2E Tests - Audit Logs
 *
 * Validates that core platform actions emit audit events and that audit logs are queryable.
 */

import { expect, beforeAll } from 'bun:test';

import {
  API_BASE,
  HEADERS,
  e2eDescribe,
  e2eTest,
  checkServicesAvailable,
  createWorkflow,
  createWebhook,
  createOrRotateSecret,
} from '../helpers/e2e-harness';

async function fetchAuditLogs(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/audit-logs?${qs}`, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Failed to list audit logs: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<{ items: any[]; nextCursor: string | null }>;
}

async function waitForAuditAction(action: string, timeoutMs = 8000): Promise<any[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await fetchAuditLogs({ action, limit: '50' });
    if (data.items.length > 0) return data.items;
    await new Promise((r) => setTimeout(r, 200));
  }
  return [];
}

beforeAll(async () => {
  const available = await checkServicesAvailable();
  if (!available) console.log('    Backend API is not available. Skipping.');
});

e2eDescribe('Audit Logs E2E Tests', () => {
  e2eTest('CRUD/access events emit audit logs and are queryable', { timeout: 60000 }, async () => {
    const secretName = `e2e-audit-secret-${Date.now()}`;

    // Secret create
    await createOrRotateSecret(secretName, 'value-1');
    const created = await waitForAuditAction('secret.create');
    expect(created.length).toBeGreaterThan(0);

    // Secret rotate
    await createOrRotateSecret(secretName, 'value-2');
    const rotated = await waitForAuditAction('secret.rotate');
    expect(rotated.length).toBeGreaterThan(0);

    // Webhook create (requires a workflow)
    const workflowId = await createWorkflow({
      name: 'Test: Audit Target',
      nodes: [
        {
          id: 'start',
          type: 'core.workflow.entrypoint',
          data: {
            label: 'Start',
            config: {
              params: {
                runtimeInputs: [{ id: 'x', label: 'X', type: 'text', required: true }],
              },
            },
          },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
    });

    await createWebhook({
      workflowId,
      name: 'Audit Webhook',
      description: 'For audit log tests',
      parsingScript: 'export async function script(input) { return { x: \"ok\" }; }',
      expectedInputs: [{ id: 'x', label: 'X', type: 'text', required: true }],
    });

    const webhookCreated = await waitForAuditAction('webhook.create');
    expect(webhookCreated.length).toBeGreaterThan(0);

    // Query endpoint basic shape
    const list = await fetchAuditLogs({ limit: '10' });
    expect(Array.isArray(list.items)).toBe(true);
    expect(list).toHaveProperty('nextCursor');
  });
});


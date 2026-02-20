import { randomUUID } from 'node:crypto';
import { apiRequest } from './browser-harness';

async function safeCleanup(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e: any) {
    // Only ignore 404 (entity already deleted by the test)
    if (e.message?.includes('404')) return;
    throw e;
  }
}

export async function createTestSecret() {
  const name = `test-secret-${randomUUID().slice(0, 8)}`;
  const res = await apiRequest<{ id: string }>('/secrets', {
    method: 'POST',
    body: { name, value: 'dummy-test-value', description: 'UI test secret' },
  });
  return {
    id: res.id,
    name,
    cleanup: () => safeCleanup(() => apiRequest(`/secrets/${res.id}`, { method: 'DELETE' })),
  };
}

export async function createTestApiKey() {
  const name = `test-key-${randomUUID().slice(0, 8)}`;
  const res = await apiRequest<{ id: string }>('/api-keys', {
    method: 'POST',
    body: { name, description: 'UI test key', permissions: ['workflows:run', 'workflows:list'] },
  });
  return {
    id: res.id,
    name,
    cleanup: () => safeCleanup(() => apiRequest(`/api-keys/${res.id}`, { method: 'DELETE' })),
  };
}

export async function createTestWorkflow() {
  const name = `test-wf-${randomUUID().slice(0, 8)}`;
  const res = await apiRequest<{ id: string }>('/workflows', {
    method: 'POST',
    body: { name },
  });
  return {
    id: res.id,
    name,
    cleanup: () => safeCleanup(() => apiRequest(`/workflows/${res.id}`, { method: 'DELETE' })),
  };
}

export async function createTestWebhook(workflowId: string) {
  const name = `test-webhook-${randomUUID().slice(0, 8)}`;
  const res = await apiRequest<{ id: string }>('/webhooks/configurations', {
    method: 'POST',
    body: { name, workflowId },
  });
  return {
    id: res.id,
    name,
    cleanup: () =>
      safeCleanup(() => apiRequest(`/webhooks/configurations/${res.id}`, { method: 'DELETE' })),
  };
}

export async function createTestArtifact() {
  const name = `test-artifact-${randomUUID().slice(0, 8)}`;
  const res = await apiRequest<{ id: string }>('/artifacts', {
    method: 'POST',
    body: { name, content: 'dummy-content' },
  });
  return {
    id: res.id,
    name,
    cleanup: () => safeCleanup(() => apiRequest(`/artifacts/${res.id}`, { method: 'DELETE' })),
  };
}

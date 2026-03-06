import { beforeEach, describe, expect, test, vi } from 'bun:test';

import { createMockExecutionContext } from '../../../testing/test-utils';

describe('GitHub auth helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
    process.env.BACKEND_URL = 'http://backend.local:3211';
    delete process.env.ORGANIZATION_ID;
  });

  test('fetchInstallationToken sends the execution organization to the backend token endpoint', async () => {
    const { fetchInstallationToken } = await import('../installation-token');
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        'x-internal-token': 'internal-token',
        'x-organization-id': 'org-runtime-123',
      });

      return new Response(JSON.stringify({ token: 'ghs_test_token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const context = createMockExecutionContext({
      organizationId: 'org-runtime-123',
      metadata: {
        runId: 'run-1',
        componentRef: 'node-2',
        organizationId: 'org-runtime-123',
      },
      secrets: undefined,
      http: {
        fetch: fetchMock as any,
        toCurl: vi.fn(() => ''),
      },
    });

    await expect(fetchInstallationToken(108884199, context, '[GitHub Clone]')).resolves.toBe(
      'ghs_test_token',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('fetchInstallationToken throws immediately when the execution context has no organization', async () => {
    const { fetchInstallationToken } = await import('../installation-token');
    const fetchMock = vi.fn();

    const context = createMockExecutionContext({
      organizationId: null,
      metadata: {
        runId: 'run-1',
        componentRef: 'node-2',
        organizationId: null,
      },
      secrets: undefined,
      http: {
        fetch: fetchMock as any,
        toCurl: vi.fn(() => ''),
      },
    });

    await expect(fetchInstallationToken(108884199, context, '[GitHub Clone]')).rejects.toThrow(
      'requires context.organizationId',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

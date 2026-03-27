import { beforeEach, describe, expect, test, vi } from 'bun:test';

import { fetchOrgVirtualKey, requireOrgVirtualKey } from '../utils';

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

describe('LiteLLM org key helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.LITELLM_BASE_URL = 'http://litellm.local:4000/v1';
    process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
    process.env.API_BASE_URL = 'http://backend.local/api/v1';
    delete process.env.STUDIO_API_BASE_URL;
    delete process.env.SHIPSEC_API_BASE_URL;
  });

  test('fetchOrgVirtualKey sends the org ID as an internal header', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      expect(input).toBeInstanceOf(Request);
      const request = input as Request;

      expect(request.url).toBe('http://backend.local/api/v1/internal/billing/litellm-key');
      expect(headersToObject(request.headers)).toMatchObject({
        'x-internal-token': 'internal-token',
        'x-organization-id': 'org-123',
      });

      return new Response(JSON.stringify({ virtualKey: 'sk-org-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const typedFetch = fetchMock as unknown as typeof fetch;
    typedFetch.preconnect = () => {};
    globalThis.fetch = typedFetch;

    await expect(fetchOrgVirtualKey('org-123')).resolves.toBe('sk-org-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('fetchOrgVirtualKey accepts a backend origin and normalizes it to /api/v1', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      expect(input).toBeInstanceOf(Request);
      const request = input as Request;

      expect(request.url).toBe('http://backend.local:3711/api/v1/internal/billing/litellm-key');
      return new Response(JSON.stringify({ virtualKey: 'sk-org-123' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const typedFetch = fetchMock as unknown as typeof fetch;
    typedFetch.preconnect = () => {};
    globalThis.fetch = typedFetch;

    await expect(fetchOrgVirtualKey('org-123', 'http://backend.local:3711')).resolves.toBe(
      'sk-org-123',
    );
  });

  test('requireOrgVirtualKey rejects LiteLLM calls without an organization', async () => {
    await expect(requireOrgVirtualKey(null, { consumer: 'Chat AI' })).rejects.toThrow(
      'Chat AI requires an organization ID',
    );
  });

  test('requireOrgVirtualKey rejects when the backend cannot resolve a key', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ virtualKey: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const typedFetch = fetchMock as unknown as typeof fetch;
    typedFetch.preconnect = () => {};
    globalThis.fetch = typedFetch;

    await expect(requireOrgVirtualKey('org-missing', { consumer: 'AI Agent' })).rejects.toThrow(
      'could not resolve a LiteLLM virtual key',
    );
  });
});

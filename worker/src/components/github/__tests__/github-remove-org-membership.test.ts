import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type {
  GitHubRemoveOrgMembershipInput,
  GitHubRemoveOrgMembershipOutput,
} from '../remove-org-membership';

// URL-aware fetch mock: creates a vi.fn() tracker that ONLY records calls to expected
// URL patterns (localhost and api.github.com). Non-matching calls pass through to Bun.fetch.
// Uses direct globalThis.fetch assignment (NOT vi.spyOn) so parallel test files sharing
// globalThis cannot inflate mock.calls with their own fetch calls.
const nativeFetch = Bun.fetch as typeof fetch;
function setupFetchMock(responses: Response[]) {
  const queue = [...responses];
  const tracker = vi.fn();

  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes('localhost') || urlStr.includes('api.github.com')) {
      tracker(url, init);
      const response = queue.shift();
      if (response) return Promise.resolve(response);
    }
    return nativeFetch(urlStr, init as RequestInit);
  }) as typeof fetch;

  return tracker;
}

describe('github.org.membership.remove component', () => {
  let previousInternalToken: string | undefined;

  beforeAll(async () => {
    process.env.STUDIO_API_BASE_URL = 'http://localhost:3211/api/v1';
    await import('../../index');
  });

  beforeEach(() => {
    previousInternalToken = process.env.INTERNAL_SERVICE_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore native fetch — setupFetchMock uses direct assignment, not vi.spyOn
    globalThis.fetch = nativeFetch as unknown as typeof fetch;
    if (previousInternalToken === undefined) {
      delete process.env.INTERNAL_SERVICE_TOKEN;
    } else {
      process.env.INTERNAL_SERVICE_TOKEN = previousInternalToken;
    }
  });

  it('removes a user by username using a stored connection', async () => {
    const component = componentRegistry.get<
      GitHubRemoveOrgMembershipInput,
      GitHubRemoveOrgMembershipOutput
    >('github.org.membership.remove');
    expect(component).toBeDefined();
    if (!component) throw new Error('Component not registered');

    process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';

    const fetchMock = setupFetchMock([
      new Response(
        JSON.stringify({
          accessToken: 'stored-token',
          tokenType: 'token',
          scopes: ['admin:org'],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
      new Response(null, {
        status: 204,
        statusText: 'No Content',
      }),
    ]);

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'github-remove',
    });

    const executePayload = {
      inputs: {
        organization: 'shipsecai',
        userIdentifier: 'octocat',
        connectionId: 'connection-123',
      },
      params: {},
    };

    const result = await component.execute(executePayload, context);

    expect(result.removedFromOrganization).toBe(true);
    expect(result.tokenScope).toBe('admin:org');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3211/api/v1/integrations/connections/connection-123/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Internal-Token': 'test-internal-token',
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/orgs/shipsecai/members/octocat',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'token stored-token',
        }),
      }),
    );
  });

  it('resolves email identifiers and handles already removed users', async () => {
    const component = componentRegistry.get<
      GitHubRemoveOrgMembershipInput,
      GitHubRemoveOrgMembershipOutput
    >('github.org.membership.remove');
    if (!component) throw new Error('Component not registered');

    process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';

    const fetchMock = setupFetchMock([
      new Response(
        JSON.stringify({
          accessToken: 'stored-token',
          tokenType: 'Bearer',
          scopes: ['admin:org', 'read:org'],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
      new Response(JSON.stringify({ total_count: 1, items: [{ login: 'octocat' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      new Response(null, {
        status: 404,
        statusText: 'Not Found',
      }),
    ]);

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'github-remove',
    });

    const executePayload = {
      inputs: {
        organization: 'shipsecai',
        userIdentifier: 'octocat@example.com',
        connectionId: 'connection-999',
      },
      params: {},
    };

    const result = await component.execute(executePayload, context);

    expect(result.resolvedLogin).toBe('octocat');
    expect(result.removedFromOrganization).toBe(false);
    expect(result.organizationRemovalStatus).toBe('not_found');
    expect(result.tokenScope).toBe('admin:org read:org');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3211/api/v1/integrations/connections/connection-999/token',
      expect.any(Object),
    );
  });

  it('fetches a connection token without internal auth header when not configured', async () => {
    const component = componentRegistry.get<
      GitHubRemoveOrgMembershipInput,
      GitHubRemoveOrgMembershipOutput
    >('github.org.membership.remove');
    if (!component) throw new Error('Component not registered');

    delete process.env.INTERNAL_SERVICE_TOKEN;

    const fetchMock = setupFetchMock([
      new Response(
        JSON.stringify({
          accessToken: 'stored-token',
          tokenType: 'Bearer',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
      new Response(null, {
        status: 204,
        statusText: 'No Content',
      }),
    ]);

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'github-remove',
    });
    const progressSpy = vi.spyOn(context, 'emitProgress');

    const executePayload = {
      inputs: {
        organization: 'shipsecai',
        userIdentifier: 'octocat',
        connectionId: 'connection-321',
      },
      params: {},
    };

    const result = await component.execute(executePayload, context);

    expect(result.removedFromOrganization).toBe(true);
    expect(progressSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        message: expect.stringContaining('INTERNAL_SERVICE_TOKEN env var not set'),
      }),
    );

    const firstRequest = fetchMock.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(firstRequest).toBeDefined();
    if (firstRequest && typeof firstRequest === 'object') {
      const headers = firstRequest.headers as Record<string, string>;
      expect(headers['X-Internal-Token']).toBeUndefined();
      expect(headers['Content-Type']).toBe('application/json');
    }
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://localhost:3211/api/v1/integrations/connections/connection-321/token',
    );
  });

  it('throws when team removal fails', async () => {
    const component = componentRegistry.get<
      GitHubRemoveOrgMembershipInput,
      GitHubRemoveOrgMembershipOutput
    >('github.org.membership.remove');
    if (!component) throw new Error('Component not registered');

    process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';

    const fetchMock = setupFetchMock([
      new Response(
        JSON.stringify({
          accessToken: 'stored-token',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
      new Response(null, {
        status: 500,
        statusText: 'Server Error',
      }),
    ]);

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'github-remove',
    });

    const executePayload = {
      inputs: {
        organization: 'shipsecai',
        teamSlug: 'infra',
        userIdentifier: 'octocat',
        connectionId: 'connection-456',
      },
      params: {},
    };

    await expect(component.execute(executePayload, context)).rejects.toThrow(
      /Failed to remove octocat from team infra/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3211/api/v1/integrations/connections/connection-456/token',
      expect.any(Object),
    );
  });

  it('requires a connection id', () => {
    const component = componentRegistry.get<
      GitHubRemoveOrgMembershipInput,
      GitHubRemoveOrgMembershipOutput
    >('github.org.membership.remove');
    if (!component) throw new Error('Component not registered');

    const result = component.inputs.safeParse({
      organization: 'shipsecai',
      userIdentifier: 'octocat',
      connectionId: '   ',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(['connectionId']);
  });
});

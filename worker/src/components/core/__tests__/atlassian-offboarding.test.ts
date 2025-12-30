import { beforeAll, afterEach, describe, expect, it, vi } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';

describe('atlassian offboarding component', () => {
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    // Ensure all components are registered before tests run
    require('../../index');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const getComponent = () => {
    const component = componentRegistry.get('shipsec.atlassian.offboarding');
    if (!component) {
      throw new Error('Component not registered');
    }
    return component;
  };

  const createJsonResponse = (data: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });

  it('should be registered in the component registry', () => {
    const component = componentRegistry.get('shipsec.atlassian.offboarding');
    expect(component).toBeDefined();
    expect(component?.label).toBe('Atlassian Offboarding');
    expect(component?.category).toBe('it_ops');
  });

  it('deletes matching users with direct access token and summarises results', async () => {
    const component = getComponent();
    const orgId = 'f6a6e7f2-9011-4ff9-8bd0-34a6df4e687a';

    const fetchMock = vi
      .fn<(url: unknown, init?: any) => Promise<Response>>()
      .mockImplementationOnce((url, init) => {
        expect(url).toBe(`https://api.atlassian.com/admin/v1/orgs/${orgId}/users/search`);
        expect(init?.method).toBe('POST');
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer direct-token',
          Accept: 'application/json',
          'Content-Type': 'application/json',
        });
        const body = JSON.parse(init?.body?.toString() ?? '{}');
        expect(body).toEqual({
          limit: 20,
          emailUsernames: {
            eq: ['alice', 'alias', 'bob'],
          },
        });
        return Promise.resolve(
          createJsonResponse({
            data: [
              { accountId: 'acc-1', email: 'alice@example.com' },
              { accountId: 'acc-1', email: 'alias@example.com' },
              { account_id: 'acc-2', emailUsername: 'bob' },
            ],
          }),
        );
      })
      .mockImplementationOnce((url, init) => {
        expect(url).toBe(`https://api.atlassian.com/admin/v1/orgs/${orgId}/directory/users/acc-1`);
        expect(init?.method).toBe('DELETE');
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer direct-token',
          Accept: 'application/json',
        });
        return Promise.resolve(new Response(null, { status: 204 }));
      })
      .mockImplementationOnce((url, init) => {
        expect(url).toBe(`https://api.atlassian.com/admin/v1/orgs/${orgId}/directory/users/acc-2`);
        expect(init?.method).toBe('DELETE');
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer direct-token',
          Accept: 'application/json',
        });
        return Promise.resolve(new Response(null, { status: 200 }));
      });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'atlassian-offboarding-success',
    });

    const params = component.inputSchema.parse({
      orgId,
      accessToken: 'direct-token',
      emailUsernames: ' Alice@example.com , alias@example.com\nBOB ',
    });

    const result = await component.execute(params, context);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.orgId).toBe(orgId);
    expect(result.requestedEmails).toEqual(['alice', 'alias', 'bob']);
    expect(result.summary).toEqual({
      requested: 3,
      found: 3,
      deleted: 3,
      failed: 0,
    });
    expect(result.results).toEqual([
      { emailUsername: 'alice', accountId: 'acc-1', status: 'deleted' },
      {
        emailUsername: 'alias',
        accountId: 'acc-1',
        status: 'deleted',
        message: 'Account already deleted earlier in this run.',
      },
      { emailUsername: 'bob', accountId: 'acc-2', status: 'deleted' },
    ]);
    expect(result.searchRaw).toEqual({
      data: [
        { accountId: 'acc-1', email: 'alice@example.com' },
        { accountId: 'acc-1', email: 'alias@example.com' },
        { account_id: 'acc-2', emailUsername: 'bob' },
      ],
    });
  });

  it('rejects inputs that omit accessToken', () => {
    const component = getComponent();
    expect(() =>
      component.inputSchema.parse({
        orgId: 'org-123',
        emailUsernames: ['alice'],
      }),
    ).toThrowError(/expected string/);
  });

  it('throws when provided access token trims to an empty string', async () => {
    const component = getComponent();
    const params = component.inputSchema.parse({
      orgId: 'org-123',
      emailUsernames: ['alice'],
      accessToken: '   ',
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'atlassian-offboarding-empty-token',
    });

    await expect(component.execute(params, context)).rejects.toThrow(
      /Access token is required to call the Atlassian Admin API/,
    );
  });

  it('throws when no valid usernames remain after trimming', async () => {
    const component = getComponent();
    const params = component.inputSchema.parse({
      orgId: 'org-123',
      accessToken: 'token',
      emailUsernames: ['   ', '\n'],
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'atlassian-offboarding-empty-input',
    });

    await expect(component.execute(params, context)).rejects.toThrow(
      'No valid email usernames provided after trimming input.',
    );
  });

  it('propagates network errors from the search request', async () => {
    const component = getComponent();

    const fetchMock = vi.fn<(url: unknown, init?: any) => Promise<Response>>().mockRejectedValueOnce(
      new Error('network down'),
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const params = component.inputSchema.parse({
      orgId: 'org-123',
      accessToken: 'token',
      emailUsernames: ['alice'],
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'atlassian-offboarding-network-search',
    });

    await expect(component.execute(params, context)).rejects.toThrow(
      'Failed to call Atlassian search API: network down',
    );
  });

  it('throws when search API responds with non-2xx status', async () => {
    const component = getComponent();

    const fetchMock = vi.fn<(url: unknown, init?: any) => Promise<Response>>().mockResolvedValueOnce(
        new Response('{"error":"bad request"}', {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const params = component.inputSchema.parse({
      orgId: 'org-123',
      accessToken: 'token',
      emailUsernames: ['alice'],
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'atlassian-offboarding-search-non-ok',
    });

    await expect(component.execute(params, context)).rejects.toThrow(
      /{"error":"bad request"}/,
    );
  });

  it('throws when search response JSON cannot be parsed', async () => {
    const component = getComponent();

    const fetchMock = vi
      .fn<(url: unknown, init?: any) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const params = component.inputSchema.parse({
      orgId: 'org-123',
      accessToken: 'token',
      emailUsernames: ['alice'],
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'atlassian-offboarding-json-fail',
    });

    await expect(component.execute(params, context)).rejects.toThrow(
      /Unable to parse Atlassian search response JSON/,
    );
  });

  it('marks usernames as not_found when the search response lacks matches', async () => {
    const component = getComponent();

    const fetchMock = vi
      .fn<(url: unknown, init?: any) => Promise<Response>>()
      .mockResolvedValueOnce(createJsonResponse({ values: [] }));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const params = component.inputSchema.parse({
      orgId: 'org-123',
      accessToken: 'token',
      emailUsernames: ['missing-user'],
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'atlassian-offboarding-not-found',
    });

    const result = await component.execute(params, context);

    expect(result.results).toEqual([
      {
        emailUsername: 'missing-user',
        accountId: null,
        status: 'not_found',
        message: 'No matching Atlassian account returned by search API.',
      },
    ]);
    expect(result.summary).toEqual({
      requested: 1,
      found: 0,
      deleted: 0,
      failed: 0,
    });
  });

  it('records deletion errors when delete call fails', async () => {
    const component = getComponent();

    const fetchMock = vi
      .fn<(url: unknown, init?: any) => Promise<Response>>()
      .mockResolvedValueOnce(
        createJsonResponse({ data: [{ accountId: 'acc-42', emailUsername: 'err-user' }] }),
      )
      .mockResolvedValueOnce(
        new Response('{"error":"bad gateway"}', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const params = component.inputSchema.parse({
      orgId: 'org-123',
      accessToken: 'token',
      emailUsernames: ['err-user'],
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'atlassian-offboarding-delete-fail',
    });

    const result = await component.execute(params, context);

    expect(result.results).toEqual([
      expect.objectContaining({
        emailUsername: 'err-user',
        accountId: 'acc-42',
        status: 'error',
      }),
    ]);
    expect(result.summary.failed).toBe(1);
  });

  it('records deletion errors when delete call throws', async () => {
    const component = getComponent();

    const fetchMock = vi
      .fn<(url: unknown, init?: any) => Promise<Response>>()
      .mockResolvedValueOnce(
        createJsonResponse({ users: [{ accountId: 'acc-77', emailUsername: 'network' }] }),
      )
      .mockRejectedValueOnce(new Error('timeout'));

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const params = component.inputSchema.parse({
      orgId: 'org-123',
      accessToken: 'token',
      emailUsernames: ['network'],
    });

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'atlassian-offboarding-delete-network',
    });

    const result = await component.execute(params, context);

    expect(result.results).toEqual([
      {
        emailUsername: 'network',
        accountId: 'acc-77',
        status: 'error',
        message: 'Network error while calling delete API: timeout',
      },
    ]);
    expect(result.summary.failed).toBe(1);
  });
});

import { afterEach, beforeAll, describe, expect, it, vi } from 'bun:test';
import { componentRegistry } from '@shipsec/component-sdk';
import { createMockExecutionContext } from '../../../testing/test-utils';

describe('jira.create-issue', () => {
  beforeAll(async () => {
    await import('../create-issue');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a Jira issue through an OAuth-backed connection', async () => {
    const component = componentRegistry.get('jira.create-issue');
    if (!component) throw new Error('jira.create-issue not registered');

    const httpFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          provider: 'jira',
          credentialType: 'oauth',
          data: {
            accessToken: 'oauth-token-123',
            cloudId: 'cloud-123',
            siteUrl: 'https://example.atlassian.net',
            siteName: 'Example Jira',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: '10001',
          key: 'SEC-42',
          self: 'https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue/10001',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ) as any,
    );

    const context = createMockExecutionContext({
      metadata: {
        runId: 'run-1',
        componentRef: 'jira-create-issue',
        organizationId: 'org-1',
      } as any,
      http: {
        fetch: httpFetch as any,
        toCurl: vi.fn(() => ''),
      },
    });

    const result = await component.execute(
      {
        inputs: {
          connectionId: 'jira-conn-1',
        },
        params: {
          connectionId: '',
          webTriggerUrl: 'https://unused.example.com',
          sharedSecret: '',
          projectKey: 'SEC',
          issueType: 'Task',
          summary: 'Investigate security issue',
          description: 'A workflow-created issue',
          labels: 'security,automation',
          priority: 'High',
          assigneeAccountId: '',
        },
      },
      context,
    );

    expect(httpFetch).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.atlassian.com/ex/jira/cloud-123/rest/api/3/issue',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer oauth-token-123',
        }),
      }),
    );
    expect(result).toEqual({
      issueKey: 'SEC-42',
      issueId: '10001',
      issueUrl: 'https://example.atlassian.net/browse/SEC-42',
    });
  });

  it('creates a Jira issue through a Forge app connection', async () => {
    const component = componentRegistry.get('jira.create-issue');
    if (!component) throw new Error('jira.create-issue not registered');

    const httpFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          provider: 'jira',
          credentialType: 'forge_app',
          data: {
            webTriggerUrl: 'https://forge.example.com/x1',
            sharedSecret: 'secret-123',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          result: {
            content: [
              {
                text: JSON.stringify({
                  id: '10002',
                  key: 'SEC-99',
                  self: 'https://example.atlassian.net/rest/api/3/issue/10002',
                }),
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ) as any,
    );

    const context = createMockExecutionContext({
      metadata: {
        runId: 'run-2',
        componentRef: 'jira-create-issue',
        organizationId: 'org-1',
      } as any,
      http: {
        fetch: httpFetch as any,
        toCurl: vi.fn(() => ''),
      },
    });

    const result = await component.execute(
      {
        inputs: {
          connectionId: 'jira-conn-2',
        },
        params: {
          connectionId: '',
          webTriggerUrl: 'https://unused.example.com',
          sharedSecret: '',
          projectKey: 'SEC',
          issueType: 'Task',
          summary: 'Create issue via app',
          description: '',
          labels: '',
          priority: 'Medium',
          assigneeAccountId: '',
        },
      },
      context,
    );

    expect(httpFetch).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://forge.example.com/x1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-shipsec-secret': 'secret-123',
        }),
      }),
    );
    expect(result).toEqual({
      issueKey: 'SEC-99',
      issueId: '10002',
      issueUrl: 'https://example.atlassian.net/browse/SEC-99',
    });
  });
});

import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { PostPrCommentInput, PostPrCommentOutput } from '../post-pr-comment';

// Store the original fetch
const originalFetch = globalThis.fetch;

describe('github.pr.comment component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function getComponent() {
    const component = componentRegistry.get<PostPrCommentInput, PostPrCommentOutput>(
      'github.pr.comment',
    );
    if (!component) throw new Error('Component not registered');
    return component;
  }

  function createContext() {
    return createExecutionContext({
      runId: 'test-run',
      componentRef: 'post-pr-comment-test',
      secrets: {
        get: vi.fn(async (secretId: string) =>
          secretId === 'github-installation-12345' ? { value: 'mock-github-token' } : null,
        ),
        list: vi.fn(async () => []),
      },
    });
  }

  const baseInputs = {
    installationId: 12345,
    owner: 'myorg',
    repo: 'myrepo',
    prNumber: 42,
    body: '## Scan Results\nNo findings detected.',
  };

  it('should POST a new comment when no existingCommentId is provided', async () => {
    const component = getComponent();
    const context = createContext();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 99001,
        html_url: 'https://github.com/myorg/myrepo/pull/42#issuecomment-99001',
      }),
    });

    const result = await component.execute({ inputs: baseInputs, params: {} }, context);

    expect(result.commentId).toBe(99001);
    expect(result.commentUrl).toBe('https://github.com/myorg/myrepo/pull/42#issuecomment-99001');

    // Verify POST was called (not PATCH)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/myorg/myrepo/issues/42/comments');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ body: baseInputs.body });
  });

  it('should PATCH an existing comment when existingCommentId is provided', async () => {
    const component = getComponent();
    const context = createContext();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 88001,
        html_url: 'https://github.com/myorg/myrepo/pull/42#issuecomment-88001',
      }),
    });

    const result = await component.execute(
      { inputs: { ...baseInputs, existingCommentId: 88001 }, params: {} },
      context,
    );

    expect(result.commentId).toBe(88001);

    // Verify PATCH was called
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/myorg/myrepo/issues/comments/88001');
    expect(options.method).toBe('PATCH');
  });

  it('should fall back to POST when PATCH returns 404', async () => {
    const component = getComponent();
    const context = createContext();

    // PATCH returns 404
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    });

    // POST succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 99002,
        html_url: 'https://github.com/myorg/myrepo/pull/42#issuecomment-99002',
      }),
    });

    const result = await component.execute(
      { inputs: { ...baseInputs, existingCommentId: 77001 }, params: {} },
      context,
    );

    expect(result.commentId).toBe(99002);

    // Verify PATCH was attempted first, then POST
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [patchUrl, patchOptions] = mockFetch.mock.calls[0];
    expect(patchUrl).toContain('/issues/comments/77001');
    expect(patchOptions.method).toBe('PATCH');

    const [postUrl, postOptions] = mockFetch.mock.calls[1];
    expect(postUrl).toBe('https://api.github.com/repos/myorg/myrepo/issues/42/comments');
    expect(postOptions.method).toBe('POST');
  });

  it('should fall back to POST when PATCH returns 410', async () => {
    const component = getComponent();
    const context = createContext();

    // PATCH returns 410
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 410,
      text: async () => 'Gone',
    });

    // POST succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 99003,
        html_url: 'https://github.com/myorg/myrepo/pull/42#issuecomment-99003',
      }),
    });

    const result = await component.execute(
      { inputs: { ...baseInputs, existingCommentId: 77002 }, params: {} },
      context,
    );

    expect(result.commentId).toBe(99003);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][1].method).toBe('PATCH');
    expect(mockFetch.mock.calls[1][1].method).toBe('POST');
  });

  it('should fall back to POST when PATCH fails with other error', async () => {
    const component = getComponent();
    const context = createContext();

    // PATCH returns 500
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    // POST succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 99004,
        html_url: 'https://github.com/myorg/myrepo/pull/42#issuecomment-99004',
      }),
    });

    const result = await component.execute(
      { inputs: { ...baseInputs, existingCommentId: 77003 }, params: {} },
      context,
    );

    expect(result.commentId).toBe(99004);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should throw when POST fails', async () => {
    const component = getComponent();
    const context = createContext();

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    await expect(component.execute({ inputs: baseInputs, params: {} }, context)).rejects.toThrow(
      'Failed to create PR comment',
    );
  });

  it('should throw when installationId is missing', async () => {
    const component = getComponent();
    const context = createContext();

    await expect(
      component.execute(
        { inputs: { ...baseInputs, installationId: undefined }, params: {} },
        context,
      ),
    ).rejects.toThrow('Installation ID is required');
  });
});

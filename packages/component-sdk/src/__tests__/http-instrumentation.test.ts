import { describe, expect, it } from 'bun:test';

import { createExecutionContext } from '../context';
import type { ITraceService, TraceEvent } from '../interfaces';

describe('HTTP instrumentation', () => {
  it('emits request/response events and preserves response body', async () => {
    const recorded: TraceEvent[] = [];
    const trace: ITraceService = {
      record: (event) => {
        recorded.push(event);
      },
    };

    const context = createExecutionContext({
      runId: 'run-http',
      componentRef: 'test.http',
      trace,
    });

    const originalFetch = globalThis.fetch;
    const mockFetch = Object.assign(
      async () =>
        new Response('hello world', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        }),
      { preconnect: () => {} },
    ) as typeof fetch;
    globalThis.fetch = mockFetch;

    try {
      const response = await context.http.fetch('https://example.com/hello');
      const body = await response.text();
      expect(body).toBe('hello world');

      const types = recorded.map((event) => event.type);
      expect(types).toContain('HTTP_REQUEST_SENT');
      expect(types).toContain('HTTP_RESPONSE_RECEIVED');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('emits HTTP_REQUEST_ERROR when fetch fails', async () => {
    const recorded: TraceEvent[] = [];
    const trace: ITraceService = {
      record: (event) => {
        recorded.push(event);
      },
    };

    const context = createExecutionContext({
      runId: 'run-http-error',
      componentRef: 'test.http',
      trace,
    });

    const originalFetch = globalThis.fetch;
    const mockFetch = Object.assign(
      async () => {
        throw new Error('boom');
      },
      { preconnect: () => {} },
    ) as typeof fetch;
    globalThis.fetch = mockFetch;

    try {
      await expect(context.http.fetch('https://example.com/fail')).rejects.toThrow('boom');
      const types = recorded.map((event) => event.type);
      expect(types).toContain('HTTP_REQUEST_SENT');
      expect(types).toContain('HTTP_REQUEST_ERROR');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

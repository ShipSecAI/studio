/**
 * Integration test for Webhook component with real HTTP endpoints.
 * Prefers the locally hosted testing endpoint but falls back to httpbin.org when unavailable.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { componentRegistry, runComponentWithRunner } from '@shipsec/component-sdk';
import type { ComponentDefinition, ExecutionContext } from '@shipsec/component-sdk';
import '../../index'; // Register all components

type WebhookTestTarget = { baseUrl: string };

type WebhookComponentInput = {
  url: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
  method?: 'POST' | 'PUT' | 'PATCH';
  timeoutMs?: number;
  retries?: number;
};

type WebhookComponentOutput = {
  status: 'sent' | 'failed';
  statusCode?: number;
  statusText?: string;
  responseBody?: string;
  error?: string;
  attempts: number;
};

interface WebhookRecord {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string | string[]>;
  body: unknown;
  receivedAt: string;
}

const DEFAULT_TEST_WEBHOOK_URL =
  process.env.TEST_WEBHOOK_URL ?? 'http://127.0.0.1:3000/testing/webhooks';

interface ResolvedTarget {
  target: WebhookTestTarget;
  cleanup?: () => Promise<void>;
}

describe('Webhook Integration (Real HTTP)', () => {
  let target: WebhookTestTarget;
  let cleanup: (() => Promise<void>) | undefined;
  let component!: ComponentDefinition<WebhookComponentInput, WebhookComponentOutput>;

  beforeAll(async () => {
    const resolved = await resolveTestTarget();
    target = resolved.target;
    cleanup = resolved.cleanup;
    const registryComponent = componentRegistry.get('core.webhook.post');
    if (!registryComponent) {
      throw new Error('core.webhook.post component is not registered');
    }
    component = registryComponent as ComponentDefinition<
      WebhookComponentInput,
      WebhookComponentOutput
    >;
    await clearLocalRecords(target);
  });

  afterEach(async () => {
    await clearLocalRecords(target);
  });

  afterAll(async () => {
    if (cleanup) {
      await cleanup();
    }
  });

  const context: ExecutionContext = {
    runId: 'test-run',
    componentRef: 'core.webhook.post',
    logger: {
      info: (...args: unknown[]) => console.log('[INFO]', ...args),
      error: (...args: unknown[]) => console.error('[ERROR]', ...args),
    },
    emitProgress: (progress) => {
      const message = typeof progress === 'string' ? progress : progress.message;
      console.log('[PROGRESS]', message);
    },
  };

  test('should send webhook successfully', async () => {
    const payload = {
      test: 'webhook-integration',
      timestamp: new Date().toISOString(),
      data: { value: 42 },
    };

    const result = await runComponentWithRunner(
      component.runner,
      component.execute,
      {
        url: target.baseUrl,
        payload,
      },
      context,
    );

    expect(result.status).toBe('sent');
    expect(result.statusCode).toBeGreaterThanOrEqual(200);
    expect(result.statusCode).toBeLessThan(400);
    expect(result.attempts).toBe(1);

    const latest = await fetchLatestRecord(target);
    expect(latest.body).toMatchObject({
      test: 'webhook-integration',
      data: { value: 42 },
    });
  }, 30000);

  test('should handle 404 errors correctly', async () => {
    const result = await runComponentWithRunner(
      component.runner,
      component.execute,
      {
        url: `${target.baseUrl}?status=404`,
        payload: { test: true },
        retries: 2,
      },
      context,
    );

    expect(result.status).toBe('failed');
    expect(result.statusCode).toBe(404);
    expect(result.attempts).toBe(1);
  }, 30000);

  test('should send webhook with custom headers', async () => {
    const headers = {
      'X-Custom-Header': 'test-value',
      Authorization: 'Bearer test-token',
    };

    const result = await runComponentWithRunner(
      component.runner,
      component.execute,
      {
        url: target.baseUrl,
        payload: { test: true },
        headers,
      },
      context,
    );

    expect(result.status).toBe('sent');
    expect(result.statusCode).toBeGreaterThanOrEqual(200);
    expect(result.statusCode).toBeLessThan(300);
    const latest = await fetchLatestRecord(target);
    expect(latest.headers['x-custom-header']).toBe('test-value');
    expect(latest.headers.authorization).toBe('Bearer test-token');
  }, 30000);

  test('should support PUT method', async () => {
    const result = await runComponentWithRunner(
      component.runner,
      component.execute,
      {
        url: `${target.baseUrl}?status=200`,
        method: 'PUT',
        payload: { updated: true },
      },
      context,
    );

    expect(result.status).toBe('sent');
    expect(result.statusCode).toBeGreaterThanOrEqual(200);
    expect(result.statusCode).toBeLessThan(300);
  }, 30000);

  test('should handle retryable errors gracefully', async () => {
    const result = await runComponentWithRunner(
      component.runner,
      component.execute,
      {
        url: `${target.baseUrl}?status=500`,
        payload: { test: true },
        retries: 1,
        timeoutMs: 2000,
      },
      context,
    );

    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
    expect(result.attempts).toBeGreaterThan(1);
  }, 30000);
});

async function resolveTestTarget(): Promise<ResolvedTarget> {
  try {
    const response = await fetch(DEFAULT_TEST_WEBHOOK_URL, { method: 'GET' });
    if (response.ok) {
      return { target: { baseUrl: DEFAULT_TEST_WEBHOOK_URL } };
    }
  } catch {
    // Continue to inline server fallback
  }

  const inline = await startInlineWebhookServer();
  return {
    target: { baseUrl: inline.baseUrl },
    cleanup: inline.close,
  };
}

async function clearLocalRecords(target: WebhookTestTarget): Promise<void> {
  await fetch(target.baseUrl, { method: 'DELETE' });
}

async function fetchLatestRecord(target: WebhookTestTarget): Promise<WebhookRecord> {
  const response = await fetch(`${target.baseUrl}/latest`);
  if (!response.ok) {
    throw new Error(`Failed to fetch latest webhook record: ${response.status}`);
  }
  return (await response.json()) as WebhookRecord;
}

async function startInlineWebhookServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const records: WebhookRecord[] = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    const sendJson = (status: number, payload: unknown) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(payload));
    };

    const normalizeHeaders = (headers: Record<string, string | string[] | undefined>) =>
      Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
        if (value === undefined) {
          return acc;
        }
        acc[key] = Array.isArray(value) ? value.join(', ') : value;
        return acc;
      }, {});

    const parseBody = async (): Promise<string> => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    };

    if (
      req.method &&
      ['POST', 'PUT', 'PATCH'].includes(req.method) &&
      url.pathname === '/testing/webhooks'
    ) {
      const bodyText = await parseBody();
      let body: unknown = {};
      if (bodyText.length > 0) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          body = bodyText;
        }
      }

      const id = randomUUID();
      const receivedAt = new Date().toISOString();
      records.push({
        id,
        method: req.method,
        path: url.pathname,
        headers: normalizeHeaders(req.headers as Record<string, string | string[] | undefined>),
        query: Object.fromEntries(
          [...url.searchParams.entries()].map(([key, value]) => [key, value]),
        ),
        body,
        receivedAt,
      });

      const statusParam = Number.parseInt(url.searchParams.get('status') ?? '', 10);
      const status =
        Number.isNaN(statusParam) || statusParam < 100 || statusParam > 599 ? 201 : statusParam;
      const delayParam = Number.parseInt(url.searchParams.get('delayMs') ?? '', 10);
      const delay = Number.isNaN(delayParam) || delayParam <= 0 ? 0 : Math.min(delayParam, 60000);

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      sendJson(status, { id, receivedAt });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/testing/webhooks') {
      sendJson(200, records);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/testing/webhooks/latest') {
      const latest = records.at(-1);
      if (!latest) {
        sendJson(404, { message: 'No webhook calls recorded yet' });
        return;
      }
      sendJson(200, latest);
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/testing/webhooks/')) {
      const id = url.pathname.split('/').at(-1);
      const record = records.find((item) => item.id === id);
      if (!record) {
        sendJson(404, { message: `Webhook call ${id} not found` });
        return;
      }
      sendJson(200, record);
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/testing/webhooks') {
      const cleared = records.length;
      records.length = 0;
      sendJson(200, { cleared });
      return;
    }

    sendJson(404, { message: 'Not Found' });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/testing/webhooks`;

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

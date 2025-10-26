import { describe, it, expect, beforeAll, afterEach, vi } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '../../index';
import type { WebhookInput, WebhookOutput } from '../webhook';

describe('webhook component', () => {
  beforeAll(async () => {
    await import('../../index');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be registered', () => {
    const component = componentRegistry.get<WebhookInput, WebhookOutput>('core.webhook.post');
    expect(component).toBeDefined();
    expect(component!.label).toBe('Webhook');
    expect(component!.category).toBe('output');
  });

  it('should return sent status (stub)', async () => {
    const component = componentRegistry.get<WebhookInput, WebhookOutput>('core.webhook.post');
    if (!component) throw new Error('Component not registered');

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const context = createExecutionContext({
      runId: 'test-run',
      componentRef: 'webhook-test',
    });

    const params = component.inputSchema.parse({
      url: 'https://example.com/webhook',
      payload: {
        event: 'test',
        data: { value: 42 },
      },
    });

    const result = await component.execute(params, context);

    expect(result.status).toBe('sent');
  });

  it('should validate URL format', () => {
    const component = componentRegistry.get<WebhookInput, WebhookOutput>('core.webhook.post');
    if (!component) throw new Error('Component not registered');

    expect(() =>
      component.inputSchema.parse({
        url: 'not-a-url',
        payload: {},
      }),
    ).toThrow();

    expect(() =>
      component.inputSchema.parse({
        url: 'https://valid.com/hook',
        payload: {},
      }),
    ).not.toThrow();
  });
});

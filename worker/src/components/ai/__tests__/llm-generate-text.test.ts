import { beforeEach, describe, expect, test, vi } from 'bun:test';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry } from '@shipsec/component-sdk';

import '../llm-generate-text';

describe('core.ai.generate-text', () => {
  beforeEach(() => {
    delete process.env.CHAT_AI_BASE_URL;
    delete process.env.CHAT_AI_API_KEY;
    process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
  });

  // TODO: AI gateway routing (rewrite gemini → openai proxy) is not yet implemented
  // in buildModelFactory. This test verifies current behavior: gemini provider
  // always uses the Google client directly, regardless of CHAT_AI_BASE_URL.
  test('calls gemini provider directly and emits usage trace', async () => {
    const component = componentRegistry.get('core.ai.generate-text');
    expect(component).toBeDefined();

    const createOpenAIMock = vi.fn(() => (modelId: string) => ({ provider: 'openai', modelId }));
    const createGoogleMock = vi.fn(() => (modelId: string) => ({ provider: 'gemini', modelId }));
    const generateTextMock = vi.fn(async () => ({
      text: 'ok',
      finishReason: 'stop',
      response: { id: 'resp-1' },
      usage: { totalTokens: 1500, inputTokens: 1000, outputTokens: 500 },
    }));

    const publishMock = vi.fn(async () => {});
    const context = {
      runId: 'run-1',
      componentRef: 'core.ai.generate-text',
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      emitProgress: () => {},
      metadata: {
        runId: 'run-1',
        componentRef: 'core.ai.generate-text',
        organizationId: 'org-1',
      },
      agentTracePublisher: {
        publish: publishMock,
      },
      http: {
        fetch: async (input: any, init: any) => globalThis.fetch(input as any, init),
        toCurl: () => '',
      },
    } as unknown as ExecutionContext;

    const execute = component!.execute as any;
    const result = await execute(
      {
        inputs: {
          userPrompt: 'hello',
          chatModel: {
            provider: 'gemini',
            modelId: 'gemini-2.5-flash',
          },
          modelApiKey: 'provider-key',
        },
        params: {
          systemPrompt: '',
          temperature: 0.2,
          maxTokens: 200,
        },
      },
      context,
      {
        generateText: generateTextMock as any,
        createOpenAI: createOpenAIMock as any,
        createGoogleGenerativeAI: createGoogleMock as any,
      },
    );

    expect(result.responseText).toBe('ok');
    expect(createGoogleMock).toHaveBeenCalled();
    expect(createOpenAIMock).not.toHaveBeenCalled();
  });

  test('keeps a user-provided key when AI gateway routing is enabled', async () => {
    process.env.CHAT_AI_BASE_URL = 'http://gateway.local:4000/v1';
    process.env.CHAT_AI_API_KEY = 'shared-gateway-key';

    const component = componentRegistry.get('core.ai.generate-text');
    expect(component).toBeDefined();

    const createOpenAIMock = vi.fn(() => (modelId: string) => ({ provider: 'openai', modelId }));
    const createGoogleMock = vi.fn(() => (modelId: string) => ({ provider: 'gemini', modelId }));
    const generateTextMock = vi.fn(async () => ({
      text: 'ok',
      finishReason: 'stop',
      response: { id: 'resp-2' },
      usage: { totalTokens: 10, inputTokens: 6, outputTokens: 4 },
    }));

    const context = {
      runId: 'run-2',
      componentRef: 'core.ai.generate-text',
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      emitProgress: () => {},
      metadata: {
        runId: 'run-2',
        componentRef: 'core.ai.generate-text',
        organizationId: 'org-1',
      },
      agentTracePublisher: {
        publish: vi.fn(async () => {}),
      },
      http: {
        fetch: async (input: any, init: any) => globalThis.fetch(input as any, init),
        toCurl: () => '',
      },
    } as unknown as ExecutionContext;

    const execute = component!.execute as any;
    await execute(
      {
        inputs: {
          userPrompt: 'hello',
          chatModel: {
            provider: 'openai',
            modelId: 'gpt-4o-mini',
          },
          modelApiKey: 'provider-key',
        },
        params: {
          systemPrompt: '',
          temperature: 0.2,
          maxTokens: 200,
        },
      },
      context,
      {
        generateText: generateTextMock as any,
        createOpenAI: createOpenAIMock as any,
        createGoogleGenerativeAI: createGoogleMock as any,
      },
    );

    expect(createGoogleMock).not.toHaveBeenCalled();
    expect(createOpenAIMock).toHaveBeenCalled();
    const openAiCall = (createOpenAIMock as any).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(openAiCall).toMatchObject({
      apiKey: 'provider-key',
      baseURL: 'http://gateway.local:4000/v1',
    });
  });
});

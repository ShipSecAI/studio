import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { componentRegistry, type ExecutionContext } from '@shipsec/component-sdk';
import { createOpenAI as createOpenAIImpl } from '@ai-sdk/openai';
import { type GenerateTextResult, type ToolSet } from 'ai';
import type { GenerateTextFn, CreateOpenAIFn } from '../openai-chat';

type GenerateTextParams = Parameters<GenerateTextFn>[0];

const createGenerateTextResult = (): GenerateTextResult<ToolSet, never> => ({
    content: [],
    text: 'hello world',
    reasoning: [],
    reasoningText: undefined,
  files: [],
  sources: [],
  toolCalls: [],
  staticToolCalls: [],
  dynamicToolCalls: [],
  toolResults: [],
  staticToolResults: [],
  dynamicToolResults: [],
  finishReason: 'stop',
  usage: {
    inputTokens: 5,
    outputTokens: 7,
    totalTokens: 12,
  },
  totalUsage: {
    inputTokens: 5,
    outputTokens: 7,
    totalTokens: 12,
  },
  warnings: undefined,
  request: {},
  response: {
    id: 'resp',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    modelId: 'gpt-4o-mini',
    messages: [],
  },
    providerMetadata: undefined,
    steps: [],
  experimental_output: undefined as never,
});

let generateTextCalls: GenerateTextParams[] = [];
const generateTextMock = (async (_args: GenerateTextParams) => {
  generateTextCalls.push(_args);
  return createGenerateTextResult();
}) as GenerateTextFn;
const createOpenAIMock = mock<CreateOpenAIFn>((options) => createOpenAIImpl(options));

beforeEach(() => {
  generateTextCalls = [];
  createOpenAIMock.mockClear();
});

describe('core.openai.chat component', () => {
  it('resolves API key from secrets and calls the provider', async () => {
    const definition = componentRegistry.get<any, any>('core.openai.chat');
    expect(definition).toBeDefined();

    const secretsGet = mock(async () => ({ value: 'sk-secret-from-store', version: 1 }));
    const context: ExecutionContext = {
      runId: 'test-run',
      componentRef: 'node-1',
      logger: { info: mock(() => {}), error: mock(() => {}) },
      emitProgress: mock(() => {}),
      metadata: { runId: 'test-run', componentRef: 'node-1' },
      secrets: {
        get: secretsGet,
        list: mock(async () => []),
      },
    };

    const result = await (definition!.execute as any)(
      {
        systemPrompt: 'system prompt',
        userPrompt: 'Hello?',
        model: 'gpt-4o-mini',
        temperature: 0.5,
        maxTokens: 256,
        apiBaseUrl: '',
        apiKey: 'a2e6b4ad-1234-4e4c-b64f-0123456789ab',
      },
      context,
      {
        generateText: generateTextMock,
        createOpenAI: createOpenAIMock,
      }
    );

    expect(secretsGet).toHaveBeenCalledWith('a2e6b4ad-1234-4e4c-b64f-0123456789ab');
    expect(createOpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-secret-from-store' }),
    );
    expect(generateTextCalls).toHaveLength(1);
    expect(generateTextCalls[0]).toEqual(
      expect.objectContaining({
        prompt: 'Hello?',
        system: 'system prompt',
        temperature: 0.5,
        maxOutputTokens: 256,
      }),
    );
    expect(result.chatModel).toEqual(
      expect.objectContaining({
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        apiKeySecretId: 'a2e6b4ad-1234-4e4c-b64f-0123456789ab',
      }),
    );
    expect(result.chatModel.apiKey).toBeUndefined();
  });

  it('throws when secret cannot be resolved', async () => {
    const definition = componentRegistry.get<any, any>('core.openai.chat');
    expect(definition).toBeDefined();

    const secretsGet = mock(async () => null);
    const context: ExecutionContext = {
      runId: 'test-run',
      componentRef: 'node-1',
      logger: { info: mock(() => {}), error: mock(() => {}) },
      emitProgress: mock(() => {}),
      metadata: { runId: 'test-run', componentRef: 'node-1' },
      secrets: {
        get: secretsGet,
        list: mock(async () => []),
      },
    };

    await expect(
      (definition!.execute as any)(
        {
          systemPrompt: '',
          userPrompt: 'Hello',
          model: 'gpt-4o-mini',
          temperature: 0.7,
          maxTokens: 512,
          apiBaseUrl: '',
          apiKey: 'missing-secret',
        },
        context,
        {
        generateText: generateTextMock,
        createOpenAI: createOpenAIMock,
      }
      ),
    ).rejects.toThrow(/secret "missing-secret" was not found/i);
  });
});

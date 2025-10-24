import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { componentRegistry, type ExecutionContext } from '@shipsec/component-sdk';
import { createGoogleGenerativeAI as createGoogleGenerativeAIImpl } from '@ai-sdk/google';
import { type GenerateTextResult, type ToolSet } from 'ai';
import type { GenerateTextFn, CreateGoogleGenerativeAIFn } from '../gemini-chat';

type GenerateTextParams = Parameters<GenerateTextFn>[0];

const createGenerateTextResult = (): GenerateTextResult<ToolSet, never> => ({
    content: [],
    text: 'gemini response',
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
    inputTokens: 10,
    outputTokens: 12,
    totalTokens: 22,
  },
  totalUsage: {
    inputTokens: 10,
    outputTokens: 12,
    totalTokens: 22,
  },
  warnings: undefined,
  request: {},
  response: {
    id: 'resp',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    modelId: 'gemini-2.5-flash',
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
const createGeminiMock = mock<CreateGoogleGenerativeAIFn>((options) =>
  createGoogleGenerativeAIImpl(options),
);

beforeEach(() => {
  generateTextCalls = [];
  createGeminiMock.mockClear();
});

import '../gemini-chat';

describe('core.gemini.chat component', () => {
  it('resolves API key from secrets and calls the provider', async () => {
    const definition = componentRegistry.get<any, any>('core.gemini.chat');
    expect(definition).toBeDefined();

    const secretsGet = mock(async () => ({ value: 'gm-secret-from-store', version: 1 }));
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
        systemPrompt: '',
        userPrompt: 'Explain the status.',
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        maxTokens: 512,
        apiBaseUrl: '',
        apiKey: '9b4ce843-4c0a-4d6c-9a27-123456789abc',
      },
      context,
      {
        generateText: generateTextMock,
        createGoogleGenerativeAI: createGeminiMock,
      }
    );

    expect(secretsGet).toHaveBeenCalledWith('9b4ce843-4c0a-4d6c-9a27-123456789abc');
    expect(createGeminiMock).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'gm-secret-from-store' }),
    );
    expect(generateTextCalls).toHaveLength(1);
    expect(generateTextCalls[0]).toEqual(
      expect.objectContaining({
        prompt: 'Explain the status.',
        temperature: 0.7,
        maxOutputTokens: 512,
      }),
    );
    expect(result.chatModel).toEqual(
      expect.objectContaining({
        provider: 'gemini',
        modelId: 'gemini-2.5-flash',
        apiKeySecretId: '9b4ce843-4c0a-4d6c-9a27-123456789abc',
      }),
    );
    expect(result.chatModel.apiKey).toBeUndefined();
  });

  it('throws when secret cannot be resolved', async () => {
    const definition = componentRegistry.get<any, any>('core.gemini.chat');
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
          userPrompt: 'Explain the status.',
          model: 'gemini-2.5-flash',
          temperature: 0.7,
          maxTokens: 512,
          apiBaseUrl: '',
          apiKey: 'missing-secret',
        },
        context,
        {
          generateText: generateTextMock,
          createGoogleGenerativeAI: createGeminiMock,
        }
      ),
    ).rejects.toThrow(/secret \"missing-secret\" was not found/i);
  });
});

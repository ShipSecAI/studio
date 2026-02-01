import { beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import type { GenerateTextResult, LanguageModelUsage, Output as AIOutput, ToolSet } from 'ai';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry, runComponentWithRunner } from '@shipsec/component-sdk';
import type { AiAgentInput, AiAgentOutput } from '../ai-agent';

const stepCountIsMock = vi.fn((limit: number) => ({ type: 'step-count', limit }));
const createOpenAIMock = vi.fn(() => (modelId: string) => ({ provider: 'openai', modelId }));
const createGoogleGenerativeAIMock = vi.fn(() => (modelId: string) => ({
  provider: 'gemini',
  modelId,
}));
const createMCPClientMock = vi.fn();

let toolLoopAgentSettings: unknown;
let lastGenerateMessages: unknown;
type GenerationResult = GenerateTextResult<ToolSet, ReturnType<typeof AIOutput.text>>;

class MockToolLoopAgent {
  settings: unknown;

  constructor(settings: unknown) {
    this.settings = settings;
    toolLoopAgentSettings = settings;
  }

  async generate({ messages }: { messages: unknown }) {
    lastGenerateMessages = messages;
    return createGenerationResult();
  }
}

function createTestContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    runId: 'test-run',
    componentRef: 'core.ai.agent',
    logger: {
      debug: () => {},
      info: () => {},
      error: () => {},
      warn: () => {},
    },
    emitProgress: () => {},
    metadata: {
      runId: 'test-run',
      componentRef: 'core.ai.agent',
      aiSdkOverrides: {
        ToolLoopAgent: MockToolLoopAgent,
        stepCountIs: stepCountIsMock,
        createOpenAI: createOpenAIMock,
        createGoogleGenerativeAI: createGoogleGenerativeAIMock,
        createMCPClient: createMCPClientMock,
      },
    },
    http: {
      fetch: async (input, init) => globalThis.fetch(input as any, init),
      toCurl: () => '',
    },
    ...overrides,
  };
}

function createUsage(overrides: Partial<LanguageModelUsage> = {}): LanguageModelUsage {
  return {
    inputTokens: 1,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: 1,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
    totalTokens: 2,
    ...overrides,
  };
}

function createGenerationResult(overrides: Partial<GenerationResult> = {}): GenerationResult {
  const usage = createUsage();
  return {
    content: [],
    text: 'Agent final answer',
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
    rawFinishReason: 'stop',
    usage,
    totalUsage: usage,
    warnings: undefined,
    request: {},
    response: {
      id: 'resp-1',
      timestamp: new Date(),
      modelId: 'mock-model',
      messages: [],
    },
    providerMetadata: undefined,
    steps: [],
    experimental_output: '',
    output: '',
    ...overrides,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Expected ${label} to be an object`);
  }
  return value;
}

beforeEach(() => {
  toolLoopAgentSettings = undefined;
  lastGenerateMessages = undefined;
  stepCountIsMock.mockClear();
  createOpenAIMock.mockClear();
  createGoogleGenerativeAIMock.mockClear();
  createMCPClientMock.mockClear();
  vi.restoreAllMocks();
  process.env.INTERNAL_SERVICE_TOKEN = 'internal-token';
});

beforeAll(async () => {
  await import('../../index');
});

describe('core.ai.agent (refactor)', () => {
  test('runs without tool discovery when no connected tools', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    vi.spyOn(MockToolLoopAgent.prototype, 'generate').mockImplementation(async function (
      this: MockToolLoopAgent,
      { messages }: { messages: unknown },
    ) {
      lastGenerateMessages = messages;
      return createGenerationResult({ text: 'Hello agent' });
    });

    const result = await runComponentWithRunner(
      component!.runner,
      component!.execute,
      {
        inputs: {
          userInput: 'Hi',
          conversationState: undefined,
          chatModel: {
            provider: 'openai',
            modelId: 'gpt-4o-mini',
          },
          modelApiKey: 'sk-test',
        },
        params: {
          systemPrompt: 'Say hello',
          temperature: 0.2,
          maxTokens: 128,
          memorySize: 4,
          stepLimit: 2,
        },
      },
      createTestContext(),
    );

    expect(result.responseText).toBe('Hello agent');
    expect(createMCPClientMock).not.toHaveBeenCalled();

    const settings = expectRecord(toolLoopAgentSettings, 'agent settings');
    expect(settings.tools).toBeUndefined();
    expect(settings.temperature).toBe(0.2);
    expect(stepCountIsMock).toHaveBeenCalledWith(2);

    const messages = Array.isArray(lastGenerateMessages) ? lastGenerateMessages : [];
    expect(messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'Hi',
    });
  });

  test('discovers gateway tools and passes them to the agent', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    vi.spyOn(MockToolLoopAgent.prototype, 'generate').mockResolvedValue(
      createGenerationResult({ text: 'Agent final answer' }),
    );

    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    const fetchMock: typeof fetch = async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ token: 'gateway-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    fetchMock.preconnect = () => {};
    globalThis.fetch = fetchMock;

    const mockTools = {
      ping: {
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ type: 'json', value: { ok: true } }),
      },
    };

    createMCPClientMock.mockResolvedValue({
      tools: async () => mockTools,
      close: async () => {},
    });

    const contextWithTools: ExecutionContext = createTestContext({
      metadata: {
        ...createTestContext().metadata,
        connectedToolNodeIds: ['tool-node-1'],
      },
    });

    try {
      const result = await runComponentWithRunner(
        component!.runner,
        component!.execute,
        {
          inputs: {
            userInput: 'Use tools',
            conversationState: undefined,
            chatModel: {
              provider: 'openai',
              modelId: 'gpt-4o-mini',
            },
            modelApiKey: 'sk-test',
          },
          params: {
            systemPrompt: '',
            temperature: 0.3,
            maxTokens: 64,
            memorySize: 3,
            stepLimit: 1,
          },
        },
        contextWithTools,
      );

      expect(result.responseText).toBe('Agent final answer');
      expect(fetchCalls).toBeGreaterThan(0);
      expect(createMCPClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: {
            type: 'http',
            url: 'http://localhost:3211/api/v1/mcp/gateway',
            headers: { Authorization: 'Bearer gateway-token' },
          },
        }),
      );

      const settings = expectRecord(toolLoopAgentSettings, 'agent settings');
      const tools = expectRecord(settings.tools, 'agent tools');
      expect(Object.keys(tools)).toEqual(['ping']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('stores tool outputs in conversation state', async () => {
    const component = componentRegistry.get<AiAgentInput, AiAgentOutput>('core.ai.agent');
    expect(component).toBeDefined();

    vi.spyOn(MockToolLoopAgent.prototype, 'generate').mockResolvedValue(
      createGenerationResult({
        text: 'Tool done',
        toolResults: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'ping',
            input: { target: 'example.com' },
            output: { type: 'json', value: { ok: true } },
            dynamic: true,
          },
        ],
      }),
    );

    const result = await runComponentWithRunner(
      component!.runner,
      component!.execute,
      {
        inputs: {
          userInput: 'Run the tool',
          conversationState: undefined,
          chatModel: {
            provider: 'openai',
            modelId: 'gpt-4o-mini',
          },
          modelApiKey: 'sk-test',
        },
        params: {
          systemPrompt: '',
          temperature: 0.2,
          maxTokens: 128,
          memorySize: 5,
          stepLimit: 2,
        },
      },
      createTestContext(),
    );

    const toolMessage = result.conversationState.messages.find(
      (message: { role: string }) => message.role === 'tool',
    );
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.content).toMatchObject({
      toolCallId: 'call-1',
      toolName: 'ping',
      output: { type: 'json', value: { ok: true } },
    });
  });
});

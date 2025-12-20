import { beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import '../../index';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry, runComponentWithRunner } from '@shipsec/component-sdk';
import type { ToolLoopAgentClass, StepCountIsFn, ToolFn, CreateOpenAIFn, CreateGoogleGenerativeAIFn, GenerateObjectFn, GenerateTextFn } from '../ai-agent';

const makeAgentResult = (overrides: Record<string, any> = {}) => ({
  text: 'Agent final answer',
  steps: [
    {
      text: 'Reasoning without tools',
      finishReason: 'stop',
      toolCalls: [],
      toolResults: [],
    },
  ],
  toolResults: [],
  usage: {
    promptTokens: 12,
    completionTokens: 24,
    totalTokens: 36,
  },
  totalUsage: {
    promptTokens: 12,
    completionTokens: 24,
    totalTokens: 36,
  },
  finishReason: 'stop',
  content: [],
  reasoning: [],
  reasoningText: undefined,
  files: [],
  sources: [],
  toolCalls: [],
  staticToolCalls: [],
  dynamicToolCalls: [],
  staticToolResults: [],
  dynamicToolResults: [],
  warnings: undefined,
  request: {},
  response: { messages: [] },
  providerMetadata: undefined,
  ...overrides,
});

const OPENAI_SECRET_ID = 'secret-openai';
const GEMINI_SECRET_ID = 'secret-gemini';

const workflowContext: ExecutionContext = {
  runId: 'test-run',
  componentRef: 'core.ai.agent',
  logger: {
    debug: () => {},
    info: () => {},
    error: () => {},
    warn: () => {},
  },
  emitProgress: () => {},
  agentTracePublisher: {
    publish: () => {},
  },
  metadata: {
    runId: 'test-run',
    componentRef: 'core.ai.agent',
  },
  secrets: {
    async get(id) {
      if (id === OPENAI_SECRET_ID) {
        return { value: 'sk-openai-from-secret', version: 1 };
      }
      if (id === GEMINI_SECRET_ID) {
        return { value: 'gm-gemini-from-secret', version: 1 };
      }
      return null;
    },
    async list() {
      return [OPENAI_SECRET_ID, GEMINI_SECRET_ID];
    },
  },
};

// Create mocks for the AI dependencies
const createdTools: Array<Record<string, unknown>> = [];
const stepCountIsMock = vi.fn((limit: number) => ({ type: 'step-count', limit }));
type AgentGenerateArgs = { messages: Array<{ role: string; content: string }> };
let agentGenerateMock = vi.fn((args: AgentGenerateArgs) => {});
const toolLoopAgentConstructorMock = vi.fn((settings: any) => settings);
let nextAgentResult = makeAgentResult();
let toolLoopAgentGenerateImpl: ((instance: any, args: any) => Promise<any>) | null = null;

// Mock ToolLoopAgent class
class MockToolLoopAgent {
  settings: any;
  tools: Record<string, any>;
  id: string | undefined;
  version = 'agent-v1';

  constructor(settings: any) {
    this.settings = settings;
    this.tools = settings?.tools ?? {};
    this.id = settings?.id;
    toolLoopAgentConstructorMock(settings);
  }

  async generate(args: any) {
    agentGenerateMock(args);
    if (toolLoopAgentGenerateImpl) {
      return await toolLoopAgentGenerateImpl(this, args);
    }
    return nextAgentResult;
  }

  async stream() {
    throw new Error('stream not implemented in test mock');
  }
}

const openAiFactoryMock = vi.fn((options: { apiKey: string; baseURL?: string }) => (model: string) => ({
  provider: 'openai',
  modelId: model,
  options,
}));

const googleFactoryMock = vi.fn((options: { apiKey?: string; baseURL?: string }) => (model: string) => ({
  provider: 'gemini',
  modelId: model,
  options,
}));

beforeAll(async () => {
  await import('../../index');
});

beforeEach(() => {
  createdTools.length = 0;
  agentGenerateMock = vi.fn((args: AgentGenerateArgs) => {});
  toolLoopAgentConstructorMock.mockReset();
  stepCountIsMock.mockReset();
  nextAgentResult = makeAgentResult();
  toolLoopAgentGenerateImpl = null;
});

describe('core.ai.agent component', () => {
  test('runs with OpenAI provider and updates conversation state', async () => {
    const component = componentRegistry.get('core.ai.agent');
    expect(component).toBeDefined();

    nextAgentResult = makeAgentResult();

    const params = {
      userInput: 'Summarise the status update.',
      conversationState: {
        sessionId: 'session-1',
        messages: [],
        toolInvocations: [],
      },
      chatModel: {
        provider: 'openai',
        modelId: 'gpt-4o-mini',
      },
      modelApiKey: 'sk-openai-from-secret',
      systemPrompt: 'You are a concise assistant.',
      temperature: 0.2,
      maxTokens: 256,
      memorySize: 8,
      stepLimit: 2,
    };

    const result = (await runComponentWithRunner(
      component!.runner,
      (params: any, context: any) => 
        (component!.execute as any)(params, context, {
          ToolLoopAgent: MockToolLoopAgent as unknown as ToolLoopAgentClass,
          stepCountIs: stepCountIsMock as unknown as StepCountIsFn,
          tool: ((definition: any) => {
            createdTools.push(definition);
            return definition;
          }) as unknown as ToolFn,
          createOpenAI: openAiFactoryMock as unknown as CreateOpenAIFn,
          createGoogleGenerativeAI: googleFactoryMock as unknown as CreateGoogleGenerativeAIFn,
        }),
      params,
      workflowContext,
    )) as any;

    expect(toolLoopAgentConstructorMock).toHaveBeenCalledTimes(1);
    const agentSettings = toolLoopAgentConstructorMock.mock.calls[0][0];
    expect(agentSettings).toMatchObject({
      instructions: 'You are a concise assistant.',
      temperature: 0.2,
      maxOutputTokens: 256,
    });
    expect(agentSettings.model).toMatchObject({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      options: expect.objectContaining({ apiKey: 'sk-openai-from-secret' }),
    });

    expect(agentGenerateMock).toHaveBeenCalledTimes(1);
    const callArgs = agentGenerateMock.mock.calls[0][0];
    expect(callArgs.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Summarise the status update.',
    });

    expect(result.responseText).toBe('Agent final answer');
    expect(result.conversationState.sessionId).toBe('session-1');
    const assistantMessage = result.conversationState.messages.at(-1);
    expect(assistantMessage).toEqual({
      role: 'assistant',
      content: 'Agent final answer',
    });
    expect(result.toolInvocations).toHaveLength(0);
    expect(result.reasoningTrace).toHaveLength(1);
    expect(typeof result.agentRunId).toBe('string');
    expect(result.agentRunId.length).toBeGreaterThan(0);
  });


  test('wires MCP tool output into reasoning trace for Gemini provider', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ answer: 'Evidence' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      toolLoopAgentGenerateImpl = async (instance) => {
        const toolResult = await instance.settings.tools.call_mcp_tool.execute({
          toolName: 'lookup',
          arguments: { question: 'Lookup reference' },
        });

        return makeAgentResult({
          text: 'Final resolved answer',
          usage: {
            promptTokens: 20,
            completionTokens: 30,
            totalTokens: 50,
          },
          totalUsage: {
            promptTokens: 20,
            completionTokens: 30,
            totalTokens: 50,
          },
          toolResults: [
            {
              toolCallId: 'call-1',
              toolName: 'call_mcp_tool',
              args: { question: 'Lookup reference' },
              result: toolResult,
            },
          ],
          steps: [
            {
              text: 'Consulting MCP',
              finishReason: 'tool',
              toolCalls: [
                {
                  toolCallId: 'call-1',
                  toolName: 'call_mcp_tool',
                  args: { question: 'Lookup reference' },
                },
              ],
              toolResults: [
                {
                  toolCallId: 'call-1',
                  toolName: 'call_mcp_tool',
                  args: { question: 'Lookup reference' },
                  result: toolResult,
                },
              ],
            },
          ],
        });
      };

      const component = componentRegistry.get('core.ai.agent');
      expect(component).toBeDefined();

      const params = {
        userInput: 'What does the MCP tool return?',
        conversationState: undefined,
        chatModel: {
          provider: 'gemini',
          modelId: 'gemini-2.5-flash',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        },
        modelApiKey: 'gm-gemini-from-secret',
        mcpTools: [
          {
            id: 'call-mcp',
            title: 'Lookup',
            endpoint: 'https://mcp.test/api',
            metadata: {
              toolName: 'call_mcp_tool',
            },
          },
        ],
        systemPrompt: '',
        temperature: 0.6,
        maxTokens: 512,
        memorySize: 6,
        stepLimit: 3,
      };

      const result = (await runComponentWithRunner(
        component!.runner,
        (params: any, context: any) => 
          (component!.execute as any)(params, context, {
            ToolLoopAgent: MockToolLoopAgent as unknown as ToolLoopAgentClass,
            stepCountIs: stepCountIsMock as unknown as StepCountIsFn,
            tool: ((definition: any) => {
              createdTools.push(definition);
              return definition;
            }) as unknown as ToolFn,
            createOpenAI: openAiFactoryMock as unknown as CreateOpenAIFn,
            createGoogleGenerativeAI: googleFactoryMock as unknown as CreateGoogleGenerativeAIFn,
          }),
        params,
        workflowContext,
      )) as any;

      expect(createdTools).toHaveLength(1);
      expect(stepCountIsMock).toHaveBeenCalledWith(3);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.toolInvocations).toHaveLength(1);
      expect(result.toolInvocations[0]).toMatchObject({
        toolName: 'call_mcp_tool',
        result: { answer: 'Evidence' },
      });
      expect(result.reasoningTrace[0]).toMatchObject({
        thought: 'Consulting MCP',
      });
      const toolMessage = result.conversationState.messages.find((msg: any) => msg.role === 'tool');
      expect(toolMessage?.content).toMatchObject({
        toolName: 'call_mcp_tool',
        result: { answer: 'Evidence' },
      });
      const agentSettings = toolLoopAgentConstructorMock.mock.calls[0][0];
      expect(agentSettings.model).toMatchObject({
        provider: 'gemini',
        modelId: 'gemini-2.5-flash',
      });
      expect(result.responseText).toBe('Final resolved answer');
      expect(result.agentRunId).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('emits agent trace events via publisher and fallback progress stream', async () => {
    const component = componentRegistry.get('core.ai.agent');
    expect(component).toBeDefined();

    nextAgentResult = makeAgentResult({
      text: 'Tool enriched answer',
      steps: [
        {
          text: 'Consider calling lookup_fact',
          finishReason: 'tool-calls',
          toolCalls: [
            {
              toolCallId: 'call-1',
              toolName: 'lookup_fact',
              args: { topic: 'zebra stripes' },
            },
          ],
          toolResults: [
            {
              toolCallId: 'call-1',
              toolName: 'lookup_fact',
              result: { fact: 'Zebra stripes help confuse predators.' },
            },
          ],
        },
      ],
    });

    const params = {
      userInput: 'Explain zebra stripes',
      conversationState: undefined,
      chatModel: {
        provider: 'openai',
        modelId: 'gpt-4o-mini',
      },
      modelApiKey: 'sk-openai-from-secret',
      systemPrompt: 'You are a biologist.',
      temperature: 0.2,
      maxTokens: 256,
      memorySize: 5,
      stepLimit: 3,
    };

    const publishMock = vi.fn().mockResolvedValue(undefined);
    const emitProgressMock = vi.fn();
    const contextWithPublisher: ExecutionContext = {
      ...workflowContext,
      agentTracePublisher: { publish: publishMock },
      emitProgress: emitProgressMock,
    };

    await runComponentWithRunner(
      component!.runner,
      (componentParams: any, ctx: any) =>
        (component!.execute as any)(componentParams, ctx, {
          ToolLoopAgent: MockToolLoopAgent as unknown as ToolLoopAgentClass,
          stepCountIs: stepCountIsMock as unknown as StepCountIsFn,
          tool: ((definition: any) => definition) as unknown as ToolFn,
          createOpenAI: openAiFactoryMock as unknown as CreateOpenAIFn,
          createGoogleGenerativeAI: googleFactoryMock as unknown as CreateGoogleGenerativeAIFn,
        }),
      params,
      contextWithPublisher,
    );

    expect(publishMock).toHaveBeenCalled();
    const publishedEnvelope = publishMock.mock.calls[0][0];
    expect(publishedEnvelope).toMatchObject({
      workflowRunId: 'test-run',
      nodeRef: 'core.ai.agent',
      agentRunId: expect.any(String),
    });
    const fallbackDuringPublisher = emitProgressMock.mock.calls.some(([payload]) =>
      payload?.message?.includes('[AgentTraceFallback]'),
    );
    expect(fallbackDuringPublisher).toBe(false);

    publishMock.mockReset();
    emitProgressMock.mockReset();

    const contextWithoutPublisher: ExecutionContext = {
      ...workflowContext,
      agentTracePublisher: undefined,
      emitProgress: emitProgressMock,
    };

    await runComponentWithRunner(
      component!.runner,
      (componentParams: any, ctx: any) =>
        (component!.execute as any)(componentParams, ctx, {
          ToolLoopAgent: MockToolLoopAgent as unknown as ToolLoopAgentClass,
          stepCountIs: stepCountIsMock as unknown as StepCountIsFn,
          tool: ((definition: any) => definition) as unknown as ToolFn,
          createOpenAI: openAiFactoryMock as unknown as CreateOpenAIFn,
          createGoogleGenerativeAI: googleFactoryMock as unknown as CreateGoogleGenerativeAIFn,
        }),
      params,
      contextWithoutPublisher,
    );

    expect(publishMock).not.toHaveBeenCalled();
    const fallbackCall = emitProgressMock.mock.calls.find(
      ([payload]) => payload?.message?.includes('[AgentTraceFallback]'),
    );
    expect(fallbackCall).toBeTruthy();
    expect(fallbackCall?.[0]?.data).toMatchObject({
      workflowRunId: 'test-run',
      nodeRef: 'core.ai.agent',
      agentRunId: expect.any(String),
    });
  });

  describe('Structured Output', () => {
    const generateObjectMock = vi.fn();
    const generateTextMock = vi.fn();

    beforeEach(() => {
      generateObjectMock.mockReset();
      generateTextMock.mockReset();
    });

    test('generates structured output from JSON example', async () => {
      const component = componentRegistry.get('core.ai.agent');
      expect(component).toBeDefined();

      generateObjectMock.mockResolvedValue({
        object: { name: 'Test User', age: 30 },
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      });

      const params = {
        userInput: 'Generate user data',
        conversationState: undefined,
        chatModel: {
          provider: 'openai',
          modelId: 'gpt-4o-mini',
        },
        modelApiKey: 'sk-openai-from-secret',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 256,
        memorySize: 8,
        stepLimit: 4,
        structuredOutputEnabled: true,
        schemaType: 'json-example',
        jsonExample: '{"name": "example", "age": 0}',
        autoFixFormat: false,
      };

      const result = (await runComponentWithRunner(
        component!.runner,
        (p: any, ctx: any) =>
          (component!.execute as any)(p, ctx, {
            ToolLoopAgent: MockToolLoopAgent as unknown as ToolLoopAgentClass,
            stepCountIs: stepCountIsMock as unknown as StepCountIsFn,
            tool: ((definition: any) => definition) as unknown as ToolFn,
            createOpenAI: openAiFactoryMock as unknown as CreateOpenAIFn,
            createGoogleGenerativeAI: googleFactoryMock as unknown as CreateGoogleGenerativeAIFn,
            generateObject: generateObjectMock as unknown as GenerateObjectFn,
            generateText: generateTextMock as unknown as GenerateTextFn,
          }),
        params,
        workflowContext,
      )) as any;

      expect(generateObjectMock).toHaveBeenCalledTimes(1);
      expect(result.structuredOutput).toEqual({ name: 'Test User', age: 30 });
      expect(result.responseText).toBe(JSON.stringify({ name: 'Test User', age: 30 }, null, 2));
      // ToolLoopAgent should NOT be called when structured output is enabled
      expect(toolLoopAgentConstructorMock).not.toHaveBeenCalled();
    });

    test('generates structured output from JSON Schema', async () => {
      const component = componentRegistry.get('core.ai.agent');
      expect(component).toBeDefined();

      generateObjectMock.mockResolvedValue({
        object: { title: 'Hello World', count: 42 },
        usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
      });

      const params = {
        userInput: 'Generate article data',
        conversationState: undefined,
        chatModel: {
          provider: 'gemini',
          modelId: 'gemini-2.5-flash',
        },
        modelApiKey: 'gm-gemini-from-secret',
        systemPrompt: '',
        temperature: 0.5,
        maxTokens: 512,
        memorySize: 8,
        stepLimit: 4,
        structuredOutputEnabled: true,
        schemaType: 'json-schema',
        jsonSchema: JSON.stringify({
          type: 'object',
          properties: {
            title: { type: 'string' },
            count: { type: 'integer' },
          },
          required: ['title', 'count'],
        }),
        autoFixFormat: false,
      };

      const result = (await runComponentWithRunner(
        component!.runner,
        (p: any, ctx: any) =>
          (component!.execute as any)(p, ctx, {
            ToolLoopAgent: MockToolLoopAgent as unknown as ToolLoopAgentClass,
            stepCountIs: stepCountIsMock as unknown as StepCountIsFn,
            tool: ((definition: any) => definition) as unknown as ToolFn,
            createOpenAI: openAiFactoryMock as unknown as CreateOpenAIFn,
            createGoogleGenerativeAI: googleFactoryMock as unknown as CreateGoogleGenerativeAIFn,
            generateObject: generateObjectMock as unknown as GenerateObjectFn,
            generateText: generateTextMock as unknown as GenerateTextFn,
          }),
        params,
        workflowContext,
      )) as any;

      expect(generateObjectMock).toHaveBeenCalledTimes(1);
      expect(result.structuredOutput).toEqual({ title: 'Hello World', count: 42 });
    });

    test('uses auto-fix when generateObject fails', async () => {
      const component = componentRegistry.get('core.ai.agent');
      expect(component).toBeDefined();

      generateObjectMock.mockRejectedValue(new Error('Schema validation failed'));
      generateTextMock.mockResolvedValue({
        text: '```json\n{"name": "Fixed User", "age": 25}\n```',
        usage: { promptTokens: 20, completionTokens: 30, totalTokens: 50 },
      });

      const params = {
        userInput: 'Generate user data',
        conversationState: undefined,
        chatModel: {
          provider: 'openai',
          modelId: 'gpt-4o-mini',
        },
        modelApiKey: 'sk-openai-from-secret',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 256,
        memorySize: 8,
        stepLimit: 4,
        structuredOutputEnabled: true,
        schemaType: 'json-example',
        jsonExample: '{"name": "example", "age": 0}',
        autoFixFormat: true,
      };

      const result = (await runComponentWithRunner(
        component!.runner,
        (p: any, ctx: any) =>
          (component!.execute as any)(p, ctx, {
            ToolLoopAgent: MockToolLoopAgent as unknown as ToolLoopAgentClass,
            stepCountIs: stepCountIsMock as unknown as StepCountIsFn,
            tool: ((definition: any) => definition) as unknown as ToolFn,
            createOpenAI: openAiFactoryMock as unknown as CreateOpenAIFn,
            createGoogleGenerativeAI: googleFactoryMock as unknown as CreateGoogleGenerativeAIFn,
            generateObject: generateObjectMock as unknown as GenerateObjectFn,
            generateText: generateTextMock as unknown as GenerateTextFn,
          }),
        params,
        workflowContext,
      )) as any;

      expect(generateObjectMock).toHaveBeenCalledTimes(1);
      expect(generateTextMock).toHaveBeenCalledTimes(1);
      expect(result.structuredOutput).toEqual({ name: 'Fixed User', age: 25 });
    });

    test('returns null structuredOutput when not enabled', async () => {
      const component = componentRegistry.get('core.ai.agent');
      expect(component).toBeDefined();

      nextAgentResult = makeAgentResult();

      const params = {
        userInput: 'Regular text query',
        conversationState: undefined,
        chatModel: {
          provider: 'openai',
          modelId: 'gpt-4o-mini',
        },
        modelApiKey: 'sk-openai-from-secret',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 256,
        memorySize: 8,
        stepLimit: 4,
        structuredOutputEnabled: false,
      };

      const result = (await runComponentWithRunner(
        component!.runner,
        (p: any, ctx: any) =>
          (component!.execute as any)(p, ctx, {
            ToolLoopAgent: MockToolLoopAgent as unknown as ToolLoopAgentClass,
            stepCountIs: stepCountIsMock as unknown as StepCountIsFn,
            tool: ((definition: any) => definition) as unknown as ToolFn,
            createOpenAI: openAiFactoryMock as unknown as CreateOpenAIFn,
            createGoogleGenerativeAI: googleFactoryMock as unknown as CreateGoogleGenerativeAIFn,
            generateObject: generateObjectMock as unknown as GenerateObjectFn,
            generateText: generateTextMock as unknown as GenerateTextFn,
          }),
        params,
        workflowContext,
      )) as any;

      expect(generateObjectMock).not.toHaveBeenCalled();
      expect(toolLoopAgentConstructorMock).toHaveBeenCalled();
      expect(result.structuredOutput).toBeNull();
      expect(result.responseText).toBe('Agent final answer');
    });

    test('throws error when auto-fix fails to parse', async () => {
      const component = componentRegistry.get('core.ai.agent');
      expect(component).toBeDefined();

      generateObjectMock.mockRejectedValue(new Error('Schema validation failed'));
      generateTextMock.mockResolvedValue({
        text: 'This is not valid JSON at all',
        usage: { promptTokens: 20, completionTokens: 30, totalTokens: 50 },
      });

      const params = {
        userInput: 'Generate user data',
        conversationState: undefined,
        chatModel: {
          provider: 'openai',
          modelId: 'gpt-4o-mini',
        },
        modelApiKey: 'sk-openai-from-secret',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 256,
        memorySize: 8,
        stepLimit: 4,
        structuredOutputEnabled: true,
        schemaType: 'json-example',
        jsonExample: '{"name": "example", "age": 0}',
        autoFixFormat: true,
      };

      await expect(
        runComponentWithRunner(
          component!.runner,
          (p: any, ctx: any) =>
            (component!.execute as any)(p, ctx, {
              ToolLoopAgent: MockToolLoopAgent as unknown as ToolLoopAgentClass,
              stepCountIs: stepCountIsMock as unknown as StepCountIsFn,
              tool: ((definition: any) => definition) as unknown as ToolFn,
              createOpenAI: openAiFactoryMock as unknown as CreateOpenAIFn,
              createGoogleGenerativeAI: googleFactoryMock as unknown as CreateGoogleGenerativeAIFn,
              generateObject: generateObjectMock as unknown as GenerateObjectFn,
              generateText: generateTextMock as unknown as GenerateTextFn,
            }),
          params,
          workflowContext,
        ),
      ).rejects.toThrow('auto-fix could not parse');
    });
  });
});

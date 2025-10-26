import { beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import '../../index';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry, runComponentWithRunner } from '@shipsec/component-sdk';
import type { ToolLoopAgentClass, StepCountIsFn, ToolFn, CreateOpenAIFn, CreateGoogleGenerativeAIFn } from '../ai-agent';

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
    info: () => {},
    error: () => {},
  },
  emitProgress: () => {},
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
        apiKeySecretId: OPENAI_SECRET_ID,
      },
      mcp: {
        endpoint: '',
      },
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
          apiKeySecretId: GEMINI_SECRET_ID,
        },
        mcp: {
          endpoint: 'https://mcp.test/api',
        },
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
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

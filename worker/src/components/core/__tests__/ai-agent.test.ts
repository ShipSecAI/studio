import { beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import type { ExecutionContext } from '@shipsec/component-sdk';
import { componentRegistry, runComponentWithRunner } from '@shipsec/component-sdk';

const defaultGenerationResult = {
  text: 'Agent final answer',
  finishReason: 'stop',
  usage: {
    promptTokens: 12,
    completionTokens: 24,
    totalTokens: 36,
  },
  response: { messages: [] },
  toolCalls: [],
  toolResults: [],
  steps: [
    {
      text: 'Reasoning without tools',
      finishReason: 'stop',
      toolCalls: [],
      toolResults: [],
    },
  ],
};

const workflowContext: ExecutionContext = {
  runId: 'test-run',
  componentRef: 'core.ai.agent',
  logger: {
    info: () => {},
    error: () => {},
  },
  emitProgress: () => {},
};

const generateTextMock = vi.fn(async () => defaultGenerationResult);
const createdTools: Array<Record<string, unknown>> = [];

beforeAll(async () => {
  vi.mock('ai', () => ({
    CoreMessage: {} as any,
    generateText: generateTextMock,
    tool: (definition: any) => {
      createdTools.push(definition);
      return definition;
    },
  }));

  vi.mock('@ai-sdk/openai', () => ({
    createOpenAI: (options: { apiKey: string; baseURL?: string }) => (model: string) => ({
      provider: 'openai',
      model,
      options,
    }),
  }));

  vi.mock('@ai-sdk/google', () => ({
    createGoogleGenerativeAI: (options: { apiKey?: string; baseURL?: string }) => (model: string) => ({
      provider: 'gemini',
      model,
      options,
    }),
  }));

  process.env.OPENAI_API_KEY = 'sk-test-openai';
  process.env.GEMINI_API_KEY = 'gm-test-gemini';

  await import('../../index');
});

beforeEach(() => {
  createdTools.length = 0;
  generateTextMock.mockReset();
  generateTextMock.mockImplementation(async () => defaultGenerationResult);
});

describe('core.ai.agent component', () => {
  test('runs with OpenAI provider and updates conversation state', async () => {
    const component = componentRegistry.get('core.ai.agent');
    expect(component).toBeDefined();

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
      component!.execute as any,
      params,
      workflowContext,
    )) as any;

    expect(generateTextMock.mock.calls.length).toBe(1);
    const call = generateTextMock.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      temperature: 0.2,
      maxTokens: 256,
      maxSteps: 2,
    });
    expect(call?.model).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    expect(call?.messages?.[call.messages.length - 1]).toEqual({
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
    generateTextMock.mockImplementationOnce(async () => ({
      text: 'Final resolved answer',
      finishReason: 'stop',
      usage: {
        promptTokens: 20,
        completionTokens: 30,
        totalTokens: 50,
      },
      response: { messages: [] },
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
          result: { answer: 'Evidence' },
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
              result: { answer: 'Evidence' },
            },
          ],
        },
      ],
    }));

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
      component!.execute as any,
      params,
      workflowContext,
    )) as any;

    expect(createdTools).toHaveLength(1);
    expect(generateTextMock.mock.calls[0]?.[0]?.tools).toHaveProperty('call_mcp_tool');
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
    expect(result.responseText).toBe('Final resolved answer');
  });
});

import { describe, it, expect, beforeAll, afterEach, mock } from 'bun:test';
import { createExecutionContext } from '@shipsec/component-sdk';
import { createOpenAI as createOpenAIImpl } from '@ai-sdk/openai';
import { createGoogleGenerativeAI as createGoogleGenerativeAIImpl } from '@ai-sdk/google';
import { stepCountIs as stepCountIsImpl, type ToolSet, type GenerateTextResult, type StepResult } from 'ai';
import type {
  ToolLoopAgentClass,
  StepCountIsFn,
  CreateOpenAIFn,
  CreateGoogleGenerativeAIFn,
} from '../ai-agent';

type AgentSettings = ConstructorParameters<ToolLoopAgentClass>[0];
let lastStepLimit: number | undefined;
const stepCountIsMock = mock<StepCountIsFn>((limit) => {
  lastStepLimit = limit;
  return stepCountIsImpl(limit);
});

type GenerateCallArgs = {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

const agentGenerateMock = mock<(args: GenerateCallArgs) => void>(() => {});
const toolLoopAgentConstructorMock = mock<(settings: AgentSettings) => void>(() => {});
let toolLoopAgentGenerateImpl:
  | ((instance: MockToolLoopAgent, args: GenerateCallArgs) => Promise<GenerateTextResult<ToolSet, never>>)
  | null = null;

class MockToolLoopAgent {
  settings: AgentSettings;
  tools: Record<string, unknown>;
  id: string | undefined;
  readonly version = 'agent-v1';

  constructor(settings: AgentSettings) {
    this.settings = settings;
    this.tools = (settings as { tools?: Record<string, unknown> })?.tools ?? {};
    this.id = (settings as { id?: string })?.id;
    toolLoopAgentConstructorMock(settings);
  }

  async generate(args: GenerateCallArgs): Promise<GenerateTextResult<ToolSet, never>> {
    agentGenerateMock(args);
    if (toolLoopAgentGenerateImpl) {
      return await toolLoopAgentGenerateImpl(this, args);
    }
    const result = nextAgentResult;
    nextAgentResult = makeAgentResult();
    return result;
  }

  async stream(): Promise<never> {
    throw new Error('stream not implemented in test mock');
  }
}

const openAiFactoryMock = mock<CreateOpenAIFn>((options) => createOpenAIImpl(options));
const googleFactoryMock = mock<CreateGoogleGenerativeAIFn>((options) =>
  createGoogleGenerativeAIImpl(options),
);

const OPENAI_SECRET_ID = 'secret-openai';
const GEMINI_SECRET_ID = 'secret-gemini';

const secretsService = {
  get: mock(async (id: string) => {
    if (id === OPENAI_SECRET_ID) {
      return { value: 'sk-openai-from-secret', version: 1 };
    }
    if (id === GEMINI_SECRET_ID) {
      return { value: 'gm-gemini-from-secret', version: 1 };
    }
    return null;
  }),
  list: mock(async () => [OPENAI_SECRET_ID, GEMINI_SECRET_ID]),
};

const makeStepResult = (
  overrides: Partial<StepResult<ToolSet>> = {},
): StepResult<ToolSet> => ({
  content: overrides.content ?? [],
  text: overrides.text ?? 'Evaluating previous context.',
  reasoning: overrides.reasoning ?? [],
  reasoningText: overrides.reasoningText,
  files: overrides.files ?? [],
  sources: overrides.sources ?? [],
  toolCalls: overrides.toolCalls ?? [],
  staticToolCalls: overrides.staticToolCalls ?? [],
  dynamicToolCalls: overrides.dynamicToolCalls ?? [],
  toolResults: overrides.toolResults ?? [],
  staticToolResults: overrides.staticToolResults ?? [],
  dynamicToolResults: overrides.dynamicToolResults ?? [],
  finishReason: overrides.finishReason ?? 'stop',
  usage:
    overrides.usage ??
    {
      inputTokens: 64,
      outputTokens: 32,
      totalTokens: 96,
    },
  warnings: overrides.warnings,
  request: overrides.request ?? {},
  response:
    overrides.response ??
    {
      id: 'step-response-1',
      timestamp: new Date('2024-01-01T00:00:00Z'),
      modelId: 'gpt-4o-mini',
      messages: [],
    },
  providerMetadata: overrides.providerMetadata,
});

const makeAgentResult = (
  overrides: Partial<GenerateTextResult<ToolSet, never>> = {},
): GenerateTextResult<ToolSet, never> =>
  ({
    content: overrides.content ?? [],
    text: overrides.text ?? 'Here is a brief summary.',
    reasoning: overrides.reasoning ?? [],
    reasoningText: overrides.reasoningText,
    files: overrides.files ?? [],
    sources: overrides.sources ?? [],
    toolCalls: overrides.toolCalls ?? [],
    staticToolCalls: overrides.staticToolCalls ?? [],
    dynamicToolCalls: overrides.dynamicToolCalls ?? [],
    toolResults: overrides.toolResults ?? [],
    staticToolResults: overrides.staticToolResults ?? [],
    dynamicToolResults: overrides.dynamicToolResults ?? [],
    finishReason: overrides.finishReason ?? 'stop',
    usage:
      overrides.usage ??
      {
        inputTokens: 64,
        outputTokens: 32,
        totalTokens: 96,
      },
    totalUsage:
      overrides.totalUsage ??
      {
        inputTokens: 64,
        outputTokens: 32,
        totalTokens: 96,
      },
    warnings: overrides.warnings,
    request: overrides.request ?? {},
    response:
      overrides.response ??
      {
        id: 'response-1',
        timestamp: new Date('2024-01-01T00:00:00Z'),
        modelId: 'gpt-4o-mini',
        messages: [],
      },
    providerMetadata: overrides.providerMetadata,
    steps: overrides.steps ?? [makeStepResult()],
    experimental_output: overrides.experimental_output ?? (undefined as never),
  }) as GenerateTextResult<ToolSet, never>;

let nextAgentResult: GenerateTextResult<ToolSet, never> = makeAgentResult();

let componentRegistry: { get: (id: string) => any };
let aiAgent: any;

beforeAll(async () => {
  ({ componentRegistry } = await import('../../index'));
  aiAgent = componentRegistry.get('core.ai.agent');

  if (!aiAgent) {
    throw new Error('AI agent component failed to register');
  }
});

afterEach(() => {
  agentGenerateMock.mockClear();
  stepCountIsMock.mockClear();
  toolLoopAgentConstructorMock.mockClear();
  openAiFactoryMock.mockClear();
  googleFactoryMock.mockClear();
  secretsService.get.mockClear();
  secretsService.list.mockClear();
  toolLoopAgentGenerateImpl = null;
  nextAgentResult = makeAgentResult();
  lastStepLimit = undefined;
});

describe('core.ai.agent component', () => {
  it('is registered with expected metadata', () => {
    expect(aiAgent.id).toBe('core.ai.agent');
    expect(aiAgent.label).toBe('AI SDK Agent');
    expect(aiAgent.metadata.slug).toBe('ai-agent');
    expect(typeof aiAgent.execute).toBe('function');
  });

  it('invokes the AI SDK agent and updates conversation state', async () => {
    const dynamicToolResult = {
      type: 'tool-result' as const,
      toolCallId: 'call-1',
      toolName: 'call_mcp_tool',
      input: { toolName: 'lookup', arguments: { query: 'dns' } },
      output: { payload: 'tool-output' },
      dynamic: true as const,
    };

    nextAgentResult = makeAgentResult({
      toolResults: [dynamicToolResult],
      steps: [
        makeStepResult({
          toolCalls: [
            {
              type: 'tool-call' as const,
              toolCallId: 'call-1',
              toolName: 'call_mcp_tool',
              input: { toolName: 'lookup', arguments: { query: 'dns' } },
              dynamic: true,
            },
          ],
          toolResults: [dynamicToolResult],
        }),
      ],
    });

    const runContext = createExecutionContext({
      runId: 'test-run-ai-agent',
      componentRef: 'ai-agent-component',
      secrets: secretsService,
    });

    const params = aiAgent.inputSchema.parse({
      userInput: 'Summarise the latest findings.',
      systemPrompt: 'You are a concise security analyst.',
      memorySize: 5,
      chatModel: {
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        apiKeySecretId: OPENAI_SECRET_ID,
      },
      conversationState: {
        sessionId: 'session-123',
        messages: [
          { role: 'system', content: 'You are a concise security analyst.' },
          { role: 'user', content: 'Previous question?' },
          { role: 'assistant', content: 'Previous response.' },
        ],
        toolInvocations: [],
      },
    });

    const result = await aiAgent.execute(params, runContext, {
      ToolLoopAgent: MockToolLoopAgent as unknown as ToolLoopAgentClass,
      stepCountIs: stepCountIsMock as unknown as StepCountIsFn,
      createOpenAI: openAiFactoryMock as unknown as CreateOpenAIFn,
      createGoogleGenerativeAI: googleFactoryMock as unknown as CreateGoogleGenerativeAIFn,
    });

    expect(lastStepLimit).toBe(4);
    expect(toolLoopAgentConstructorMock.mock.calls).toHaveLength(1);
    const agentSettings = toolLoopAgentConstructorMock.mock.calls[0][0] as AgentSettings & {
      stopWhen: unknown;
    };
    expect(agentSettings).toMatchObject({
      instructions: 'You are a concise security analyst.',
      temperature: 0.7,
      maxOutputTokens: 1024,
    });
    expect(typeof agentSettings.stopWhen).toBe('function');

    expect(agentGenerateMock.mock.calls).toHaveLength(1);
    const generateCall = agentGenerateMock.mock.calls[0][0];
    expect(generateCall).toEqual({
      messages: [
        { role: 'user', content: 'Previous question?' },
        { role: 'assistant', content: 'Previous response.' },
        { role: 'user', content: 'Summarise the latest findings.' },
      ],
    });

    expect(result.responseText).toBe('Here is a brief summary.');
    expect(result.conversationState.sessionId).toBe('session-123');
    expect(result.conversationState.messages.at(-1)).toEqual({
      role: 'assistant',
      content: 'Here is a brief summary.',
    });
    expect(result.toolInvocations).toHaveLength(1);
    expect(result.toolInvocations[0]).toMatchObject({
      toolName: 'call_mcp_tool',
      args: dynamicToolResult.input,
      result: dynamicToolResult.output,
    });
    expect(result.reasoningTrace[0].thought).toContain('Evaluating previous context.');
    expect(result.usage).toEqual({
      inputTokens: 64,
      outputTokens: 32,
      totalTokens: 96,
    });
    expect(openAiFactoryMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ apiKey: 'sk-openai-from-secret' }),
    );
  });

  it('wires the MCP tool endpoint when provided', async () => {
    const fetchCalls: Array<Parameters<typeof fetch>> = [];
    const fetchMock: typeof fetch = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        fetchCalls.push(args);
        return new Response(JSON.stringify({ payload: 'mcp-result' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
      {
        preconnect: async () => {},
      },
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      toolLoopAgentGenerateImpl = async (instance) => {
        const callMcpTool = instance.settings.tools?.call_mcp_tool;
        if (!callMcpTool || typeof callMcpTool.execute !== 'function') {
          throw new Error('call_mcp_tool tool not registered');
        }
        const toolResult = await callMcpTool.execute(
          {
            toolName: 'dns_lookup',
            arguments: { hostname: 'example.com' },
          },
          {
            toolCallId: 'call-2',
            messages: [],
          },
        );

        const dynamicResult = {
          type: 'tool-result' as const,
          toolCallId: 'call-2',
          toolName: 'call_mcp_tool',
          input: { toolName: 'dns_lookup', arguments: { hostname: 'example.com' } },
          output: toolResult,
          dynamic: true as const,
        };

        return makeAgentResult({
          text: 'Tool invocation complete.',
          toolResults: [dynamicResult],
          steps: [
            makeStepResult({
              finishReason: 'tool-calls',
              toolCalls: [
                {
                  type: 'tool-call' as const,
                  toolCallId: 'call-2',
                  toolName: 'call_mcp_tool',
                  input: { toolName: 'dns_lookup', arguments: { hostname: 'example.com' } },
                  dynamic: true,
                },
              ],
              toolResults: [dynamicResult],
            }),
          ],
        });
      };

      const runContext = createExecutionContext({
        runId: 'test-run-mcp',
        componentRef: 'ai-agent-component',
        secrets: secretsService,
      });

      const params = aiAgent.inputSchema.parse({
        userInput: 'Check DNS for example.com',
        mcp: { endpoint: 'https://mcp.local/session' },
        chatModel: {
          provider: 'openai',
          modelId: 'gpt-4o-mini',
          apiKeySecretId: OPENAI_SECRET_ID,
        },
      });

      const result = await aiAgent.execute(params, runContext, {
        ToolLoopAgent: MockToolLoopAgent as unknown as ToolLoopAgentClass,
        stepCountIs: stepCountIsMock as unknown as StepCountIsFn,
        createOpenAI: openAiFactoryMock as unknown as CreateOpenAIFn,
        createGoogleGenerativeAI: googleFactoryMock as unknown as CreateGoogleGenerativeAIFn,
      });

      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0]?.[0]).toBe('https://mcp.local/session');
      expect(fetchCalls[0]?.[1]).toEqual(
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );

      expect(openAiFactoryMock.mock.calls[0][0]).toEqual(
        expect.objectContaining({ apiKey: 'sk-openai-from-secret' }),
      );

      expect(result.toolInvocations).toHaveLength(1);
      expect(result.toolInvocations[0]).toMatchObject({
        toolName: 'call_mcp_tool',
        result: { payload: 'mcp-result' },
      });
      expect(result.reasoningTrace[0].actions[0]).toMatchObject({
        toolName: 'call_mcp_tool',
      });
      expect(result.responseText).toBe('Tool invocation complete.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

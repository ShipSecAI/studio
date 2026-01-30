import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  ToolLoopAgent,
  stepCountIs,
  type GenerateTextResult,
  type JSONValue,
  type ModelMessage,
  type StepResult,
  type ToolLoopAgentSettings,
  type ToolResultPart,
  type ToolSet,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMCPClient } from '@ai-sdk/mcp';
import {
  componentRegistry,
  ComponentRetryPolicy,
  ConfigurationError,
  ValidationError,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import { LLMProviderSchema, llmProviderContractName } from '@shipsec/contracts';
import { AgentStreamRecorder } from './agent-stream-recorder';

type ModelProvider = 'openai' | 'gemini' | 'openrouter' | 'zai-coding-plan';

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? '';
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL ?? '';
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_MEMORY_SIZE = 8;
const DEFAULT_STEP_LIMIT = 4;
const LOG_TRUNCATE_LIMIT = 2000;

import { DEFAULT_GATEWAY_URL, getGatewaySessionToken } from './utils';

const agentMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.unknown(),
});

type AgentMessage = z.infer<typeof agentMessageSchema>;

const conversationStateSchema = z.object({
  sessionId: z.string(),
  messages: z.array(agentMessageSchema).default([]),
});

type ConversationState = z.infer<typeof conversationStateSchema>;
type AgentTools = ToolSet;
type AgentStepResult = StepResult<AgentTools>;
type AgentGenerationResult = GenerateTextResult<AgentTools, never>;
type ToolResultOutput = ToolResultPart['output'];

const inputSchema = inputs({
  userInput: port(
    z
      .string()
      .min(1, 'Input text cannot be empty')
      .describe('Incoming user text for this agent turn.'),
    {
      label: 'User Input',
      description: 'Incoming user text for this agent turn.',
    },
  ),
  conversationState: port(
    conversationStateSchema
      .optional()
      .describe('Optional prior conversation state to maintain memory across turns.'),
    {
      label: 'Conversation State',
      description: 'Optional prior conversation state to maintain memory across turns.',
      connectionType: { kind: 'primitive', name: 'json' },
    },
  ),
  chatModel: port(
    LLMProviderSchema()
      .default({
        provider: 'openai',
        modelId: DEFAULT_OPENAI_MODEL,
      })
      .describe('Chat model configuration (provider, model ID, API key, base URL).'),
    {
      label: 'Chat Model',
      description:
        'Provider configuration. Example: {"provider":"gemini","modelId":"gemini-2.5-flash","apiKey":"gm-..."}',
      connectionType: { kind: 'contract', name: llmProviderContractName, credential: true },
    },
  ),
  modelApiKey: port(
    z.string().optional().describe('Optional API key override supplied via a Secret Loader node.'),
    {
      label: 'Model API Key',
      description: 'Optional override API key supplied via a Secret Loader output.',
      editor: 'secret',
      connectionType: { kind: 'primitive', name: 'secret' },
    },
  ),
  tools: port(
    z
      .unknown()
      .optional()
      .describe('Anchor port for tool-mode nodes; data is not consumed by the agent.'),
    {
      label: 'Connected Tools',
      description: 'Connect tool-mode nodes here to scope gateway tool discovery for this agent.',
      allowAny: true,
      reason: 'Tool-mode port acts as a graph anchor; payloads are not consumed by the agent.',
      connectionType: { kind: 'contract', name: 'mcp.tool' },
    },
  ),
});

const parameterSchema = parameters({
  systemPrompt: param(
    z
      .string()
      .default('')
      .describe('Optional system instructions that anchor the agent behaviour.'),
    {
      label: 'System Prompt',
      editor: 'textarea',
      rows: 3,
      description: 'Optional system instructions that guide the model response.',
    },
  ),
  temperature: param(
    z
      .number()
      .min(0)
      .max(2)
      .default(DEFAULT_TEMPERATURE)
      .describe('Sampling temperature. Higher values are more creative, lower values are focused.'),
    {
      label: 'Temperature',
      editor: 'number',
      min: 0,
      max: 2,
      description: 'Higher values increase creativity, lower values are focused.',
    },
  ),
  maxTokens: param(
    z
      .number()
      .int()
      .min(64)
      .max(1_000_000)
      .default(DEFAULT_MAX_TOKENS)
      .describe('Maximum number of tokens to generate on the final turn.'),
    {
      label: 'Max Tokens',
      editor: 'number',
      min: 64,
      max: 1_000_000,
      description: 'Maximum number of tokens to generate on the final turn.',
    },
  ),
  memorySize: param(
    z
      .number()
      .int()
      .min(2)
      .max(50)
      .default(DEFAULT_MEMORY_SIZE)
      .describe('How many recent messages (excluding the system prompt) to retain between turns.'),
    {
      label: 'Memory Size',
      editor: 'number',
      min: 2,
      max: 50,
      description: 'How many recent turns to keep in memory (excluding the system prompt).',
    },
  ),
  stepLimit: param(
    z
      .number()
      .int()
      .min(1)
      .max(12)
      .default(DEFAULT_STEP_LIMIT)
      .describe('Maximum sequential reasoning/tool steps before the agent stops.'),
    {
      label: 'Step Limit',
      editor: 'number',
      min: 1,
      max: 12,
      description: 'Maximum reasoning/tool steps before the agent stops automatically.',
    },
  ),
});

const outputSchema = outputs({
  responseText: port(z.string(), {
    label: 'Agent Response',
    description: 'Final assistant message produced by the agent.',
  }),
  conversationState: port(conversationStateSchema, {
    label: 'Conversation State',
    description: 'Updated conversation memory for subsequent agent turns.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  agentRunId: port(z.string(), {
    label: 'Agent Run ID',
    description: 'Unique identifier for streaming and replaying this agent session.',
  }),
});

function ensureModelName(provider: ModelProvider, modelId?: string | null): string {
  const trimmed = modelId?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }

  if (provider === 'gemini') {
    return DEFAULT_GEMINI_MODEL;
  }

  if (provider === 'openrouter') {
    return DEFAULT_OPENROUTER_MODEL;
  }

  return DEFAULT_OPENAI_MODEL;
}

function resolveApiKey(provider: ModelProvider, overrideKey?: string | null): string {
  const trimmed = overrideKey?.trim();
  if (trimmed) {
    return trimmed;
  }

  throw new ConfigurationError(
    `Model provider API key is not configured for "${provider}". Connect a Secret Loader node to the modelApiKey input or supply chatModel.apiKey.`,
    { configKey: 'apiKey', details: { provider } },
  );
}

function ensureSystemMessage(history: AgentMessage[], systemPrompt: string): AgentMessage[] {
  if (!systemPrompt.trim()) {
    return history;
  }

  const [firstMessage, ...rest] = history;
  const systemMessage: AgentMessage = { role: 'system', content: systemPrompt.trim() };

  if (!firstMessage) {
    return [systemMessage];
  }

  if (firstMessage.role !== 'system') {
    return [systemMessage, firstMessage, ...rest];
  }

  if (firstMessage.content !== systemPrompt.trim()) {
    return [{ role: 'system', content: systemPrompt.trim() }, ...rest];
  }

  return history;
}

function trimConversation(history: AgentMessage[], memorySize: number): AgentMessage[] {
  if (history.length <= memorySize) {
    return history;
  }

  const systemMessages = history.filter((message) => message.role === 'system');
  const nonSystemMessages = history.filter((message) => message.role !== 'system');

  const trimmedNonSystem = nonSystemMessages.slice(-memorySize);

  return [...systemMessages.slice(0, 1), ...trimmedNonSystem];
}

function sanitizeHeaders(
  headers?: Record<string, string | undefined> | null,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  const entries = Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    const trimmedKey = key.trim();
    const trimmedValue = typeof value === 'string' ? value.trim() : '';
    if (trimmedKey.length > 0 && trimmedValue.length > 0) {
      acc[trimmedKey] = trimmedValue;
    }
    return acc;
  }, {});

  return Object.keys(entries).length > 0 ? entries : undefined;
}

function normalizeMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return JSON.stringify(content ?? '');
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const remaining = value.length - maxLength;
  return `${value.slice(0, maxLength)}...(+${remaining} chars)`;
}

function safeStringify(value: unknown, maxLength: number): string {
  try {
    return truncateText(JSON.stringify(value), maxLength);
  } catch {
    return truncateText(String(value), maxLength);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isJsonValue(value: unknown): value is JSONValue {
  if (value === null) {
    return true;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function isToolResultOutput(value: unknown): value is ToolResultOutput {
  if (!isRecord(value)) {
    return false;
  }
  const typeValue = value.type;
  if (typeof typeValue !== 'string') {
    return false;
  }
  return ['text', 'json', 'execution-denied', 'error-text', 'error-json', 'content'].includes(
    typeValue,
  );
}

function toToolResultOutput(value: unknown): ToolResultOutput {
  if (isToolResultOutput(value)) {
    return value;
  }
  if (isJsonValue(value)) {
    return { type: 'json', value };
  }
  return { type: 'text', value: JSON.stringify(value) };
}

function toToolResultPart(content: unknown): ToolResultPart {
  const record = isRecord(content) ? content : {};
  const toolCallId =
    typeof record.toolCallId === 'string' && record.toolCallId.trim().length > 0
      ? record.toolCallId
      : 'unknown';
  const toolName =
    typeof record.toolName === 'string' && record.toolName.trim().length > 0
      ? record.toolName
      : 'tool';
  const rawOutput = record.output ?? record.result;

  return {
    type: 'tool-result',
    toolCallId,
    toolName,
    output: toToolResultOutput(rawOutput),
  };
}

function formatErrorForLog(error: unknown, maxLength: number): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncateText(error.message, maxLength),
      stack: error.stack ? truncateText(error.stack, maxLength) : undefined,
      cause:
        'cause' in error
          ? safeStringify((error as { cause?: unknown }).cause, maxLength)
          : undefined,
    };
  }

  if (isRecord(error)) {
    const message =
      typeof error.message === 'string' ? error.message : safeStringify(error, maxLength);
    return {
      name: typeof error.name === 'string' ? error.name : undefined,
      message: truncateText(message, maxLength),
      keys: Object.keys(error).slice(0, 12),
    };
  }

  return { message: truncateText(String(error), maxLength) };
}

function getToolInput(entity: { input?: unknown } | null | undefined): unknown {
  return entity?.input ?? null;
}

function getToolOutput(entity: { output?: unknown } | null | undefined): unknown {
  return entity?.output ?? null;
}

function toModelMessages(messages: AgentMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }

    if (message.role === 'tool') {
      result.push({
        role: 'tool',
        content: [toToolResultPart(message.content)],
      });
      continue;
    }

    if (message.role === 'user') {
      result.push({
        role: 'user',
        content: normalizeMessageContent(message.content),
      });
      continue;
    }

    result.push({
      role: 'assistant',
      content: normalizeMessageContent(message.content),
    });
  }

  return result;
}

interface RegisterGatewayToolsParams {
  gatewayUrl: string;
  sessionToken: string;
}

async function registerGatewayTools({
  gatewayUrl,
  sessionToken,
}: RegisterGatewayToolsParams): Promise<{
  tools: ToolSet;
  close: () => Promise<void>;
}> {
  const mcpClient = await createMCPClient({
    transport: {
      type: 'http',
      url: gatewayUrl,
      headers: { Authorization: `Bearer ${sessionToken}` },
    },
  });

  const tools = await mcpClient.tools();
  return {
    tools,
    close: async () => {
      await mcpClient.close();
    },
  };
}

const definition = defineComponent({
  id: 'core.ai.agent',
  label: 'AI SDK Agent',
  category: 'ai',
  runner: { kind: 'inline' },
  retryPolicy: {
    maxAttempts: 3,
    initialIntervalSeconds: 2,
    maximumIntervalSeconds: 30,
    backoffCoefficient: 2,
    nonRetryableErrorTypes: ['ValidationError', 'ConfigurationError', 'AuthenticationError'],
  } satisfies ComponentRetryPolicy,
  inputs: inputSchema,
  outputs: outputSchema,
  parameters: parameterSchema,
  docs: `An AI SDK-powered agent that maintains conversation memory, calls MCP tools via the gateway, and streams progress events.

How it behaves:
- Memory → The agent maintains a conversation state object you can persist between turns.
- Model → Connect a chat model configuration output into the Chat Model input or customise the defaults below.
- MCP → Connect tool-mode nodes to the tools port; the gateway resolves the tool set for this agent.

Typical workflow:
1. Entry Point (or upstream Chat Model) → wire its text output into User Input.
2. AI SDK Agent (this node) → loops with tool calling, logging tool calls as it goes.
3. Downstream node (Console Log, Storage, etc.) → consume responseText.

Loop the Conversation State output back into the next agent invocation to keep multi-turn context.`,
  ui: {
    slug: 'ai-agent',
    version: '1.1.0',
    type: 'process',
    category: 'ai',
    description: 'AI SDK agent with conversation memory and MCP tool calling via gateway.',
    icon: 'Bot',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute({ inputs, params }, context) {
    const { userInput, conversationState, chatModel, modelApiKey } = inputs;
    const { systemPrompt, temperature, maxTokens, memorySize, stepLimit } = params;

    const agentRunId = `${context.runId}:${context.componentRef}:${randomUUID()}`;

    const agentStream = new AgentStreamRecorder(context, agentRunId);
    const { connectedToolNodeIds, organizationId } = context.metadata;

    let discoveredTools: ToolSet = {};
    let closeDiscovery: (() => Promise<void>) | undefined;

    if (connectedToolNodeIds && connectedToolNodeIds.length > 0) {
      context.logger.info(
        `Discovering tools from gateway for nodes: ${connectedToolNodeIds.join(', ')}`,
      );
      try {
        const sessionToken = await getGatewaySessionToken(
          context.runId,
          organizationId ?? null,
          connectedToolNodeIds,
        );
        const discoveryResult = await registerGatewayTools({
          gatewayUrl: DEFAULT_GATEWAY_URL,
          sessionToken,
        });
        discoveredTools = discoveryResult.tools;
        closeDiscovery = discoveryResult.close;
      } catch (error) {
        context.logger.error(`Failed to discover tools from gateway: ${error}`);
      }
    }

    try {
      agentStream.emitMessageStart();
      context.emitProgress({
        level: 'info',
        message: 'AI agent session started',
        data: {
          agentRunId,
          agentStatus: 'started',
        },
      });

      const trimmedInput = userInput.trim();

      if (!trimmedInput) {
        throw new ValidationError('AI Agent requires a non-empty user input.', {
          fieldErrors: { userInput: ['Input cannot be empty'] },
        });
      }

      const effectiveProvider: ModelProvider = chatModel?.provider ?? 'openai';
      const effectiveModel = ensureModelName(effectiveProvider, chatModel?.modelId ?? null);

      let overrideApiKey = chatModel?.apiKey ?? null;
      if (modelApiKey && modelApiKey.trim().length > 0) {
        overrideApiKey = modelApiKey.trim();
      }

      const effectiveApiKey = resolveApiKey(effectiveProvider, overrideApiKey);
      const explicitBaseUrl = chatModel?.baseUrl?.trim();
      const baseUrl =
        explicitBaseUrl && explicitBaseUrl.length > 0
          ? explicitBaseUrl
          : effectiveProvider === 'gemini'
            ? GEMINI_BASE_URL
            : effectiveProvider === 'openrouter'
              ? OPENROUTER_BASE_URL
              : OPENAI_BASE_URL;

      const sanitizedHeaders =
        chatModel && (chatModel.provider === 'openai' || chatModel.provider === 'openrouter')
          ? sanitizeHeaders(chatModel.headers)
          : undefined;

      const incomingState = conversationState;

      const sessionId = incomingState?.sessionId ?? randomUUID();
      const existingMessages = Array.isArray(incomingState?.messages) ? incomingState.messages : [];

      let history: AgentMessage[] = ensureSystemMessage([...existingMessages], systemPrompt ?? '');
      history = trimConversation(history, memorySize);

      const userMessage: AgentMessage = { role: 'user', content: trimmedInput };
      const historyWithUser = trimConversation([...history, userMessage], memorySize);

      const availableToolsCount = Object.keys(discoveredTools).length;
      const toolsConfig = availableToolsCount > 0 ? discoveredTools : undefined;

      const systemMessageEntry = historyWithUser.find((message) => message.role === 'system');
      const resolvedSystemPrompt = systemPrompt?.trim()?.length
        ? systemPrompt.trim()
        : systemMessageEntry && typeof systemMessageEntry.content === 'string'
          ? systemMessageEntry.content
          : systemMessageEntry && systemMessageEntry.content !== undefined
            ? JSON.stringify(systemMessageEntry.content)
            : '';
      const messagesForModel = toModelMessages(historyWithUser);

      const openAIOptions = {
        apiKey: effectiveApiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
        ...(sanitizedHeaders && Object.keys(sanitizedHeaders).length > 0
          ? { headers: sanitizedHeaders }
          : {}),
      };
      const isOpenRouter =
        effectiveProvider === 'openrouter' ||
        (typeof baseUrl === 'string' && baseUrl.includes('openrouter.ai'));
      const openAIProvider = createOpenAI({
        ...openAIOptions,
        ...(isOpenRouter ? { name: 'openrouter' } : {}),
      });
      const model =
        effectiveProvider === 'gemini'
          ? createGoogleGenerativeAI({
              apiKey: effectiveApiKey,
              ...(baseUrl ? { baseURL: baseUrl } : {}),
            })(effectiveModel)
          : isOpenRouter
            ? openAIProvider.chat(effectiveModel)
            : openAIProvider(effectiveModel);
      const agentSettings: ToolLoopAgentSettings<never, AgentTools> = {
        id: `${sessionId}-agent`,
        model,
        instructions: resolvedSystemPrompt || undefined,
        temperature,
        maxOutputTokens: maxTokens,
        stopWhen: stepCountIs(stepLimit),
        onStepFinish: (stepResult: AgentStepResult) => {
          for (const call of stepResult.toolCalls) {
            const input = getToolInput(call);
            agentStream.emitToolInput(call.toolCallId, call.toolName, toRecord(input));
          }

          for (const result of stepResult.toolResults) {
            const output = getToolOutput(result);
            agentStream.emitToolOutput(result.toolCallId, result.toolName, output);
          }
        },
        ...(toolsConfig ? { tools: toolsConfig } : {}),
      };

      const agent = new ToolLoopAgent<never, AgentTools>(agentSettings);

      context.logger.info(
        `[AIAgent] Using ${effectiveProvider} model "${effectiveModel}" with ${availableToolsCount} connected tool(s).`,
      );
      context.emitProgress({
        level: 'info',
        message: 'AI agent reasoning in progress...',
        data: {
          agentRunId,
          agentStatus: 'running',
        },
      });

      let generationResult: AgentGenerationResult;
      try {
        generationResult = await agent.generate({
          messages: messagesForModel,
        });
      } catch (genError) {
        const errorSummary = formatErrorForLog(genError, LOG_TRUNCATE_LIMIT);
        context.logger.error(
          `[AIAgent] agent.generate() FAILED (truncated): ${safeStringify(
            errorSummary,
            LOG_TRUNCATE_LIMIT,
          )}`,
        );
        throw genError;
      }

      const responseText = generationResult.text;

      const toolMessages: AgentMessage[] = generationResult.toolResults.map((toolResult) => ({
        role: 'tool',
        content: {
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          input: getToolInput(toolResult),
          output: getToolOutput(toolResult),
        },
      }));

      const assistantMessage: AgentMessage = {
        role: 'assistant',
        content: responseText,
      };

      let updatedMessages = trimConversation([...historyWithUser, ...toolMessages], memorySize);
      updatedMessages = trimConversation([...updatedMessages, assistantMessage], memorySize);

      const nextState: ConversationState = {
        sessionId,
        messages: updatedMessages,
      };

      agentStream.emitTextDelta(responseText);
      agentStream.emitFinish(generationResult?.finishReason ?? 'stop', responseText);
      context.emitProgress({
        level: 'info',
        message: 'AI agent completed.',
        data: {
          agentRunId,
          agentStatus: 'completed',
        },
      });

      return {
        responseText,
        conversationState: nextState,
        agentRunId,
      };
    } finally {
      if (closeDiscovery) {
        await closeDiscovery();
      }
    }
  },
});

componentRegistry.register(definition);

// Create local type aliases for internal use (inferred types)
type Input = (typeof inputSchema)['__inferred'];
type Output = (typeof outputSchema)['__inferred'];
type Params = (typeof parameterSchema)['__inferred'];

// Export schema types for the registry
export type AiAgentInput = typeof inputSchema;
export type AiAgentOutput = typeof outputSchema;
export type AiAgentParams = typeof parameterSchema;

export type { Input as AiAgentInputData, Output as AiAgentOutputData, Params as AiAgentParamsData };

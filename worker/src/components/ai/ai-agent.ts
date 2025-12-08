import { randomUUID } from 'crypto';
import { z, ZodTypeAny } from 'zod';
import {
  ToolLoopAgent as ToolLoopAgentImpl,
  stepCountIs as stepCountIsImpl,
  tool as toolImpl,
  type Tool,
} from 'ai';
import { createOpenAI as createOpenAIImpl } from '@ai-sdk/openai';
import { createGoogleGenerativeAI as createGoogleGenerativeAIImpl } from '@ai-sdk/google';
import {
  componentRegistry,
  ComponentDefinition,
  port,
  type ExecutionContext,
  type AgentTraceEvent,
} from '@shipsec/component-sdk';
import { llmProviderContractName, LLMProviderSchema } from './chat-model-contract';
import {
  McpToolArgumentSchema,
  McpToolDefinitionSchema,
  mcpToolContractName,
} from './mcp-tool-contract';


// Define types for dependencies to enable dependency injection for testing
export type ToolLoopAgentClass = typeof ToolLoopAgentImpl;
export type StepCountIsFn = typeof stepCountIsImpl;
export type ToolFn = typeof toolImpl;
export type CreateOpenAIFn = typeof createOpenAIImpl;
export type CreateGoogleGenerativeAIFn = typeof createGoogleGenerativeAIImpl;

type ModelProvider = 'openai' | 'gemini' | 'openrouter';

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? '';
const GEMINI_BASE_URL = process.env.GEMINI_BASE_URL ?? '';
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OPENROUTER_MODEL = 'openrouter/auto';
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_MEMORY_SIZE = 8;
const DEFAULT_STEP_LIMIT = 4;

const agentMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.unknown(),
});

type AgentMessage = z.infer<typeof agentMessageSchema>;

type CoreMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
};

const toolInvocationMetadataSchema = z.object({
  toolId: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  source: z.string().optional(),
  endpoint: z.string().optional(),
});

const toolInvocationSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  args: z.unknown(),
  result: z.unknown().nullable(),
  timestamp: z.string(),
  metadata: toolInvocationMetadataSchema.optional(),
});

const conversationStateSchema = z.object({
  sessionId: z.string(),
  messages: z.array(agentMessageSchema).default([]),
  toolInvocations: z.array(toolInvocationSchema).default([]),
});

const reasoningActionSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.unknown(),
});

const reasoningObservationSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.unknown(),
  result: z.unknown(),
});

const reasoningStepSchema = z.object({
  step: z.number().int(),
  thought: z.string(),
  finishReason: z.string(),
  actions: z.array(reasoningActionSchema),
  observations: z.array(reasoningObservationSchema),
});

const inputSchema = z.object({
  userInput: z
    .string()
    .min(1, 'Input text cannot be empty')
    .describe('Incoming user text for this agent turn.'),
  conversationState: conversationStateSchema
    .optional()
    .describe('Optional prior conversation state to maintain memory across turns.'),
  chatModel: LLMProviderSchema
    .default({
      provider: 'openai',
      modelId: DEFAULT_OPENAI_MODEL,
    })
    .describe('Chat model configuration (provider, model ID, API key, base URL).'),
  modelApiKey: z
    .string()
    .optional()
    .describe('Optional API key override supplied via a Secret Loader node.'),
  mcpTools: z
    .array(McpToolDefinitionSchema)
    .optional()
    .describe('Normalized MCP tool definitions emitted by provider components.'),
  systemPrompt: z
    .string()
    .default('')
    .describe('Optional system instructions that anchor the agent behaviour.'),
  temperature: z
    .number()
    .min(0)
    .max(2)
    .default(DEFAULT_TEMPERATURE)
    .describe('Sampling temperature. Higher values are more creative, lower values are focused.'),
  maxTokens: z
    .number()
    .int()
    .min(64)
    .max(1_000_000)
    .default(DEFAULT_MAX_TOKENS)
    .describe('Maximum number of tokens to generate on the final turn.'),
  memorySize: z
    .number()
    .int()
    .min(2)
    .max(50)
    .default(DEFAULT_MEMORY_SIZE)
    .describe('How many recent messages (excluding the system prompt) to retain between turns.'),
  stepLimit: z
    .number()
    .int()
    .min(1)
    .max(12)
    .default(DEFAULT_STEP_LIMIT)
    .describe('Maximum sequential reasoning/tool steps before the agent stops.'),
});

type Input = z.infer<typeof inputSchema>;

type ConversationState = z.infer<typeof conversationStateSchema>;
type ToolInvocationEntry = z.infer<typeof toolInvocationSchema>;

type McpToolArgument = z.infer<typeof McpToolArgumentSchema>;

type ReasoningStep = z.infer<typeof reasoningStepSchema>;

type Output = {
  responseText: string;
  conversationState: ConversationState;
  toolInvocations: ToolInvocationEntry[];
  reasoningTrace: ReasoningStep[];
  usage?: unknown;
  rawResponse: unknown;
  agentRunId: string;
};

const outputSchema = z.object({
  responseText: z.string(),
  conversationState: conversationStateSchema,
  toolInvocations: z.array(toolInvocationSchema),
  reasoningTrace: z.array(reasoningStepSchema),
  usage: z.unknown().optional(),
  rawResponse: z.unknown(),
  agentRunId: z.string(),
});

type AgentStreamPart =
  | { type: 'message-start'; messageId: string; role: 'assistant' | 'user'; metadata?: Record<string, unknown> }
  | { type: 'text-delta'; textDelta: string }
  | { type: 'tool-input-available'; toolCallId: string; toolName: string; input: Record<string, unknown> }
  | { type: 'tool-output-available'; toolCallId: string; toolName: string; output: unknown }
  | { type: 'finish'; finishReason: string; responseText: string }
  | { type: `data-${string}`; data: unknown };

class AgentStreamRecorder {
  private sequence = 0;
  private activeTextId: string | null = null;

  constructor(private readonly context: ExecutionContext, private readonly agentRunId: string) {}

  emitMessageStart(role: 'assistant' | 'user' = 'assistant'): void {
    this.emitPart({
      type: 'message-start',
      messageId: this.agentRunId,
      role,
    });
  }

  emitReasoningStep(step: ReasoningStep): void {
    this.emitPart({
      type: 'data-reasoning-step',
      data: step,
    });
  }

  emitToolInput(toolCallId: string, toolName: string, input: Record<string, unknown>): void {
    this.emitPart({
      type: 'tool-input-available',
      toolCallId,
      toolName,
      input,
    });
  }

  emitToolOutput(toolCallId: string, toolName: string, output: unknown): void {
    this.emitPart({
      type: 'tool-output-available',
      toolCallId,
      toolName,
      output,
    });
  }

  emitToolError(toolCallId: string, toolName: string, error: string): void {
    this.emitPart({
      type: 'data-tool-error',
      data: { toolCallId, toolName, error },
    });
  }

  private ensureTextStream(): string {
    if (this.activeTextId) {
      return this.activeTextId;
    }
    const textId = `${this.agentRunId}:text`;
    this.emitPart({
      type: 'data-text-start',
      data: { id: textId },
    });
    this.activeTextId = textId;
    return textId;
  }

  emitTextDelta(textDelta: string): void {
    if (!textDelta.trim()) {
      return;
    }
    const textId = this.ensureTextStream();
    this.emitPart({
      type: 'text-delta',
      textDelta,
    });
  }

  emitFinish(finishReason: string, responseText: string): void {
    if (this.activeTextId) {
      this.emitPart({
        type: 'data-text-end',
        data: { id: this.activeTextId },
      });
      this.activeTextId = null;
    }
    this.emitPart({
      type: 'finish',
      finishReason,
      responseText,
    });
  }

  private emitPart(part: AgentStreamPart): void {
    const timestamp = new Date().toISOString();
    const sequence = ++this.sequence;
    const envelope: AgentTraceEvent = {
      agentRunId: this.agentRunId,
      workflowRunId: this.context.runId,
      nodeRef: this.context.componentRef,
      sequence,
      timestamp,
      part,
    };

    if (this.context.agentTracePublisher) {
      void this.context.agentTracePublisher.publish(envelope);
      return;
    }

    this.context.emitProgress({
      level: 'info',
      message: `[AgentTraceFallback] ${part.type}`,
      data: envelope,
    });
  }
}

class MCPClient {
  private readonly endpoint: string;
  private readonly sessionId: string;
  private readonly headers?: Record<string, string>;

  constructor(options: { endpoint: string; sessionId: string; headers?: Record<string, string> }) {
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.sessionId = options.sessionId;
    this.headers = sanitizeHeaders(options.headers);
  }

  async execute(toolName: string, args: unknown): Promise<unknown> {
    const payload = {
      sessionId: this.sessionId,
      toolName,
      arguments: args ?? {},
    };

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MCP-Session': this.sessionId,
        'X-MCP-Tool': toolName,
        ...(this.headers ?? {}),
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '<no body>');
      throw new Error(`MCP request failed (${response.status} ${response.statusText}): ${errorText}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }

    return await response.text();
  }
}

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

  throw new Error(
    `Model provider API key is not configured for "${provider}". Connect a Secret Loader node to the modelApiKey input or supply chatModel.apiKey.`,
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
    return [{ role: 'system', content: systemPrompt.trim() as string }, ...rest];
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

function sanitizeHeaders(headers?: Record<string, string | undefined> | null): Record<string, string> | undefined {
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

type RegisteredToolMetadata = z.infer<typeof toolInvocationMetadataSchema>;

type RegisteredMcpTool = {
  name: string;
  tool: Tool<any, any>;
  metadata: RegisteredToolMetadata;
};

type RegisterMcpToolParams = {
  tools?: Array<z.infer<typeof McpToolDefinitionSchema>>;
  sessionId: string;
  toolFactory: ToolFn;
  agentStream: AgentStreamRecorder;
  logger?: {
    warn?: (...args: unknown[]) => void;
  };
};

function registerMcpTools({
  tools,
  sessionId,
  toolFactory,
  agentStream,
  logger,
}: RegisterMcpToolParams): RegisteredMcpTool[] {
  if (!Array.isArray(tools) || tools.length === 0) {
    return [];
  }

  const seenIds = new Set<string>();
  const usedNames = new Set<string>();
  const registered: RegisteredMcpTool[] = [];

  tools.forEach((tool, index) => {
    if (!tool || typeof tool !== 'object') {
      return;
    }

    if (seenIds.has(tool.id)) {
      logger?.warn?.(
        `[AIAgent] Skipping MCP tool "${tool.id}" because a duplicate id was detected.`,
      );
      return;
    }
    seenIds.add(tool.id);

    const endpoint = typeof tool.endpoint === 'string' ? tool.endpoint.trim() : '';
    if (!endpoint) {
      logger?.warn?.(
        `[AIAgent] Skipping MCP tool "${tool.id}" because the endpoint is missing or empty.`,
      );
      return;
    }

    const remoteToolName = (tool.metadata?.toolName ?? tool.id).trim() || tool.id;
    const toolName = ensureUniqueToolName(remoteToolName, usedNames, index);

    const client = new MCPClient({
      endpoint,
      sessionId,
      headers: tool.headers,
    });

    const description =
      tool.description ??
      (tool.title ? `Invoke ${tool.title}` : `Invoke MCP tool ${remoteToolName}`);

    const metadata: RegisteredToolMetadata = {
      toolId: tool.id,
      title: tool.title ?? remoteToolName,
      description: tool.description,
      source: tool.metadata?.source,
      endpoint,
    };

    const registeredTool = toolFactory<Record<string, unknown>, unknown>({
      type: 'dynamic',
      description,
      inputSchema: buildToolArgumentSchema(tool.arguments),
      execute: async (args: Record<string, unknown>) => {
        const invocationId = `${tool.id}-${randomUUID()}`;
        const normalizedArgs = args ?? {};
        agentStream.emitToolInput(invocationId, toolName, normalizedArgs);

        try {
          const result = await client.execute(remoteToolName, normalizedArgs);
          agentStream.emitToolOutput(invocationId, toolName, result);
          return result;
        } catch (error) {
          agentStream.emitToolError(
            invocationId,
            toolName,
            error instanceof Error ? error.message : String(error),
          );
          throw error;
        }
      },
    });

    registered.push({
      name: toolName,
      tool: registeredTool,
      metadata,
    });
  });

  return registered;
}

function ensureUniqueToolName(baseName: string, usedNames: Set<string>, index: number): string {
  const sanitized = sanitizeToolKey(baseName);
  let candidate = sanitized.length > 0 ? sanitized : `mcp_tool_${index + 1}`;
  let suffix = 2;

  while (usedNames.has(candidate)) {
    const prefix = sanitized.length > 0 ? sanitized : `mcp_tool_${index + 1}`;
    candidate = `${prefix}_${suffix++}`;
  }

  usedNames.add(candidate);
  return candidate;
}

function sanitizeToolKey(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

function buildToolArgumentSchema(args?: McpToolArgument[]) {
  if (!Array.isArray(args) || args.length === 0) {
    return z.object({}).passthrough();
  }

  const shape = args.reduce<Record<string, ZodTypeAny>>((acc, arg) => {
    const key = arg.name.trim();
    if (!key) {
      return acc;
    }

    let field: ZodTypeAny;
    switch (arg.type) {
      case 'number':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'json':
        field = z.any();
        break;
      case 'string':
      default:
        field = z.string();
        break;
    }

    if (Array.isArray(arg.enum) && arg.enum.length > 0) {
      const stringValues = arg.enum.filter((value): value is string => typeof value === 'string');
      if (stringValues.length === arg.enum.length && stringValues.length > 0) {
        const enumValues = stringValues as [string, ...string[]];
        field = z.enum(enumValues);
      }
    }

    if (arg.description) {
      field = field.describe(arg.description);
    }

    if (!arg.required) {
      field = field.optional();
    }

    acc[key] = field;
    return acc;
  }, {});

  return z.object(shape).passthrough();
}

function mapStepToReasoning(step: any, index: number, sessionId: string): ReasoningStep {
  const getArgs = (entity: any) =>
    entity?.args !== undefined ? entity.args : entity?.input ?? null;
  const getOutput = (entity: any) =>
    entity?.result !== undefined ? entity.result : entity?.output ?? null;

  return {
    step: index + 1,
    thought: typeof step?.text === 'string' ? step.text : JSON.stringify(step?.text ?? ''),
    finishReason: typeof step?.finishReason === 'string' ? step.finishReason : 'other',
    actions: Array.isArray(step?.toolCalls)
      ? step.toolCalls.map((toolCall: any) => ({
          toolCallId: toolCall?.toolCallId ?? `${sessionId}-tool-${index + 1}`,
          toolName: toolCall?.toolName ?? 'tool',
          args: getArgs(toolCall),
        }))
      : [],
    observations: Array.isArray(step?.toolResults)
      ? step.toolResults.map((toolResult: any) => ({
          toolCallId: toolResult?.toolCallId ?? `${sessionId}-tool-${index + 1}`,
          toolName: toolResult?.toolName ?? 'tool',
          args: getArgs(toolResult),
          result: getOutput(toolResult),
        }))
      : [],
  };
}

const definition: ComponentDefinition<Input, Output> = {
  id: 'core.ai.agent',
  label: 'AI SDK Agent',
  category: 'ai',
  runner: { kind: 'inline' },
  inputSchema,
  outputSchema,
  docs: `An AI SDK-powered agent that maintains conversation memory, calls MCP tools, and returns both the final answer and a reasoning trace.

How it behaves:
- Memory → The agent maintains a conversation state object you can persist between turns.
- Model → Connect a chat model configuration output into the Chat Model input or customise the defaults below.
- MCP → Supply an MCP endpoint through the MCP input to expose your external tools.

Typical workflow:
1. Entry Point (or upstream Chat Model) → wire its text output into User Input.
2. AI SDK Agent (this node) → loops with Think/Act/Observe, logging tool calls and keeping state.
3. Downstream node (Console Log, Storage, etc.) → consume responseText or reasoningTrace.

Loop the Conversation State output back into the next agent invocation to keep multi-turn context.`,
  metadata: {
    slug: 'ai-agent',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description: 'AI SDK agent with conversation memory, MCP tool calling, and reasoning trace output.',
    icon: 'Bot',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
    inputs: [
      {
        id: 'userInput',
        label: 'User Input',
        dataType: port.text(),
        required: true,
        description: 'Incoming user text for this agent turn.',
      },
      {
        id: 'chatModel',
        label: 'Chat Model',
        dataType: port.credential(llmProviderContractName),
        required: false,
        description: 'Provider configuration. Example: {"provider":"gemini","modelId":"gemini-2.5-flash","apiKey":"gm-..."}',
      },
      {
        id: 'modelApiKey',
        label: 'Model API Key',
        dataType: port.secret(),
        required: false,
        description: 'Optional override API key supplied via a Secret Loader output.',
      },
      {
        id: 'mcpTools',
        label: 'MCP Tools',
        dataType: port.list(port.contract(mcpToolContractName)),
        required: false,
        description: 'Connect outputs from MCP tool providers or mergers.',
      },
    ],
    outputs: [
      {
        id: 'responseText',
        label: 'Agent Response',
        dataType: port.text(),
        description: 'Final assistant message produced by the agent.',
      },
      {
        id: 'conversationState',
        label: 'Conversation State',
        dataType: port.json(),
        description: 'Updated conversation memory for subsequent agent turns.',
      },
      {
        id: 'toolInvocations',
        label: 'Tool Invocations',
        dataType: port.json(),
        description: 'Array of MCP tool calls executed during this run.',
      },
      {
        id: 'reasoningTrace',
        label: 'Reasoning Trace',
        dataType: port.json(),
        description: 'Sequence of Think → Act → Observe steps executed by the agent.',
      },
      {
        id: 'agentRunId',
        label: 'Agent Run ID',
        dataType: port.text(),
        description: 'Unique identifier for streaming and replaying this agent session.',
      },
    ],
    parameters: [
      {
        id: 'systemPrompt',
        label: 'System Instructions',
        type: 'textarea',
        required: false,
        default: '',
        rows: 4,
        description: 'Optional system directive that guides the agent behaviour.',
      },
      {
        id: 'temperature',
        label: 'Temperature',
        type: 'number',
        required: false,
        default: DEFAULT_TEMPERATURE,
        min: 0,
        max: 2,
        description: 'Higher values increase creativity, lower values improve determinism.',
      },
      {
        id: 'maxTokens',
        label: 'Max Tokens',
        type: 'number',
        required: false,
        default: DEFAULT_MAX_TOKENS,
        min: 64,
        max: 1_000_000,
        description: 'Upper bound for tokens generated in the final response.',
      },
      {
        id: 'memorySize',
        label: 'Memory Size',
        type: 'number',
        required: false,
        default: DEFAULT_MEMORY_SIZE,
        min: 2,
        max: 50,
        description: 'How many recent turns to keep in memory (excluding the system prompt).',
      },
      {
        id: 'stepLimit',
        label: 'Step Limit',
        type: 'number',
        required: false,
        default: DEFAULT_STEP_LIMIT,
        min: 1,
        max: 12,
        description: 'Maximum reasoning/tool steps before the agent stops automatically.',
      },
    ],
  },
  async execute(
    params, 
    context,
    // Optional dependencies for testing - in production these will use the default implementations
    dependencies?: {
      ToolLoopAgent?: ToolLoopAgentClass;
      stepCountIs?: StepCountIsFn;
      tool?: ToolFn;
      createOpenAI?: CreateOpenAIFn;
      createGoogleGenerativeAI?: CreateGoogleGenerativeAIFn;
    }
  ) {
    const {
      userInput,
      conversationState,
      chatModel,
      mcpTools,
      systemPrompt,
      temperature,
      maxTokens,
      memorySize,
      stepLimit,
    } = params;

    const debugLog = (...args: unknown[]) => context.logger.debug(`[AIAgent Debug] ${args.join(' ')}`);
    const agentRunId = `${context.runId}:${context.componentRef}:${randomUUID()}`;
    const agentStream = new AgentStreamRecorder(context as ExecutionContext, agentRunId);
    agentStream.emitMessageStart();
    context.emitProgress({
      level: 'info',
      message: 'AI agent session started',
      data: {
        agentRunId,
        agentStatus: 'started',
      },
    });

    debugLog('Incoming params', {
      userInput,
      conversationState,
      chatModel,
      mcpTools,
      systemPrompt,
      temperature,
      maxTokens,
      memorySize,
      stepLimit,
    });

    const trimmedInput = userInput.trim();
    debugLog('Trimmed input', trimmedInput);

    if (!trimmedInput) {
      throw new Error('AI Agent requires a non-empty user input.');
    }

    const effectiveProvider = (chatModel?.provider ?? 'openai') as ModelProvider;
    const effectiveModel = ensureModelName(effectiveProvider, chatModel?.modelId ?? null);

    let overrideApiKey = chatModel?.apiKey ?? null;
    if (params.modelApiKey && params.modelApiKey.trim().length > 0) {
      overrideApiKey = params.modelApiKey.trim();
    }

    const effectiveApiKey = resolveApiKey(effectiveProvider, overrideApiKey);
    debugLog('Resolved model configuration', {
      effectiveProvider,
      effectiveModel,
      hasExplicitApiKey: Boolean(chatModel?.apiKey) || Boolean(params.modelApiKey),
      apiKeyProvided: Boolean(effectiveApiKey),
    });

    const explicitBaseUrl = chatModel?.baseUrl?.trim();
    const baseUrl =
      explicitBaseUrl && explicitBaseUrl.length > 0
        ? explicitBaseUrl
        : effectiveProvider === 'gemini'
          ? GEMINI_BASE_URL
          : effectiveProvider === 'openrouter'
            ? OPENROUTER_BASE_URL
            : OPENAI_BASE_URL;

    debugLog('Resolved base URL', { explicitBaseUrl, baseUrl });

    const sanitizedHeaders =
      chatModel && (chatModel.provider === 'openai' || chatModel.provider === 'openrouter')
        ? sanitizeHeaders(chatModel.headers)
        : undefined;
    debugLog('Sanitized headers', sanitizedHeaders);

    const incomingState = conversationState;
    debugLog('Incoming conversation state', incomingState);

    const sessionId = incomingState?.sessionId ?? randomUUID();
    const existingMessages = Array.isArray(incomingState?.messages) ? incomingState!.messages : [];
    const existingToolHistory = Array.isArray(incomingState?.toolInvocations)
      ? incomingState!.toolInvocations
      : [];
    debugLog('Session details', {
      sessionId,
      existingMessagesCount: existingMessages.length,
      existingToolHistoryCount: existingToolHistory.length,
    });

    let history: AgentMessage[] = ensureSystemMessage([...existingMessages], systemPrompt ?? '');
    history = trimConversation(history, memorySize);
    debugLog('History after ensuring system message and trimming', history);

    const userMessage: AgentMessage = { role: 'user', content: trimmedInput };
    const historyWithUser = trimConversation([...history, userMessage], memorySize);
    debugLog('History with user message', historyWithUser);

    const toolFn = dependencies?.tool ?? toolImpl;
    const toolMetadataByName = new Map<string, RegisteredToolMetadata>();
    const registeredTools: Record<string, Tool<any, any>> = {};

    const registeredMcpTools = registerMcpTools({
      tools: mcpTools,
      sessionId,
      toolFactory: toolFn,
      agentStream,
      logger: context.logger,
    });
    for (const entry of registeredMcpTools) {
      registeredTools[entry.name] = entry.tool;
      toolMetadataByName.set(entry.name, entry.metadata);
    }

    const availableToolsCount = Object.keys(registeredTools).length;
    const toolsConfig = availableToolsCount > 0 ? registeredTools : undefined;
    debugLog('Tools configuration', {
      availableToolsCount,
      toolsConfigKeys: toolsConfig ? Object.keys(toolsConfig) : [],
    });

    const systemMessageEntry = historyWithUser.find((message) => message.role === 'system');
    const resolvedSystemPrompt =
      systemPrompt?.trim()?.length
        ? systemPrompt.trim()
        : systemMessageEntry && typeof systemMessageEntry.content === 'string'
          ? systemMessageEntry.content
          : systemMessageEntry && systemMessageEntry.content !== undefined
            ? JSON.stringify(systemMessageEntry.content)
            : '';
    debugLog('Resolved system prompt', resolvedSystemPrompt);

    const messagesForModel = historyWithUser
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role,
        content:
          typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      }));
    debugLog('Messages for model', messagesForModel);

    const createGoogleGenerativeAI =
      dependencies?.createGoogleGenerativeAI ?? createGoogleGenerativeAIImpl;
    const createOpenAI = dependencies?.createOpenAI ?? createOpenAIImpl;
    const openAIOptions = {
      apiKey: effectiveApiKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
      ...(sanitizedHeaders && Object.keys(sanitizedHeaders).length > 0
        ? { headers: sanitizedHeaders }
        : {}),
    };
    const model =
      effectiveProvider === 'gemini'
        ? createGoogleGenerativeAI({
            apiKey: effectiveApiKey,
            ...(baseUrl ? { baseURL: baseUrl } : {}),
          })(effectiveModel)
        : createOpenAI(openAIOptions)(effectiveModel);
    debugLog('Model factory created', {
      provider: effectiveProvider,
      modelId: effectiveModel,
      baseUrl,
      headers: sanitizedHeaders,
      temperature,
      maxTokens,
      stepLimit,
    });

    const ToolLoopAgent = dependencies?.ToolLoopAgent ?? ToolLoopAgentImpl;
    const stepCountIs = dependencies?.stepCountIs ?? stepCountIsImpl;
    let streamedStepCount = 0;
    const agent = new ToolLoopAgent({
      id: `${sessionId}-agent`,
      model,
      instructions: resolvedSystemPrompt || undefined,
      ...(toolsConfig ? { tools: toolsConfig } : {}),
      temperature,
      maxOutputTokens: maxTokens,
      stopWhen: stepCountIs(stepLimit),
      onStepFinish: (stepResult: unknown) => {
        const mappedStep = mapStepToReasoning(stepResult, streamedStepCount, sessionId);
        streamedStepCount += 1;
        agentStream.emitReasoningStep(mappedStep);
      },
    });
    debugLog('ToolLoopAgent instantiated', {
      id: `${sessionId}-agent`,
      temperature,
      maxTokens,
      stepLimit,
      toolKeys: toolsConfig ? Object.keys(toolsConfig) : [],
    });

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
    debugLog('Invoking ToolLoopAgent.generate with payload', {
      messages: messagesForModel,
    });

    const generationResult = await agent.generate({
      messages: messagesForModel as any,
    });
    debugLog('Generation result', generationResult);

    const responseText =
      typeof generationResult.text === 'string' ? generationResult.text : String(generationResult.text ?? '');
    debugLog('Response text', responseText);

    const currentTimestamp = new Date().toISOString();
    debugLog('Current timestamp', currentTimestamp);

    const getToolArgs = (entity: any) =>
      entity?.args !== undefined ? entity.args : entity?.input ?? null;
    const getToolOutput = (entity: any) =>
      entity?.result !== undefined ? entity.result : entity?.output ?? null;

    const reasoningTrace: ReasoningStep[] = Array.isArray(generationResult.steps)
      ? generationResult.steps.map((step: any, index: number) => mapStepToReasoning(step, index, sessionId))
      : [];
    debugLog('Reasoning trace', reasoningTrace);

    const toolLogEntries: ToolInvocationEntry[] = Array.isArray(generationResult.toolResults)
      ? generationResult.toolResults.map((toolResult: any, index: number) => {
          const toolName = toolResult?.toolName ?? 'tool';
          return {
            id: `${sessionId}-${toolResult?.toolCallId ?? index + 1}`,
            toolName,
            args: getToolArgs(toolResult),
            result: getToolOutput(toolResult),
            timestamp: currentTimestamp,
            metadata: toolMetadataByName.get(toolName),
          };
        })
      : [];
    debugLog('Tool log entries', toolLogEntries);

    const toolMessages: AgentMessage[] = Array.isArray(generationResult.toolResults)
      ? generationResult.toolResults.map((toolResult: any) => ({
          role: 'tool',
          content: {
            toolCallId: toolResult?.toolCallId ?? '',
            toolName: toolResult?.toolName ?? 'tool',
            args: getToolArgs(toolResult),
            result: getToolOutput(toolResult),
          },
        }))
      : [];
    debugLog('Tool messages appended to history', toolMessages);

    const assistantMessage: AgentMessage = {
      role: 'assistant',
      content: responseText,
    };
    debugLog('Assistant message', assistantMessage);

    let updatedMessages = trimConversation([...historyWithUser, ...toolMessages], memorySize);
    updatedMessages = trimConversation([...updatedMessages, assistantMessage], memorySize);
    debugLog('Updated messages after trimming', updatedMessages);

    const combinedToolHistory = [...existingToolHistory, ...toolLogEntries];
    debugLog('Combined tool history', combinedToolHistory);

    const nextState: ConversationState = {
      sessionId,
      messages: updatedMessages,
      toolInvocations: combinedToolHistory,
    };
    debugLog('Next conversation state', nextState);

    agentStream.emitTextDelta(responseText);
    agentStream.emitFinish(generationResult.finishReason ?? 'stop', responseText);
    context.emitProgress({
      level: 'info',
      message: 'AI agent completed.',
      data: {
        agentRunId,
        agentStatus: 'completed',
      },
    });
    debugLog('Final output payload', {
      responseText,
      conversationState: nextState,
      toolInvocations: toolLogEntries,
      reasoningTrace,
      usage: generationResult.usage,
    });

    return {
      responseText,
      conversationState: nextState,
      toolInvocations: toolLogEntries,
      reasoningTrace,
      usage: generationResult.usage,
      rawResponse: generationResult,
      agentRunId,
    };
  },
};

componentRegistry.register(definition);

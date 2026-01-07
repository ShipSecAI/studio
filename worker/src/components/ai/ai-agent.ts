import { randomUUID } from 'crypto';
import { z, ZodTypeAny } from 'zod';
import {
  ToolLoopAgent as ToolLoopAgentImpl,
  stepCountIs as stepCountIsImpl,
  tool as toolImpl,
  generateObject as generateObjectImpl,
  generateText as generateTextImpl,
  jsonSchema as createJsonSchema,
  type Tool,
} from 'ai';
import { createOpenAI as createOpenAIImpl } from '@ai-sdk/openai';
import { createGoogleGenerativeAI as createGoogleGenerativeAIImpl } from '@ai-sdk/google';
import {
  componentRegistry,
  ComponentDefinition,
  ComponentRetryPolicy,
  port,
  type ExecutionContext,
  type AgentTraceEvent,
  ConfigurationError,
  ValidationError,
  fromHttpResponse,
} from '@shipsec/component-sdk';
import { llmProviderContractName, LLMProviderSchema } from './chat-model-contract';
import {
  McpToolArgumentSchema,
  McpToolDefinitionSchema,
  mcpToolContractName,
} from './mcp-tool-contract';
import {
  getMcpClientService,
  type McpServerConfig,
  type McpToolInfo,
} from '../../services/mcp-client.service.js';


// Define types for dependencies to enable dependency injection for testing
export type ToolLoopAgentClass = typeof ToolLoopAgentImpl;
export type StepCountIsFn = typeof stepCountIsImpl;
export type ToolFn = typeof toolImpl;
export type CreateOpenAIFn = typeof createOpenAIImpl;
export type CreateGoogleGenerativeAIFn = typeof createGoogleGenerativeAIImpl;
export type GenerateObjectFn = typeof generateObjectImpl;
export type GenerateTextFn = typeof generateTextImpl;

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
  structuredOutputEnabled: z
    .boolean()
    .default(false)
    .describe('Enable structured JSON output that adheres to a defined schema.'),
  schemaType: z
    .enum(['json-example', 'json-schema'])
    .default('json-example')
    .describe('How to define the output schema: from a JSON example or a full JSON Schema.'),
  jsonExample: z
    .string()
    .optional()
    .describe('Example JSON object to generate schema from. All properties become required.'),
  jsonSchema: z
    .string()
    .optional()
    .describe('Full JSON Schema definition for structured output validation.'),
  autoFixFormat: z
    .boolean()
    .default(false)
    .describe('Attempt to fix malformed JSON responses from the model.'),
  // MCP Library integration parameters
  mcpLibraryEnabled: z
    .boolean()
    .default(true)
    .describe('When enabled, automatically loads tools from MCP servers in the MCP Library.'),
  mcpLibraryServerExclusions: z
    .array(z.string())
    .optional()
    .describe('List of MCP server IDs to exclude from the library.'),
  mcpLibraryToolExclusions: z
    .array(z.string())
    .optional()
    .describe('List of tool names to exclude from MCP Library servers.'),
});

type Input = z.infer<typeof inputSchema>;

type ConversationState = z.infer<typeof conversationStateSchema>;
type ToolInvocationEntry = z.infer<typeof toolInvocationSchema>;

type McpToolArgument = z.infer<typeof McpToolArgumentSchema>;

type ReasoningStep = z.infer<typeof reasoningStepSchema>;

type Output = {
  responseText: string;
  structuredOutput: unknown;
  conversationState: ConversationState;
  toolInvocations: ToolInvocationEntry[];
  reasoningTrace: ReasoningStep[];
  usage?: unknown;
  rawResponse: unknown;
  agentRunId: string;
};

const outputSchema = z.object({
  responseText: z.string(),
  structuredOutput: z.unknown().nullable(),
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
      throw fromHttpResponse(response, `MCP request failed: ${errorText}`);
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

/**
 * Convert JSON Schema to Zod schema for MCP Library tools.
 */
function jsonSchemaToZod(schema: Record<string, unknown> | undefined): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.object({}).passthrough();
  }

  const schemaType = schema.type as string | undefined;
  const properties = schema.properties as Record<string, unknown> | undefined;
  const requiredFields = (schema.required as string[]) ?? [];

  if (schemaType !== 'object' || !properties) {
    return z.object({}).passthrough();
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    const prop = propSchema as Record<string, unknown>;
    const propType = prop.type as string | undefined;
    const propDesc = prop.description as string | undefined;

    let field: z.ZodTypeAny;
    switch (propType) {
      case 'number':
      case 'integer':
        field = z.number();
        break;
      case 'boolean':
        field = z.boolean();
        break;
      case 'array':
        field = z.array(z.any());
        break;
      case 'object':
        field = z.record(z.string(), z.any());
        break;
      case 'string':
      default:
        field = z.string();
        break;
    }

    if (propDesc) {
      field = field.describe(propDesc);
    }

    if (!requiredFields.includes(key)) {
      field = field.optional();
    }

    shape[key] = field;
  }

  return z.object(shape).passthrough();
}

type RegisterMcpLibraryToolParams = {
  server: McpServerConfig;
  tool: McpToolInfo;
  sessionId: string;
  toolFactory: ToolFn;
  agentStream: AgentStreamRecorder;
  usedNames: Set<string>;
  index: number;
};

/**
 * Registers a single MCP Library tool using the MCP client service.
 */
function registerMcpLibraryTool({
  server,
  tool,
  sessionId,
  toolFactory,
  agentStream,
  usedNames,
  index,
}: RegisterMcpLibraryToolParams): RegisteredMcpTool | null {
  const mcpClient = getMcpClientService();
  const toolName = ensureUniqueToolName(tool.name, usedNames, index);

  const metadata: RegisteredToolMetadata = {
    toolId: `${server.id}:${tool.name}`,
    title: tool.name,
    description: tool.description,
    source: `mcp-library:${server.name}`,
    endpoint: server.endpoint ?? server.command ?? undefined,
  };

  const registeredTool = toolFactory<Record<string, unknown>, unknown>({
    type: 'dynamic',
    description: tool.description ?? `Invoke ${tool.name} from ${server.name}`,
    inputSchema: jsonSchemaToZod(tool.inputSchema) as z.ZodObject<any>,
    execute: async (args: Record<string, unknown>) => {
      const invocationId = `${server.id}:${tool.name}-${randomUUID()}`;
      const normalizedArgs = args ?? {};
      agentStream.emitToolInput(invocationId, toolName, normalizedArgs);

      try {
        const result = await mcpClient.callTool(server, tool.name, normalizedArgs);
        // Extract text content from MCP response
        const output = result.content?.map(c => c.text ?? JSON.stringify(c)).join('\n')
          ?? result.toolResult
          ?? result;
        agentStream.emitToolOutput(invocationId, toolName, output);
        return output;
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

  return {
    name: toolName,
    tool: registeredTool,
    metadata,
  };
}

/**
 * Loads and registers tools from MCP Library servers.
 */
async function loadMcpLibraryTools(params: {
  serverExclusions?: string[];
  toolExclusions?: string[];
  sessionId: string;
  toolFactory: ToolFn;
  agentStream: AgentStreamRecorder;
  usedNames: Set<string>;
  organizationId?: string | null;
  logger?: {
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    debug?: (...args: unknown[]) => void;
  };
}): Promise<RegisteredMcpTool[]> {
  const {
    serverExclusions = [],
    toolExclusions = [],
    sessionId,
    toolFactory,
    agentStream,
    usedNames,
    organizationId,
    logger,
  } = params;

  const mcpClient = getMcpClientService();
  const registered: RegisteredMcpTool[] = [];

  // Fetch enabled MCP servers from the backend
  const DEFAULT_API_BASE_URL =
    process.env.STUDIO_API_BASE_URL ??
    process.env.SHIPSEC_API_BASE_URL ??
    process.env.API_BASE_URL ??
    'http://localhost:3211';

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    logger?.warn?.('[MCP Library] INTERNAL_SERVICE_TOKEN not set, skipping MCP Library integration');
    return [];
  }

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
    };
    if (organizationId) {
      headers['X-Organization-Id'] = organizationId;
    }

    const baseUrl = DEFAULT_API_BASE_URL.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}/api/v1/mcp-servers/enabled`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      logger?.warn?.(`[MCP Library] Failed to fetch servers: ${response.status}`);
      return [];
    }

    const serversData = (await response.json()) as Array<{
      id: string;
      name: string;
      transportType: 'http' | 'stdio' | 'sse' | 'websocket';
      endpoint?: string | null;
      command?: string | null;
      args?: string[] | null;
      enabled: boolean;
    }>;

    // Filter out excluded servers
    const serverExclusionSet = new Set(serverExclusions);
    const servers: McpServerConfig[] = serversData
      .filter(s => !serverExclusionSet.has(s.id))
      .map(s => ({
        id: s.id,
        name: s.name,
        transportType: s.transportType,
        endpoint: s.endpoint,
        command: s.command,
        args: s.args,
        headers: null, // Headers are handled by internal endpoints for now
        enabled: s.enabled,
      }));

    logger?.info?.(`[MCP Library] Found ${servers.length} enabled servers (${serversData.length - servers.length} excluded)`);

    // Health check and discover tools from each server
    const toolExclusionSet = new Set(toolExclusions);
    let toolIndex = 0;

    for (const server of servers) {
      try {
        // Health check
        const healthResult = await mcpClient.healthCheck(server);
        if (healthResult.status !== 'healthy') {
          logger?.warn?.(`[MCP Library] Server "${server.name}" is unhealthy: ${healthResult.error}`);
          continue;
        }

        // Discover tools
        const tools = await mcpClient.discoverTools(server);
        logger?.debug?.(`[MCP Library] Server "${server.name}" has ${tools.length} tools`);

        for (const tool of tools) {
          // Skip excluded tools
          if (toolExclusionSet.has(tool.name)) {
            logger?.debug?.(`[MCP Library] Skipping excluded tool "${tool.name}"`);
            continue;
          }

          const registeredTool = registerMcpLibraryTool({
            server,
            tool,
            sessionId,
            toolFactory,
            agentStream,
            usedNames,
            index: toolIndex++,
          });

          if (registeredTool) {
            registered.push(registeredTool);
          }
        }
      } catch (error) {
        logger?.warn?.(
          `[MCP Library] Failed to load tools from "${server.name}": ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    logger?.info?.(`[MCP Library] Registered ${registered.length} tools from MCP Library`);
    return registered;
  } catch (error) {
    logger?.warn?.(`[MCP Library] Error loading MCP Library: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
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

/**
 * Converts a JSON example object to a JSON Schema.
 * All properties are treated as required (matching n8n behavior).
 */
function jsonExampleToJsonSchema(example: unknown): object {
  if (example === null) {
    return { type: 'null' };
  }

  if (Array.isArray(example)) {
    const items = example.length > 0
      ? jsonExampleToJsonSchema(example[0])
      : {};
    return { type: 'array', items };
  }

  if (typeof example === 'object') {
    const properties: Record<string, object> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(example as Record<string, unknown>)) {
      properties[key] = jsonExampleToJsonSchema(value);
      required.push(key);
    }

    return {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    };
  }

  if (typeof example === 'string') return { type: 'string' };
  if (typeof example === 'number') {
    return Number.isInteger(example) ? { type: 'integer' } : { type: 'number' };
  }
  if (typeof example === 'boolean') return { type: 'boolean' };

  return {};
}

/**
 * Resolves the structured output schema from user input.
 * Returns null if structured output is disabled or no valid schema provided.
 */
function resolveStructuredOutputSchema(params: {
  structuredOutputEnabled?: boolean;
  schemaType?: 'json-example' | 'json-schema';
  jsonExample?: string;
  jsonSchema?: string;
}): object | null {
  if (!params.structuredOutputEnabled) {
    return null;
  }

  if (params.schemaType === 'json-example' && params.jsonExample) {
    try {
      const example = JSON.parse(params.jsonExample);
      return jsonExampleToJsonSchema(example);
    } catch (e) {
      throw new ValidationError('Invalid JSON example: unable to parse JSON.', {
        cause: e instanceof Error ? e : undefined,
        details: { field: 'jsonExample' },
      });
    }
  }

  if (params.schemaType === 'json-schema' && params.jsonSchema) {
    try {
      return JSON.parse(params.jsonSchema);
    } catch (e) {
      throw new ValidationError('Invalid JSON Schema: unable to parse JSON.', {
        cause: e instanceof Error ? e : undefined,
        details: { field: 'jsonSchema' },
      });
    }
  }

  return null;
}

/**
 * Attempts to fix malformed JSON by extracting valid JSON from text.
 * Handles common issues like markdown code blocks, extra text before/after JSON.
 */
function attemptJsonFix(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    // Continue to fixes
  }

  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '');

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  const jsonCandidate = objectMatch?.[0] ?? arrayMatch?.[0];

  if (jsonCandidate) {
    try {
      return JSON.parse(jsonCandidate);
    } catch {
      // Continue
    }
  }

  cleaned = cleaned
    .trim()
    .replace(/^(Here'?s?|The|Output:?|Result:?|Response:?)\s*/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

const definition: ComponentDefinition<Input, Output> = {
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
        id: 'structuredOutput',
        label: 'Structured Output',
        dataType: port.json(),
        description: 'Parsed JSON object when structured output is enabled. Null otherwise.',
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
      {
        id: 'structuredOutputEnabled',
        label: 'Structured Output',
        type: 'boolean',
        required: false,
        default: false,
        description: 'Enable to enforce a specific JSON output structure from the AI model.',
      },
      {
        id: 'schemaType',
        label: 'Schema Type',
        type: 'select',
        required: false,
        default: 'json-example',
        options: [
          { label: 'Generate From JSON Example', value: 'json-example' },
          { label: 'Define Using JSON Schema', value: 'json-schema' },
        ],
        description: 'Choose how to define the output structure.',
        visibleWhen: { structuredOutputEnabled: true },
      },
      {
        id: 'jsonExample',
        label: 'JSON Example',
        type: 'json',
        required: false,
        description: 'Provide an example JSON object. Property types and names will be used to generate the schema. All fields are treated as required.',
        helpText: 'Example: { "name": "John", "age": 30, "skills": ["security", "architecture"] }',
        visibleWhen: { structuredOutputEnabled: true, schemaType: 'json-example' },
      },
      {
        id: 'jsonSchema',
        label: 'JSON Schema',
        type: 'json',
        required: false,
        description: 'Provide a full JSON Schema definition. Refer to json-schema.org for syntax.',
        helpText: 'Example: { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] }',
        visibleWhen: { structuredOutputEnabled: true, schemaType: 'json-schema' },
      },
      {
        id: 'autoFixFormat',
        label: 'Auto-Fix Format',
        type: 'boolean',
        required: false,
        default: false,
        description: 'Attempt to fix malformed JSON responses from the model.',
        helpText: 'When enabled, tries to extract valid JSON from responses that contain extra text or formatting issues.',
        visibleWhen: { structuredOutputEnabled: true },
      },
      {
        id: 'mcpLibraryEnabled',
        label: 'MCP Library',
        type: 'boolean',
        required: false,
        default: true,
        description: 'Automatically load tools from MCP servers configured in the MCP Library.',
        helpText: 'When enabled, all healthy MCP servers will have their tools available to this agent.',
      },
      {
        id: 'mcpLibraryServerExclusions',
        label: 'Excluded MCP Servers',
        type: 'json',
        required: false,
        description: 'List of MCP server IDs to exclude from the library.',
        helpText: 'Enter an array of server IDs: ["server-id-1", "server-id-2"]',
        visibleWhen: { mcpLibraryEnabled: true },
      },
      {
        id: 'mcpLibraryToolExclusions',
        label: 'Excluded MCP Tools',
        type: 'json',
        required: false,
        description: 'List of tool names to exclude from MCP Library servers.',
        helpText: 'Enter an array of tool names: ["tool-name-1", "tool-name-2"]',
        visibleWhen: { mcpLibraryEnabled: true },
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
      generateObject?: GenerateObjectFn;
      generateText?: GenerateTextFn;
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
      structuredOutputEnabled,
      schemaType,
      jsonExample,
      jsonSchema,
      autoFixFormat,
      mcpLibraryEnabled,
      mcpLibraryServerExclusions,
      mcpLibraryToolExclusions,
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
      throw new ValidationError('AI Agent requires a non-empty user input.', {
        fieldErrors: { userInput: ['Input cannot be empty'] },
      });
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
    const usedToolNames = new Set<string>();

    // Register directly-connected MCP tools first
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
      usedToolNames.add(entry.name);
    }

    // Load MCP Library tools if enabled (default: true)
    if (mcpLibraryEnabled !== false) {
      debugLog('Loading MCP Library tools...');
      context.emitProgress({
        level: 'info',
        message: 'Loading MCP Library tools...',
        data: { agentRunId, agentStatus: 'loading_mcp_library' },
      });

      try {
        const mcpLibraryTools = await loadMcpLibraryTools({
          serverExclusions: mcpLibraryServerExclusions,
          toolExclusions: mcpLibraryToolExclusions,
          sessionId,
          toolFactory: toolFn,
          agentStream,
          usedNames: usedToolNames,
          organizationId: (context as any).organizationId ?? null,
          logger: context.logger,
        });

        for (const entry of mcpLibraryTools) {
          registeredTools[entry.name] = entry.tool;
          toolMetadataByName.set(entry.name, entry.metadata);
        }

        debugLog(`Loaded ${mcpLibraryTools.length} MCP Library tools`);
      } catch (error) {
        // Log but don't fail the agent if MCP Library loading fails
        context.logger.warn(
          `[AIAgent] Failed to load MCP Library tools: ${error instanceof Error ? error.message : String(error)}`
        );
      }
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

    // Resolve structured output schema if enabled
    const structuredSchema = resolveStructuredOutputSchema({
      structuredOutputEnabled,
      schemaType,
      jsonExample,
      jsonSchema,
    });

    let responseText: string;
    let structuredOutput: unknown = null;
    let generationResult: any;

    if (structuredSchema) {
      // Use generateObject for structured output mode
      context.logger.info('[AIAgent] Using structured output mode with JSON Schema.');
      context.emitProgress({
        level: 'info',
        message: 'AI agent generating structured output...',
        data: {
          agentRunId,
          agentStatus: 'running',
        },
      });

      const generateObject = dependencies?.generateObject ?? generateObjectImpl;
      const generateText = dependencies?.generateText ?? generateTextImpl;

      try {
        const objectResult = await generateObject({
          model,
          schema: createJsonSchema(structuredSchema),
          system: resolvedSystemPrompt || undefined,
          messages: messagesForModel as any,
          temperature,
          maxOutputTokens: maxTokens,
        });

        structuredOutput = objectResult.object;
        responseText = JSON.stringify(structuredOutput, null, 2);
        generationResult = {
          text: responseText,
          steps: [],
          toolResults: [],
          finishReason: 'stop',
          usage: objectResult.usage,
        };
        debugLog('Structured output generated successfully', structuredOutput);
      } catch (error) {
        // If generateObject fails and auto-fix is enabled, try text generation + fix
        if (autoFixFormat) {
          context.logger.warn('[AIAgent] Structured output failed, attempting auto-fix via text generation.');

          const textResult = await generateText({
            model,
            system: resolvedSystemPrompt || undefined,
            messages: [
              ...messagesForModel,
              { role: 'user' as const, content: `Respond with valid JSON matching this schema: ${JSON.stringify(structuredSchema)}` }
            ] as any,
            temperature,
            maxOutputTokens: maxTokens,
          });

          const fixedOutput = attemptJsonFix(textResult.text);
          if (fixedOutput !== null) {
            structuredOutput = fixedOutput;
            responseText = JSON.stringify(fixedOutput, null, 2);
            generationResult = {
              text: responseText,
              steps: [],
              toolResults: [],
              finishReason: 'stop',
              usage: textResult.usage,
            };
            debugLog('Auto-fix succeeded', fixedOutput);
          } else {
            throw new ValidationError(
              `Structured output failed and auto-fix could not parse response`,
              {
                cause: error instanceof Error ? error : undefined,
                details: {
                  field: 'structuredOutput',
                  originalError: error instanceof Error ? error.message : String(error),
                  responseSnippet: textResult.text.slice(0, 500),
                  fullResponseLength: textResult.text.length,
                },
              },
            );
          }
        } else {
          throw error;
        }
      }
    } else {
      // Use ToolLoopAgent for standard text generation with tools
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

      generationResult = await agent.generate({
        messages: messagesForModel as any,
      });
      debugLog('Generation result', generationResult);

      responseText =
        typeof generationResult.text === 'string' ? generationResult.text : String(generationResult.text ?? '');
    }
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
      structuredOutput,
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

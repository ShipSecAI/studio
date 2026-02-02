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

<<<<<<< HEAD
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

=======
>>>>>>> main
type ConversationState = z.infer<typeof conversationStateSchema>;
type AgentTools = ToolSet;
type AgentStepResult = StepResult<AgentTools>;
type AgentGenerationResult = GenerateTextResult<AgentTools, never>;
type ToolResultOutput = ToolResultPart['output'];
interface AiSdkOverrides {
  ToolLoopAgent?: typeof ToolLoopAgent;
  stepCountIs?: typeof stepCountIs;
  createOpenAI?: typeof createOpenAI;
  createGoogleGenerativeAI?: typeof createGoogleGenerativeAI;
  createMCPClient?: typeof createMCPClient;
}

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

<<<<<<< HEAD
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
=======
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
>>>>>>> main

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
  createClient?: typeof createMCPClient;
}

async function registerGatewayTools({
  gatewayUrl,
  sessionToken,
  createClient = createMCPClient,
}: RegisterGatewayToolsParams): Promise<{
  tools: ToolSet;
  close: () => Promise<void>;
}> {
  console.log(`[AGENT] Connecting to MCP gateway at ${gatewayUrl} to discover tools`);
  const mcpClient = await createClient({
    transport: {
      type: 'http',
      url: gatewayUrl,
      headers: { Authorization: `Bearer ${sessionToken}` },
    },
  });

  const tools = await mcpClient.tools();
  console.log(
    `[AGENT] Discovered ${Object.keys(tools).length} tools from gateway: ${Object.keys(tools).join(', ') || 'none'}`,
  );
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
<<<<<<< HEAD
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
=======
  },
  async execute({ inputs, params }, context) {
    const { userInput, conversationState, chatModel, modelApiKey } = inputs;
    const { systemPrompt, temperature, maxTokens, memorySize, stepLimit } = params;
>>>>>>> main

    const agentRunId = `${context.runId}:${context.componentRef}:${randomUUID()}`;

    const agentStream = new AgentStreamRecorder(context, agentRunId);
    const { connectedToolNodeIds, organizationId } = context.metadata;
    const aiSdkOverrides = (context.metadata as { aiSdkOverrides?: AiSdkOverrides }).aiSdkOverrides;
    const createMCPClientImpl = aiSdkOverrides?.createMCPClient ?? createMCPClient;
    const ToolLoopAgentImpl = aiSdkOverrides?.ToolLoopAgent ?? ToolLoopAgent;
    const stepCountIsImpl = aiSdkOverrides?.stepCountIs ?? stepCountIs;
    const createOpenAIImpl = aiSdkOverrides?.createOpenAI ?? createOpenAI;
    const createGoogleGenerativeAIImpl =
      aiSdkOverrides?.createGoogleGenerativeAI ?? createGoogleGenerativeAI;

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
          createClient: createMCPClientImpl,
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

<<<<<<< HEAD
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
=======
      const availableToolsCount = Object.keys(discoveredTools).length;
      const toolsConfig = availableToolsCount > 0 ? discoveredTools : undefined;

      const systemMessageEntry = historyWithUser.find((message) => message.role === 'system');
      const resolvedSystemPrompt = systemPrompt?.trim()?.length
>>>>>>> main
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
      const openAIProvider = createOpenAIImpl({
        ...openAIOptions,
        ...(isOpenRouter ? { name: 'openrouter' } : {}),
      });
      const model =
        effectiveProvider === 'gemini'
          ? createGoogleGenerativeAIImpl({
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
        stopWhen: stepCountIsImpl(stepLimit),
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

      const agent = new ToolLoopAgentImpl<never, AgentTools>(agentSettings);

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

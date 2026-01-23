import { randomUUID } from 'crypto';
import { z, ZodTypeAny } from 'zod';
import { DebugLogger } from '../../utils/debug-logger';
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
import { createMCPClient } from '@ai-sdk/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  componentRegistry,
  ComponentRetryPolicy,
  type ExecutionContext,
  type AgentTraceEvent,
  ConfigurationError,
  ValidationError,
  fromHttpResponse,
  defineComponent,
  inputs,
  outputs,
  parameters,
  port,
  param,
} from '@shipsec/component-sdk';
import {
  LLMProviderSchema,
  McpToolArgumentSchema,
  McpToolDefinitionSchema,
  llmProviderContractName,
  type McpToolDefinition,
} from '@shipsec/contracts';

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
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_MEMORY_SIZE = 8;
const DEFAULT_STEP_LIMIT = 4;

const DEFAULT_API_BASE_URL =
  process.env.STUDIO_API_BASE_URL ??
  process.env.SHIPSEC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  'http://localhost:3211';

const DEFAULT_GATEWAY_URL = `${DEFAULT_API_BASE_URL}/mcp/gateway`;

const agentMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.unknown(),
});

type AgentMessage = z.infer<typeof agentMessageSchema>;

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
  mcpTools: port(
    z
      .array(McpToolDefinitionSchema())
      .optional()
      .describe('Normalized MCP tool definitions emitted by provider components.'),
    {
      label: 'MCP Tools',
      description: 'Connect outputs from MCP tool providers or mergers.',
    },
  ),
  tools: port(
    z.array(z.string()).optional().describe('Direct tool connections from tool-mode nodes.'),
    {
      label: 'Connected Tools',
      description: 'Connect tool-mode nodes directly to this agent.',
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
  structuredOutputEnabled: param(
    z
      .boolean()
      .default(false)
      .describe('Enable structured JSON output that adheres to a defined schema.'),
    {
      label: 'Structured Output',
      editor: 'boolean',
      description: 'Enable to enforce a specific JSON output structure from the AI model.',
    },
  ),
  schemaType: param(
    z
      .enum(['json-example', 'json-schema'])
      .default('json-example')
      .describe('How to define the output schema: from a JSON example or a full JSON Schema.'),
    {
      label: 'Schema Type',
      editor: 'select',
      options: [
        { label: 'Generate From JSON Example', value: 'json-example' },
        { label: 'Define Using JSON Schema', value: 'json-schema' },
      ],
      description: 'Choose how to define the output structure.',
      visibleWhen: { structuredOutputEnabled: true },
    },
  ),
  jsonExample: param(
    z
      .string()
      .optional()
      .describe('Example JSON object to generate schema from. All properties become required.'),
    {
      label: 'JSON Example',
      editor: 'json',
      description:
        'Provide an example JSON object. Property types and names will be used to generate the schema. All fields are treated as required.',
      helpText: 'Example: { "name": "John", "age": 30, "skills": ["security", "architecture"] }',
      visibleWhen: { structuredOutputEnabled: true, schemaType: 'json-example' },
    },
  ),
  jsonSchema: param(
    z.string().optional().describe('Full JSON Schema definition for structured output validation.'),
    {
      label: 'JSON Schema',
      editor: 'json',
      description: 'Provide a full JSON Schema definition. Refer to json-schema.org for syntax.',
      helpText:
        'Example: { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] }',
      visibleWhen: { structuredOutputEnabled: true, schemaType: 'json-schema' },
    },
  ),
  autoFixFormat: param(
    z.boolean().default(false).describe('Attempt to fix malformed JSON responses from the model.'),
    {
      label: 'Auto-Fix Format',
      editor: 'boolean',
      description: 'Attempt to fix malformed JSON responses from the model.',
      helpText:
        'When enabled, tries to extract valid JSON from responses that contain extra text or formatting issues.',
      visibleWhen: { structuredOutputEnabled: true },
    },
  ),
});

type ConversationState = z.infer<typeof conversationStateSchema>;
type ToolInvocationEntry = z.infer<typeof toolInvocationSchema>;
type McpToolArgument = z.infer<typeof McpToolArgumentSchema>;
type ReasoningStep = z.infer<typeof reasoningStepSchema>;

const outputSchema = outputs({
  responseText: port(z.string(), {
    label: 'Agent Response',
    description: 'Final assistant message produced by the agent.',
  }),
  structuredOutput: port(z.unknown().nullable(), {
    label: 'Structured Output',
    description: 'Parsed JSON object when structured output is enabled. Null otherwise.',
    allowAny: true,
    reason: 'Structured output is user-defined JSON.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  conversationState: port(conversationStateSchema, {
    label: 'Conversation State',
    description: 'Updated conversation memory for subsequent agent turns.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  toolInvocations: port(z.array(toolInvocationSchema), {
    label: 'Tool Invocations',
    description: 'Array of MCP tool calls executed during this run.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  reasoningTrace: port(z.array(reasoningStepSchema), {
    label: 'Reasoning Trace',
    description: 'Sequence of Think → Act → Observe steps executed by the agent.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  usage: port(z.unknown().optional(), {
    label: 'Usage',
    description: 'Token usage metadata returned by the provider, if available.',
    allowAny: true,
    reason: 'Usage payloads vary by model provider.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  rawResponse: port(z.unknown(), {
    label: 'Raw Response',
    description: 'Raw provider response payload for debugging.',
    allowAny: true,
    reason: 'Provider responses vary by model provider.',
    connectionType: { kind: 'primitive', name: 'json' },
  }),
  agentRunId: port(z.string(), {
    label: 'Agent Run ID',
    description: 'Unique identifier for streaming and replaying this agent session.',
  }),
});

type AgentStreamPart =
  | {
    type: 'message-start';
    messageId: string;
    role: 'assistant' | 'user';
    metadata?: Record<string, unknown>;
  }
  | { type: 'text-delta'; textDelta: string }
  | {
    type: 'tool-input-available';
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }
  | { type: 'tool-output-available'; toolCallId: string; toolName: string; output: unknown }
  | { type: 'finish'; finishReason: string; responseText: string }
  | { type: `data-${string}`; data: unknown };

class AgentStreamRecorder {
  private sequence = 0;
  private activeTextId: string | null = null;

  constructor(
    private readonly context: ExecutionContext,
    private readonly agentRunId: string,
  ) { }

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
    const _textId = this.ensureTextStream();
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
  private readonly fetcher: ExecutionContext['http']['fetch'];

  constructor(options: {
    endpoint: string;
    sessionId: string;
    headers?: Record<string, string>;
    fetcher: ExecutionContext['http']['fetch'];
  }) {
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.sessionId = options.sessionId;
    this.headers = sanitizeHeaders(options.headers);
    this.fetcher = options.fetcher;
  }

  async execute(toolName: string, args: unknown): Promise<unknown> {
    const payload = {
      sessionId: this.sessionId,
      toolName,
      arguments: args ?? {},
    };

    const response = await this.fetcher(this.endpoint, {
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

type RegisteredToolMetadata = z.infer<typeof toolInvocationMetadataSchema>;

interface RegisteredMcpTool {
  name: string;
  tool: Tool<any, any>;
  metadata: RegisteredToolMetadata;
}

interface RegisterMcpToolParams {
  tools?: McpToolDefinition[];
  sessionId: string;
  toolFactory: ToolFn;
  agentStream: AgentStreamRecorder;
  fetcher: ExecutionContext['http']['fetch'];
  logger?: {
    warn?: (...args: unknown[]) => void;
  };
}

async function getGatewaySessionToken(
  runId: string,
  organizationId: string | null,
  connectedToolNodeIds?: string[],
): Promise<string> {
  const dbg = new DebugLogger('agent:gateway-token');
  dbg.info('START', { runId, organizationId, nodeIds: connectedToolNodeIds });

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN;

  if (!internalToken) {
    dbg.error('Missing INTERNAL_SERVICE_TOKEN');
    throw new ConfigurationError(
      'INTERNAL_SERVICE_TOKEN env var must be set for agent tool discovery',
      { configKey: 'INTERNAL_SERVICE_TOKEN' },
    );
  }

  const url = `${DEFAULT_API_BASE_URL}/internal/mcp/generate-token`;
  const body = { runId, organizationId, allowedNodeIds: connectedToolNodeIds };
  dbg.debug('Calling', { url, body });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': internalToken,
    },
    body: JSON.stringify(body),
  });

  dbg.debug('Response received', { status: response.status });

  if (!response.ok) {
    const errorText = await response.text();
    dbg.error('Failed to fetch token', { status: response.status, error: errorText });
    throw new Error(`Failed to generate gateway session token: ${errorText}`);
  }

  const result = (await response.json()) as { token: string };
  dbg.info('Token received', { tokenLength: result.token?.length || 0 });
  return result.token;
}

interface RegisterGatewayToolsParams {
  gatewayUrl: string;
  sessionToken: string;
}

async function registerGatewayTools({
  gatewayUrl,
  sessionToken,
}: RegisterGatewayToolsParams): Promise<{ tools: RegisteredMcpTool[]; close: () => Promise<void> }> {
  const dbg = new DebugLogger('agent:gateway-tools');
  dbg.info('START', { gatewayUrl, tokenLength: sessionToken?.length });

  try {
    dbg.debug('Creating MCP client...');
    const transport = new StreamableHTTPClientTransport(new URL(gatewayUrl), {
      requestInit: {
        headers: { Authorization: `Bearer ${sessionToken}` },
      },
    });
    const client = new Client({ name: 'shipsec-agent', version: '1.0.0' }, { capabilities: {} });
    await client.connect(transport);
    dbg.debug('MCP client connected');

    dbg.debug('Fetching tools from gateway...');
    const { tools } = await client.listTools();
    dbg.info('Tools discovered', { count: tools.length, names: tools.map(t => t.name) });

    const registered: RegisteredMcpTool[] = [];

    for (const tool of tools) {
      const toolName = tool.name;
      const toolDbg = new DebugLogger(`agent:tool:${toolName}`);
      toolDbg.debug(`Registering tool`);
      dbg.debug(`Registering tool`, { toolName });

      const registeredTool = toolImpl<Record<string, unknown>, string>({
        type: 'dynamic',
        description: tool.description ?? `Invoke ${tool.name}`,
        inputSchema: buildMcpToolSchema(tool.inputSchema),
        execute: async (args: Record<string, unknown>): Promise<string> => {
          const invocationId = `${tool.name}-${randomUUID()}`;
          const execDbg = new DebugLogger(`agent:tool-exec:${toolName}`);
          try {
            execDbg.debug('Calling tool', { args });
            const result = await client.callTool({ name: tool.name, arguments: args });
            execDbg.debug('Tool result received', { 
              resultType: typeof result.content, 
              isArray: Array.isArray(result.content), 
              contentLength: Array.isArray(result.content) ? result.content.length : 'N/A',
              content: result.content 
            });
            
            // MCP returns content as an array, extract text content and ensure it's a string
            let content: string;
            if (Array.isArray(result.content)) {
              content = result.content
                .map(c => {
                  if (typeof c === 'string') return c;
                  if (c && typeof c === 'object' && 'text' in c) return (c as any).text;
                  return JSON.stringify(c);
                })
                .join('\n');
            } else if (typeof result.content === 'string') {
              content = result.content;
            } else if (result.content && typeof result.content === 'object') {
              content = JSON.stringify(result.content);
            } else {
              content = String(result.content);
            }
            
            execDbg.debug('Tool execution result', { 
              contentType: typeof content, 
              contentLength: content.length,
              contentPreview: content.substring(0, 500)
            });
            return content;
          } catch (error) {
            execDbg.error('Tool execution failed', { 
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack?.substring(0, 1000) : undefined
            });
            throw error;
          }
        },
      });

      registered.push({
        name: toolName,
        tool: registeredTool,
        metadata: {
          toolId: tool.name,
          title: tool.name,
          description: tool.description,
          endpoint: gatewayUrl,
        },
      });
    }

    dbg.info('SUCCESS', { registeredCount: registered.length });
    return { 
      tools: registered, 
      close: async () => {
        await client.close();
      },
    };
  } catch (error) {
    dbg.error('ERROR', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function registerMcpTools({
  tools,
  sessionId,
  toolFactory,
  agentStream,
  fetcher,
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
      fetcher,
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

/**
 * Convert MCP JSON Schema to Zod schema for tool validation
 */
function buildMcpToolSchema(jsonSchema?: Record<string, any>): ZodTypeAny {
  // If no schema provided, accept any object
  if (!jsonSchema || typeof jsonSchema !== 'object') {
    return z.object({}).passthrough();
  }

  // If the schema is already a Zod schema or function, return it
  if (typeof jsonSchema === 'function' || jsonSchema instanceof z.ZodType) {
    return jsonSchema;
  }

  // Handle JSON Schema format from MCP
  if (jsonSchema.type === 'object' || !jsonSchema.type) {
    const properties = jsonSchema.properties as Record<string, any> || {};
    const required = Array.isArray(jsonSchema.required) ? new Set(jsonSchema.required) : new Set<string>();

    const shape = Object.entries(properties).reduce<Record<string, ZodTypeAny>>((acc, [key, prop]) => {
      let field: ZodTypeAny = z.any();

      if (prop && typeof prop === 'object') {
        // Convert JSON Schema type to Zod
        switch (prop.type) {
          case 'string':
            field = z.string();
            break;
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
            field = z.object({}).passthrough();
            break;
          default:
            field = z.any();
        }

        // Add description if available
        if (prop.description) {
          field = field.describe(prop.description);
        }
      }

      // Make optional if not in required list
      if (!required.has(key)) {
        field = field.optional();
      }

      acc[key] = field;
      return acc;
    }, {});

    return z.object(shape).passthrough();
  }

  // Fallback
  return z.object({}).passthrough();
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
    entity?.args !== undefined ? entity.args : (entity?.input ?? null);
  const getOutput = (entity: any) =>
    entity?.result !== undefined ? entity.result : (entity?.output ?? null);

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

function jsonExampleToJsonSchema(example: unknown): object {
  if (example === null) {
    return { type: 'null' };
  }

  if (Array.isArray(example)) {
    const items = example.length > 0 ? jsonExampleToJsonSchema(example[0]) : {};
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
  ui: {
    slug: 'ai-agent',
    version: '1.0.0',
    type: 'process',
    category: 'ai',
    description:
      'AI SDK agent with conversation memory, MCP tool calling, and reasoning trace output.',
    icon: 'Bot',
    author: {
      name: 'ShipSecAI',
      type: 'shipsecai',
    },
  },
  async execute(
    { inputs, params },
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
    },
  ) {
    const { userInput, conversationState, chatModel, mcpTools, modelApiKey, tools: _graphTools } = inputs;
    const {
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
    } = params;

    console.log(`[AIAgent::execute] ========== AGENT EXECUTION START ==========`);
    console.log(`[AIAgent::execute] runId=${context.runId}, componentRef=${context.componentRef}`);
    console.log(`[AIAgent::execute] metadata:`, JSON.stringify(context.metadata, null, 2));
    console.log(`[AIAgent::execute] inputs.userInput: "${inputs.userInput?.substring(0, 100)}..."`);
    console.log(`[AIAgent::execute] inputs.chatModel:`, JSON.stringify(inputs.chatModel));
    console.log(`[AIAgent::execute] inputs.mcpTools count: ${inputs.mcpTools?.length || 0}`);
    console.log(`[AIAgent::execute] inputs.tools (graph): ${JSON.stringify(inputs.tools)}`);

    const debugLog = (...args: unknown[]) => {
      const msg = `[AIAgent Debug] ${args.join(' ')}`;
      console.log(msg);
      context.logger.debug(msg);
    };
    const agentRunId = `${context.runId}:${context.componentRef}:${randomUUID()}`;
    console.log(`[AIAgent::execute] Generated agentRunId: ${agentRunId}`);

    const agentStream = new AgentStreamRecorder(context as ExecutionContext, agentRunId);

    const toolFn = dependencies?.tool ?? toolImpl;

    const connectedToolNodeIds = (context.metadata as any).connectedToolNodeIds as string[] | undefined;
    console.log(`[AIAgent::execute] connectedToolNodeIds from metadata: ${JSON.stringify(connectedToolNodeIds)}`);
    console.log(`[AIAgent::execute] Full metadata keys: ${Object.keys(context.metadata as any).join(', ')}`);

    let discoveredTools: RegisteredMcpTool[] = [];
    let closeDiscovery: (() => Promise<void>) | undefined;

    if (connectedToolNodeIds && connectedToolNodeIds.length > 0) {
      console.log(`[AIAgent::execute] Starting tool discovery for ${connectedToolNodeIds.length} connected node(s)...`);
      context.logger.info(`Discovering tools from gateway for nodes: ${connectedToolNodeIds.join(', ')}`);
      try {
        console.log(`[AIAgent::execute] Calling getGatewaySessionToken...`);
        const sessionToken = await getGatewaySessionToken(
          context.runId,
          (context.metadata as any).organizationId ?? null,
          connectedToolNodeIds,
        );
        console.log(`[AIAgent::execute] Got session token, now calling registerGatewayTools...`);
        const discoveryResult = await registerGatewayTools({
          gatewayUrl: DEFAULT_GATEWAY_URL,
          sessionToken,
        });
        discoveredTools = discoveryResult.tools;
        closeDiscovery = discoveryResult.close;
        console.log(`[AIAgent::execute] Tool discovery SUCCESS - found ${discoveredTools.length} tools`);
      } catch (error) {
        console.error(`[AIAgent::execute] Tool discovery FAILED:`, error);
        context.logger.error(`Failed to discover tools from gateway: ${error}`);
      }
    } else {
      console.log(`[AIAgent::execute] No connectedToolNodeIds - skipping gateway tool discovery`);
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
      if (modelApiKey && modelApiKey.trim().length > 0) {
        overrideApiKey = modelApiKey.trim();
      }

      const effectiveApiKey = resolveApiKey(effectiveProvider, overrideApiKey);
      debugLog('Resolved model configuration', {
        effectiveProvider,
        effectiveModel,
        hasExplicitApiKey: Boolean(chatModel?.apiKey) || Boolean(modelApiKey),
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
      const existingMessages = Array.isArray(incomingState?.messages) ? incomingState.messages : [];
      const existingToolHistory = Array.isArray(incomingState?.toolInvocations)
        ? incomingState.toolInvocations
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

      const toolMetadataByName = new Map<string, RegisteredToolMetadata>();
      const registeredTools: Record<string, Tool<any, any>> = {};

      for (const entry of discoveredTools) {
        registeredTools[entry.name] = entry.tool;
        toolMetadataByName.set(entry.name, entry.metadata);
      }

      const manualMcpTools = registerMcpTools({
        tools: mcpTools,
        sessionId,
        toolFactory: toolFn,
        agentStream,
        fetcher: context.http.fetch,
        logger: context.logger,
      });
      for (const entry of manualMcpTools) {
        let finalName = entry.name;
        if (registeredTools[finalName]) {
          finalName = `${finalName}_manual`;
        }
        registeredTools[finalName] = entry.tool;
        toolMetadataByName.set(finalName, entry.metadata);
      }

      const availableToolsCount = Object.keys(registeredTools).length;
      const toolsConfig = availableToolsCount > 0 ? registeredTools : undefined;
      debugLog('Tools configuration', {
        availableToolsCount,
        toolsConfigKeys: toolsConfig ? Object.keys(toolsConfig) : [],
      });

      const systemMessageEntry = historyWithUser.find((message) => message.role === 'system');
      const resolvedSystemPrompt = systemPrompt?.trim()?.length
        ? systemPrompt.trim()
        : systemMessageEntry && typeof systemMessageEntry.content === 'string'
          ? systemMessageEntry.content
          : systemMessageEntry && systemMessageEntry.content !== undefined
            ? JSON.stringify(systemMessageEntry.content)
            : '';
      debugLog('Resolved system prompt', resolvedSystemPrompt);

      const messagesForModel = historyWithUser
        .filter((message) => message.role !== 'system')
        .map((message) => {
          if (message.role === 'tool') {
            const content = message.content as any;
            return {
              role: 'tool' as const,
              content: [
                {
                  type: 'tool-result' as const,
                  toolCallId: content.toolCallId || 'unknown',
                  toolName: content.toolName || 'unknown',
                  result: content.result,
                },
              ],
            };
          }
          return {
            role: message.role as 'user' | 'assistant',
            content:
              typeof message.content === 'string'
                ? message.content
                : JSON.stringify(message.content),
          };
        });
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
          if (autoFixFormat) {
            context.logger.warn(
              '[AIAgent] Structured output failed, attempting auto-fix via text generation.',
            );

            const textResult = await generateText({
              model,
              system: resolvedSystemPrompt || undefined,
              messages: [
                ...messagesForModel,
                {
                  role: 'user' as const,
                  content: `Respond with valid JSON matching this schema: ${JSON.stringify(structuredSchema)}`,
                },
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
          onStepFinish: (stepResult: any) => {
            const mappedStep = mapStepToReasoning(stepResult, streamedStepCount, sessionId);
            streamedStepCount += 1;
            agentStream.emitReasoningStep(mappedStep);

            if (Array.isArray(stepResult.toolCalls)) {
              for (const call of stepResult.toolCalls) {
                agentStream.emitToolInput(call.toolCallId, call.toolName, call.args);
              }
            }
            if (Array.isArray(stepResult.toolResults)) {
              for (const result of stepResult.toolResults) {
                agentStream.emitToolOutput(result.toolCallId, result.toolName, result.result);
              }
            }
          },
        });

        console.log(`[AIAgent::execute] Using ${effectiveProvider} model "${effectiveModel}" with ${availableToolsCount} tool(s)`);
        console.log(`[AIAgent::execute] Tool names: ${Object.keys(registeredTools).join(', ') || 'none'}`);
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

        console.log(`[AIAgent::execute] Calling agent.generate() with ${messagesForModel.length} messages...`);
        try {
          generationResult = await agent.generate({
            messages: messagesForModel as any,
          });
          console.log(`[AIAgent::execute] agent.generate() returned successfully`);
          console.log(`[AIAgent::execute] Result finishReason: ${generationResult?.finishReason}`);
          console.log(`[AIAgent::execute] Result text length: ${generationResult?.text?.length || 0}`);
          console.log(`[AIAgent::execute] Result steps count: ${generationResult?.steps?.length || 0}`);
        } catch (genError) {
          console.error(`[AIAgent::execute] agent.generate() FAILED:`, genError);
          throw genError;
        }

        responseText =
          typeof generationResult.text === 'string'
            ? generationResult.text
            : String(generationResult.text ?? '');
        console.log(`[AIAgent::execute] Final responseText: "${responseText.substring(0, 200)}..."`);
      }

      const currentTimestamp = new Date().toISOString();
      const getToolArgs = (entity: any) =>
        entity?.args !== undefined ? entity.args : (entity?.input ?? null);
      const getToolOutput = (entity: any) =>
        entity?.result !== undefined ? entity.result : (entity?.output ?? null);

      const reasoningTrace: ReasoningStep[] = Array.isArray(generationResult.steps)
        ? generationResult.steps.map((step: any, index: number) =>
          mapStepToReasoning(step, index, sessionId),
        )
        : [];

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

      const assistantMessage: AgentMessage = {
        role: 'assistant',
        content: responseText,
      };

      let updatedMessages = trimConversation([...historyWithUser, ...toolMessages], memorySize);
      updatedMessages = trimConversation([...updatedMessages, assistantMessage], memorySize);

      const combinedToolHistory = [...existingToolHistory, ...toolLogEntries];

      const nextState: ConversationState = {
        sessionId,
        messages: updatedMessages,
        toolInvocations: combinedToolHistory,
      };

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
    } finally {
      if (closeDiscovery) {
        await closeDiscovery();
      }
    }
  },
});

componentRegistry.register(definition);

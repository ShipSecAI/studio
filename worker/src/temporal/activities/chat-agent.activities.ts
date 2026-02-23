import { Context } from '@temporalio/activity';
import { createOpenAI } from '@ai-sdk/openai';
import { createMCPClient } from '@ai-sdk/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { streamText, generateText, stepCountIs, convertToModelMessages, smoothStream } from 'ai';
import type { ToolExecutionOptions, UIMessage } from 'ai';
import type Redis from 'ioredis';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, asc } from 'drizzle-orm';

import * as schema from '../../adapters/schema';
import {
  withTaskAwareMcpTools,
  type TaskAwareMcpClient,
  type TaskToolEvent,
} from '../../utils/task-aware-mcp-tools';

// ---------------------------------------------------------------------------
// Types (shared with workflow)
// ---------------------------------------------------------------------------

interface ChatMessagePart {
  type: string;
  [key: string]: unknown;
}

interface ChatUIMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  parts: ChatMessagePart[];
}

interface ChatAgentStepInput {
  sessionId: string;
  runId: string;
  organizationId?: string;
  systemPrompt: string;
  messages: ChatUIMessage[];
  maxSteps: number;
}

interface ChatAgentStepOutput {
  assistantMessages: ChatUIMessage[];
}

interface SaveChatMessagesInput {
  sessionId: string;
  messages: ChatUIMessage[];
}

interface LoadChatMessagesInput {
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Global services (initialized by the worker)
// ---------------------------------------------------------------------------

let globalDb: NodePgDatabase<typeof schema> | undefined;
let globalRedis: Redis | undefined;
let globalBackendUrl: string | undefined;

export interface ChatAgentActivityServices {
  database: NodePgDatabase<typeof schema>;
  redis?: Redis;
  backendUrl: string;
}

export function initializeChatAgentActivities(services: ChatAgentActivityServices): void {
  globalDb = services.database;
  globalRedis = services.redis;
  globalBackendUrl = services.backendUrl;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getModel() {
  const baseURL = process.env.CHAT_AI_BASE_URL;
  const apiKey = process.env.CHAT_AI_API_KEY;
  const modelId = process.env.CHAT_AI_MODEL_ID;
  const providerName = process.env.CHAT_AI_PROVIDER ?? 'chat-provider';

  if (!baseURL || !apiKey || !modelId) {
    throw new Error(
      'Chat AI not configured. Set CHAT_AI_BASE_URL, CHAT_AI_API_KEY, and CHAT_AI_MODEL_ID.',
    );
  }

  const provider = createOpenAI({ baseURL, apiKey, name: providerName });
  return provider.chat(modelId);
}

/** Publish a streaming chunk to Redis pub/sub for real-time relay */
function publishStreamChunk(sessionId: string, chunk: string): void {
  if (globalRedis) {
    globalRedis.publish(`chat:stream:${sessionId}`, chunk).catch(() => {
      // Best-effort streaming - don't fail the activity if Redis publish fails
    });
  }
}

async function appendStreamEvent(
  sessionId: string,
  runId: string,
  event: Record<string, unknown>,
): Promise<number | null> {
  if (!globalBackendUrl) return null;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? 'local-internal-token';
  try {
    const res = await fetch(`${globalBackendUrl}/api/v1/chat/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': internalToken,
      },
      body: JSON.stringify({ runId, event }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { seq?: number };
    return typeof data.seq === 'number' ? data.seq : null;
  } catch {
    return null;
  }
}

async function emitStreamEvent(
  sessionId: string,
  runId: string,
  event: Record<string, unknown>,
): Promise<void> {
  const seq = await appendStreamEvent(sessionId, runId, event);
  publishStreamChunk(
    sessionId,
    JSON.stringify({
      ...event,
      runId,
      ...(typeof seq === 'number' ? { seq } : {}),
    }),
  );
}

/**
 * Flush the accumulated partial response parts to the backend so that
 * reconnecting clients (refresh / second tab / CLI) can read the progress.
 */
async function flushPartialResponse(sessionId: string, parts: unknown[]): Promise<void> {
  if (!globalBackendUrl) return;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? 'local-internal-token';
  try {
    await fetch(`${globalBackendUrl}/api/v1/chat/sessions/${sessionId}/partial`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': internalToken,
      },
      body: JSON.stringify({ parts }),
    });
  } catch {
    // Best-effort flush — don't fail the activity
  }
}

/** Notify the backend that streaming is complete so it clears partial and resets status. */
async function notifySessionComplete(sessionId: string, runId: string): Promise<void> {
  if (!globalBackendUrl) return;
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? 'local-internal-token';
  try {
    await fetch(`${globalBackendUrl}/api/v1/chat/sessions/${sessionId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': internalToken,
      },
      body: JSON.stringify({ runId }),
    });
  } catch {
    // Best-effort
  }
}

/** Create an MCP client connected to the backend's Studio MCP server */
async function createStudioMcpClient(organizationId?: string) {
  if (!globalBackendUrl) throw new Error('Backend URL not initialized for chat agent activities');

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? 'local-internal-token';
  const headers: Record<string, string> = {
    'x-internal-token': internalToken,
  };
  if (organizationId) {
    headers['x-organization-id'] = organizationId;
  }

  return createMCPClient({
    transport: {
      type: 'http',
      url: `${globalBackendUrl}/api/v1/studio-mcp`,
      headers,
    },
  });
}

/** Create a low-level MCP task client for task stream execution. */
async function createStudioTaskMcpClient(organizationId?: string): Promise<Client> {
  if (!globalBackendUrl) throw new Error('Backend URL not initialized for chat agent activities');

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? 'local-internal-token';
  const headers: Record<string, string> = {
    'x-internal-token': internalToken,
  };
  if (organizationId) {
    headers['x-organization-id'] = organizationId;
  }

  const transport = new StreamableHTTPClientTransport(
    new URL(`${globalBackendUrl}/api/v1/studio-mcp`),
    {
      requestInit: { headers },
    },
  );

  const client = new Client(
    { name: 'shipsec-chat-task-client', version: '1.0.0' },
    {
      capabilities: {
        tasks: {
          requests: {
            tasks: { get: {}, list: {}, result: {}, cancel: {} },
          },
        },
      },
    },
  );

  await client.connect(transport);
  // Prime tool metadata so callToolStream can auto-enable task mode for task-capable tools.
  await client.listTools();

  return client;
}

/**
 * Convert ChatUIMessage[] to AI SDK ModelMessage format using the SDK's own converter.
 * This properly handles dynamic-tool parts, creating both assistant tool-call
 * content and separate tool-role messages with tool results — so the LLM sees
 * the full tool call/result context in multi-turn conversations.
 */
async function toAISDKMessages(messages: ChatUIMessage[]) {
  return await convertToModelMessages(
    messages.map((m) => ({
      role: m.role,
      parts: m.parts,
    })) as any,
    { ignoreIncompleteToolCalls: true },
  );
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

/**
 * Run a single AI agent step: LLM call(s) + tool execution loop.
 * Connects to the backend's Studio MCP server for tool discovery and execution.
 * Streams events to Redis pub/sub for real-time frontend relay.
 */
export async function runChatAgentStepActivity(
  input: ChatAgentStepInput,
): Promise<ChatAgentStepOutput> {
  const { sessionId, runId, organizationId, systemPrompt, messages, maxSteps } = input;

  // Publish "processing" status
  await emitStreamEvent(sessionId, runId, { type: 'status', status: 'processing' });

  // Connect to the backend's MCP servers for tool discovery + execution
  const mcpClient = await createStudioMcpClient(organizationId);
  const taskClient = await createStudioTaskMcpClient(organizationId);

  try {
    const tools = await mcpClient.tools();
    const pendingTaskEvents = new Map<string, TaskToolEvent[]>();
    const startedToolCalls = new Set<string>();

    // Accumulate parts for periodic flush to Postgres
    const accumulatedParts: any[] = [];
    let lastFlushTime = Date.now();
    const FLUSH_INTERVAL_MS = 500;

    const publishTaskEvent = (event: TaskToolEvent) => {
      const output = {
        source: 'mcp-task' as const,
        eventType: event.type,
        taskId: event.taskId,
        status: event.status,
        statusMessage: event.statusMessage,
        pollInterval: event.pollInterval,
      };

      void emitStreamEvent(sessionId, runId, {
        type: 'tool-progress',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        output,
      });

      // Update the matching tool invocation part in accumulated history so DB has the newest state
      const toolPart = accumulatedParts.find(
        (p: any) => p.type === 'tool-invocation' && p.toolCallId === event.toolCallId,
      );
      if (toolPart) {
        toolPart.state = 'output-available';
        toolPart.output = output;
        toolPart.preliminary = true;
      }
    };

    const flushPendingTaskEvents = (toolCallId: string) => {
      const queuedEvents = pendingTaskEvents.get(toolCallId);
      if (!queuedEvents?.length) return;

      for (const event of queuedEvents) {
        publishTaskEvent(event);
      }
      pendingTaskEvents.delete(toolCallId);
    };

    const enqueueTaskEvent = (event: TaskToolEvent) => {
      if (startedToolCalls.has(event.toolCallId)) {
        publishTaskEvent(event);
        return;
      }

      const queue = pendingTaskEvents.get(event.toolCallId) ?? [];
      queue.push(event);
      pendingTaskEvents.set(event.toolCallId, queue);
    };

    const markToolCallStarted = (toolCallId: string | undefined) => {
      if (!toolCallId) return;
      startedToolCalls.add(toolCallId);
      flushPendingTaskEvents(toolCallId);
    };

    const taskAwareTools = withTaskAwareMcpTools({
      tools: tools as Record<string, any>,
      taskClient: taskClient as unknown as TaskAwareMcpClient,
      toolNames: ['run_workflow'],
      // Never auto-fallback for workflow runs; fallback can trigger duplicate executions.
      fallbackToOriginal: false,
      onTaskEvent: enqueueTaskEvent,
      onDebug: (message) => console.debug(`[chat-agent] ${message}`),
    });

    // Guard against duplicate run_workflow calls in a single assistant turn.
    // If the model re-issues the same workflow run request, reuse the first outcome
    // (including failures) instead of triggering another run.
    const runWorkflowTool = taskAwareTools.run_workflow;
    if (runWorkflowTool && typeof runWorkflowTool.execute === 'function') {
      const runWorkflowInflight = new Map<string, Promise<unknown>>();
      const runWorkflowCompleted = new Map<string, unknown>();
      const runWorkflowFailed = new Map<string, Error>();
      const baseExecute = runWorkflowTool.execute.bind(runWorkflowTool);

      taskAwareTools.run_workflow = {
        ...runWorkflowTool,
        execute: async (input: unknown, options: ToolExecutionOptions): Promise<unknown> => {
          const workflowId =
            typeof input === 'object' &&
            input !== null &&
            'workflowId' in (input as Record<string, unknown>) &&
            typeof (input as Record<string, unknown>).workflowId === 'string'
              ? ((input as Record<string, unknown>).workflowId as string)
              : undefined;
          const key = workflowId
            ? `workflow:${workflowId}`
            : `args:${JSON.stringify(input ?? null)}`;

          if (runWorkflowCompleted.has(key)) {
            return runWorkflowCompleted.get(key);
          }

          if (runWorkflowFailed.has(key)) {
            throw runWorkflowFailed.get(key)!;
          }

          const existing = runWorkflowInflight.get(key);
          if (existing) {
            return await existing;
          }

          const execution = Promise.resolve(baseExecute(input, options))
            .then((result) => {
              runWorkflowCompleted.set(key, result);
              return result;
            })
            .catch((error) => {
              const normalized =
                error instanceof Error ? error : new Error(`run_workflow failed: ${String(error)}`);
              runWorkflowFailed.set(key, normalized);
              throw normalized;
            })
            .finally(() => {
              runWorkflowInflight.delete(key);
            });

          runWorkflowInflight.set(key, execution);
          return await execution;
        },
      };
    }

    console.log(
      `[chat-agent] Discovered ${Object.keys(tools).length} MCP tools for session ${sessionId}`,
    );

    // Heartbeat before LLM call
    Context.current().heartbeat('llm-call-start');

    // Convert messages for AI SDK (preserves tool call/result context)
    const aiMessages = await toAISDKMessages(messages);

    try {
      // Run streamText with MCP tools — tool execution happens via MCP protocol
      const result = streamText({
        model: getModel(),
        system: systemPrompt,
        messages: aiMessages as any,
        tools: taskAwareTools as any,
        stopWhen: stepCountIs(maxSteps),
        experimental_transform: smoothStream(),
        onStepFinish: () => {
          Context.current().heartbeat('step-complete');
        },
      });

      // Use toUIMessageStream to get properly formatted UIMessage chunks
      // AND the final responseMessage via onFinish — no custom converter needed.
      let responseMessage: UIMessage | null = null;

      const uiStream = result.toUIMessageStream({
        onFinish: ({ responseMessage: msg }) => {
          responseMessage = msg;
        },
      });

      // Stream UIMessage chunks to Redis in real-time.
      // These chunks use the same format the frontend SSE expects.
      // We already have accumulatedParts from the top level.

      for await (const chunk of uiStream) {
        Context.current().heartbeat('stream-chunk');
        const c = chunk as any;

        if (c.type === 'text-delta') {
          await emitStreamEvent(sessionId, runId, { type: 'text-delta', text: c.delta });
          // Accumulate text delta into accumulated parts
          const lastPart = accumulatedParts[accumulatedParts.length - 1] as any;
          if (lastPart?.type === 'text') {
            lastPart.text += c.delta;
          } else {
            accumulatedParts.push({ type: 'text', text: c.delta });
          }
        } else if (c.type === 'tool-input-start') {
          markToolCallStarted(c.toolCallId);
          await emitStreamEvent(sessionId, runId, {
            type: 'tool-call',
            toolCallId: c.toolCallId,
            toolName: c.toolName,
          });
        } else if (c.type === 'tool-input-available') {
          markToolCallStarted(c.toolCallId);
          await emitStreamEvent(sessionId, runId, {
            type: 'tool-call',
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            args: c.input,
          });
          accumulatedParts.push({
            type: 'tool-invocation',
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            state: 'input-available',
            input: c.input,
          });
        } else if (c.type === 'tool-output-available') {
          await emitStreamEvent(sessionId, runId, {
            type: 'tool-result',
            toolCallId: c.toolCallId,
            result: c.output,
            preliminary: c.preliminary,
          });
          // Update the matching tool invocation part
          const toolPart = accumulatedParts.find(
            (p: any) => p.type === 'tool-invocation' && p.toolCallId === c.toolCallId,
          ) as any;
          if (toolPart) {
            toolPart.state = 'output-available';
            toolPart.output = c.output;
            toolPart.preliminary = c.preliminary === true;
          }
        } else if (c.type === 'tool-output-error') {
          await emitStreamEvent(sessionId, runId, {
            type: 'tool-error',
            toolCallId: c.toolCallId,
            errorText: c.errorText,
          });
          const toolPart = accumulatedParts.find(
            (p: any) => p.type === 'tool-invocation' && p.toolCallId === c.toolCallId,
          ) as any;
          if (toolPart) {
            toolPart.state = 'output-error';
            toolPart.errorText = c.errorText;
          }
        }

        // Periodic flush to Postgres
        const now = Date.now();
        if (now - lastFlushTime >= FLUSH_INTERVAL_MS && accumulatedParts.length > 0) {
          flushPartialResponse(sessionId, accumulatedParts).catch(() => {});
          lastFlushTime = now;
        }
      }

      // Final flush of accumulated parts
      if (accumulatedParts.length > 0) {
        await flushPartialResponse(sessionId, accumulatedParts);
      }

      // Publish completion and notify backend
      await emitStreamEvent(sessionId, runId, { type: 'status', status: 'idle' });
      await notifySessionComplete(sessionId, runId);

      // Use the SDK-provided responseMessage (properly formatted UIMessage with dynamic-tool parts)
      const assistantMessages: ChatUIMessage[] = [];
      if (responseMessage) {
        assistantMessages.push({
          role: (responseMessage as UIMessage).role,
          parts: (responseMessage as UIMessage).parts as ChatMessagePart[],
        });
      } else {
        // Fallback: if no responseMessage, try to get text
        const fullText = await result.text;
        if (fullText) {
          assistantMessages.push({
            role: 'assistant',
            parts: [{ type: 'text', text: fullText }],
          });
        }
      }

      return { assistantMessages };
    } catch (error: any) {
      // Handle NoOutputGeneratedError from AI SDK
      if (
        error?.name === 'AI_NoOutputGeneratedError' ||
        error?.constructor?.name === 'NoOutputGeneratedError'
      ) {
        console.error(
          `[chat-agent] LLM returned empty response for session ${sessionId}:`,
          error.message,
        );

        // Publish completion even on error and notify backend
        await emitStreamEvent(sessionId, runId, { type: 'status', status: 'idle' });
        await notifySessionComplete(sessionId, runId);

        // Return a friendly error message to the user
        return {
          assistantMessages: [
            {
              role: 'assistant' as const,
              parts: [
                {
                  type: 'text' as const,
                  text: '⚠️ I encountered an issue generating a response. The AI service returned an empty result. Please try rephrasing your question or try again.',
                },
              ],
            },
          ],
        };
      }

      // Re-throw other errors for Temporal to handle
      throw error;
    }
  } finally {
    await taskClient.close().catch(() => {
      // Best-effort cleanup
    });
    await mcpClient.close().catch(() => {
      // Best-effort cleanup
    });
  }
}

/**
 * Save chat messages to PostgreSQL.
 */
export async function saveChatMessagesActivity(input: SaveChatMessagesInput): Promise<void> {
  if (!globalDb) throw new Error('Database not initialized for chat agent activities');

  for (const msg of input.messages) {
    await globalDb.insert(schema.chatMessages).values({
      sessionId: input.sessionId,
      role: msg.role,
      parts: msg.parts as any,
    });
  }

  // Touch session updatedAt
  await globalDb
    .update(schema.chatSessions)
    .set({ updatedAt: new Date() })
    .where(eq(schema.chatSessions.id, input.sessionId));
}

/**
 * Load chat messages from PostgreSQL (used for continue-as-new).
 */
export async function loadChatMessagesActivity(
  input: LoadChatMessagesInput,
): Promise<ChatUIMessage[]> {
  if (!globalDb) throw new Error('Database not initialized for chat agent activities');

  const rows = await globalDb
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.sessionId, input.sessionId))
    .orderBy(asc(schema.chatMessages.createdAt));

  return rows.map((r) => ({
    id: r.id,
    role: r.role as 'user' | 'assistant' | 'system',
    parts: r.parts as ChatMessagePart[],
  }));
}

// ---------------------------------------------------------------------------
// Title Generation
// ---------------------------------------------------------------------------

interface GenerateSessionTitleInput {
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
}

/**
 * Generate a short conversation title using the LLM and update the session.
 * Also publishes a title-update event via Redis so the frontend updates in real-time.
 */
export async function generateSessionTitleActivity(
  input: GenerateSessionTitleInput,
): Promise<string> {
  if (!globalDb) throw new Error('Database not initialized for chat agent activities');

  const result = await generateText({
    model: getModel(),
    system:
      'Generate a very short title (3-6 words, no quotes) for this conversation based on the user message and assistant response. Just output the title, nothing else.',
    messages: [
      { role: 'user', content: input.userMessage },
      { role: 'assistant', content: input.assistantMessage },
      { role: 'user', content: 'Generate a short title for the conversation above.' },
    ],
  });

  const title = result.text
    .trim()
    .replace(/^["']|["']$/g, '')
    .slice(0, 100);

  // Update session title in DB
  await globalDb
    .update(schema.chatSessions)
    .set({ title })
    .where(eq(schema.chatSessions.id, input.sessionId));

  // Publish title update to Redis so frontend picks it up in real-time
  publishStreamChunk(input.sessionId, JSON.stringify({ type: 'title-update', title }));

  return title;
}

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
  generationId: number;
  organizationId?: string;
  systemPrompt: string;
  messages: ChatUIMessage[];
  maxSteps: number;
  compactionState?: {
    summary: string;
    compactedUpToIndex: number;
  };
}

interface ChatAgentStepOutput {
  assistantMessages: ChatUIMessage[];
  interrupted?: boolean;
  compactionState?: {
    summary: string;
    compactedUpToIndex: number;
  };
}

interface AppendResult {
  seq: number | null;
  staleMismatch: boolean;
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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

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
    globalRedis.publish(`chat:stream:${sessionId}`, chunk).catch((err) => {
      console.warn(`[chat-agent] Redis publish failed for session ${sessionId}:`, err.message);
    });
  }
}

async function appendStreamEvent(
  sessionId: string,
  runId: string,
  event: Record<string, unknown>,
): Promise<AppendResult> {
  if (!globalBackendUrl) return { seq: null, staleMismatch: false };
  const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? 'local-internal-token';
  try {
    const res = await fetch(`${globalBackendUrl}/api/v1/chat/sessions/${sessionId}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': internalToken,
      },
      body: JSON.stringify({ runId, event }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      if (res.status === 409) {
        return { seq: null, staleMismatch: true };
      }
      return { seq: null, staleMismatch: false };
    }
    const data = (await res.json()) as { seq?: number };
    const seq = typeof data.seq === 'number' ? data.seq : null;
    return { seq, staleMismatch: false };
  } catch {
    return { seq: null, staleMismatch: false };
  }
}

async function appendAndPublishStreamEvent(
  sessionId: string,
  runId: string,
  event: Record<string, unknown>,
): Promise<AppendResult> {
  const result = await appendStreamEvent(sessionId, runId, event);
  if (!result.staleMismatch) {
    publishStreamChunk(
      sessionId,
      JSON.stringify({
        ...event,
        runId,
        ...(typeof result.seq === 'number' ? { seq: result.seq } : {}),
      }),
    );
  }
  return result;
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
      signal: AbortSignal.timeout(5000),
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
      signal: AbortSignal.timeout(5000),
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
// Message compaction (token-aware)
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 characters per token for English text. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate the token footprint of a single ChatUIMessage. */
function estimateMessageTokens(msg: ChatUIMessage): number {
  let chars = msg.role.length + 4; // role + structural overhead
  for (const part of msg.parts) {
    if (part.type === 'text' && typeof part.text === 'string') {
      chars += part.text.length;
    } else if (part.type === 'tool-invocation') {
      // Count tool name + brief input/output representation
      chars += typeof part.toolName === 'string' ? part.toolName.length : 0;
      chars += part.input ? JSON.stringify(part.input).length : 0;
      chars += part.output ? JSON.stringify(part.output).length : 0;
    } else {
      // Fallback: serialize the part
      chars += JSON.stringify(part).length;
    }
  }
  return Math.ceil(chars / 4);
}

/** Serialize messages into a text representation for the compaction prompt. */
function serializeMessagesForCompaction(messages: ChatUIMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const role = msg.role.toUpperCase();
    for (const part of msg.parts) {
      if (part.type === 'text' && typeof part.text === 'string') {
        lines.push(`[${role}]: ${part.text}`);
      } else if (part.type === 'tool-invocation') {
        const name = typeof part.toolName === 'string' ? part.toolName : 'unknown-tool';
        const state = typeof part.state === 'string' ? part.state : 'unknown';
        let outputSummary = '';
        if (state === 'output-available' && part.output != null) {
          const raw = JSON.stringify(part.output);
          outputSummary = raw.length > 300 ? raw.slice(0, 300) + '…' : raw;
        } else if (state === 'output-error' && typeof part.errorText === 'string') {
          outputSummary = `ERROR: ${part.errorText}`;
        }
        lines.push(`[TOOL ${name}]: ${state}${outputSummary ? ' → ' + outputSummary : ''}`);
      }
      // Skip other part types (e.g. source, reasoning) — not critical for summary
    }
  }
  return lines.join('\n');
}

const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer. Given a conversation history, produce a concise summary that preserves:
- Key decisions made and their rationale
- Important facts, numbers, and configurations discussed
- Tool calls that were made and their outcomes (success/failure + key results)
- User preferences and constraints stated
- Any pending tasks or open questions

Format: Write a dense, factual summary in third person. Use bullet points for distinct topics. Do NOT include pleasantries or filler. Keep it under 500 words.`;

/**
 * Compact messages for LLM context using token-aware splitting.
 *
 * Strategy:
 * 1. If total tokens < 70% of context window → pass through unchanged
 * 2. Otherwise, keep as many recent messages as fit in ~50% of context,
 *    summarize everything before that into a single system message
 * 3. On compaction failure, fall back to keeping only the recent tail
 */
async function compactMessages(
  messages: ChatUIMessage[],
  systemPromptTokens: number,
  existingCompaction?: { summary: string; compactedUpToIndex: number },
): Promise<{
  messages: ChatUIMessage[];
  compactionState?: { summary: string; compactedUpToIndex: number };
}> {
  const contextWindow = parseInt(process.env.CHAT_AI_CONTEXT_WINDOW ?? '128000', 10);
  // Reserve space for: system prompt, tool schemas (~2k), and model response (~4k)
  const reservedTokens = systemPromptTokens + 6000;
  const availableTokens = contextWindow - reservedTokens;
  const compactionThreshold = Math.floor(availableTokens * 0.7);
  const recentBudget = Math.floor(availableTokens * 0.5);

  // Estimate total tokens (include existing summary if present instead of compacted messages)
  const messageSizes = messages.map((m) => estimateMessageTokens(m));
  let totalTokens: number;
  if (existingCompaction && existingCompaction.compactedUpToIndex > 0) {
    // Already-compacted messages are replaced by the summary in the LLM context
    const summaryTokens = estimateTokens(existingCompaction.summary);
    const unconsumedTokens = messageSizes
      .slice(existingCompaction.compactedUpToIndex)
      .reduce((sum, t) => sum + t, 0);
    totalTokens = summaryTokens + unconsumedTokens;
  } else {
    totalTokens = messageSizes.reduce((sum, t) => sum + t, 0);
  }

  if (totalTokens <= compactionThreshold) {
    // Under threshold — if we have existing compaction, prepend summary and pass state through
    if (existingCompaction) {
      const summaryMessage: ChatUIMessage = {
        role: 'system',
        parts: [
          {
            type: 'text',
            text: `[Conversation summary of earlier messages]\n\n${existingCompaction.summary}`,
          },
        ],
      };
      return {
        messages: [summaryMessage, ...messages.slice(existingCompaction.compactedUpToIndex)],
        compactionState: existingCompaction,
      };
    }
    return { messages };
  }

  console.log(
    `[chat-agent] Compacting messages: ${totalTokens} tokens > ${compactionThreshold} threshold (context window: ${contextWindow})`,
  );

  // Find the split point: walk backwards from the end until we fill the recent budget
  let recentTokens = 0;
  let splitIndex = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msgTokens = messageSizes[i];
    if (recentTokens + msgTokens > recentBudget) break;
    recentTokens += msgTokens;
    splitIndex = i;
  }

  // Ensure we keep at least the last message
  if (splitIndex >= messages.length) {
    splitIndex = messages.length - 1;
  }

  // Ensure split point is beyond what's already compacted
  if (existingCompaction && splitIndex < existingCompaction.compactedUpToIndex) {
    splitIndex = existingCompaction.compactedUpToIndex;
  }

  const recentMessages = messages.slice(splitIndex);

  if (splitIndex === 0) {
    // Nothing to compact — all messages fit in the recent budget
    return { messages };
  }

  try {
    let summary: string;

    if (existingCompaction && existingCompaction.compactedUpToIndex > 0) {
      // Incremental compaction: only summarize new messages between the old boundary and the new split
      const newMessagesToCompact = messages.slice(
        existingCompaction.compactedUpToIndex,
        splitIndex,
      );

      if (newMessagesToCompact.length === 0) {
        // Nothing new to compact — reuse existing summary
        const summaryMessage: ChatUIMessage = {
          role: 'system',
          parts: [
            {
              type: 'text',
              text: `[Conversation summary of earlier messages]\n\n${existingCompaction.summary}`,
            },
          ],
        };
        return {
          messages: [summaryMessage, ...recentMessages],
          compactionState: existingCompaction,
        };
      }

      const serialized = serializeMessagesForCompaction(newMessagesToCompact);
      const compactionResult = await generateText({
        model: getModel(),
        system: COMPACTION_SYSTEM_PROMPT,
        prompt: `Here is a previous summary of the conversation so far:\n${existingCompaction.summary}\n\nHere are additional messages to incorporate:\n${serialized}\n\nProduce an updated summary that merges the previous summary with the new messages.`,
        maxOutputTokens: 1024,
        abortSignal: AbortSignal.timeout(30000),
      });

      summary = compactionResult.text.trim();
      if (!summary) {
        console.warn(
          '[chat-agent] Incremental compaction returned empty summary, falling back to truncation',
        );
        return { messages: recentMessages, compactionState: existingCompaction };
      }

      console.log(
        `[chat-agent] Incrementally compacted ${newMessagesToCompact.length} new messages (indices ${existingCompaction.compactedUpToIndex}-${splitIndex}) into ~${estimateTokens(summary)} token summary, keeping ${recentMessages.length} recent messages`,
      );
    } else {
      // Fresh compaction: summarize all older messages (original behavior)
      const olderMessages = messages.slice(0, splitIndex);
      const serialized = serializeMessagesForCompaction(olderMessages);
      const compactionResult = await generateText({
        model: getModel(),
        system: COMPACTION_SYSTEM_PROMPT,
        prompt: serialized,
        maxOutputTokens: 1024,
        abortSignal: AbortSignal.timeout(30000),
      });

      summary = compactionResult.text.trim();
      if (!summary) {
        console.warn('[chat-agent] Compaction returned empty summary, falling back to truncation');
        return { messages: recentMessages };
      }

      console.log(
        `[chat-agent] Compacted ${olderMessages.length} messages into ~${estimateTokens(summary)} token summary, keeping ${recentMessages.length} recent messages`,
      );
    }

    const summaryMessage: ChatUIMessage = {
      role: 'system',
      parts: [
        {
          type: 'text',
          text: `[Conversation summary of earlier messages]\n\n${summary}`,
        },
      ],
    };

    return {
      messages: [summaryMessage, ...recentMessages],
      compactionState: { summary, compactedUpToIndex: splitIndex },
    };
  } catch (error) {
    console.error('[chat-agent] Compaction LLM call failed, falling back to truncation:', error);
    // Fallback: just use the recent messages without summary, preserve existing state if any
    return { messages: recentMessages, compactionState: existingCompaction };
  }
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
  const { sessionId, runId, generationId, organizationId, systemPrompt, messages, maxSteps } =
    input;
  const cancellationSignal = Context.current().cancellationSignal;

  // Per-invocation stale-run circuit breaker state
  let staleRun = false;
  let consecutiveAppendFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  // Local wrappers that check staleRun and track consecutive failures
  async function emitEvent(event: Record<string, unknown>): Promise<{ stale: boolean }> {
    if (staleRun) return { stale: true };
    const result = await appendStreamEvent(sessionId, runId, event);
    if (result.staleMismatch) {
      staleRun = true;
      consecutiveAppendFailures = 0;
      console.warn(
        `[chat-agent] Stale run detected (409) for session ${sessionId}, stopping emission`,
      );
      return { stale: true };
    }
    if (result.seq === null) {
      consecutiveAppendFailures++;
      if (consecutiveAppendFailures >= MAX_CONSECUTIVE_FAILURES) {
        staleRun = true;
        console.warn(
          `[chat-agent] ${MAX_CONSECUTIVE_FAILURES} consecutive append failures for session ${sessionId}, stopping emission`,
        );
        return { stale: true };
      }
    } else {
      consecutiveAppendFailures = 0;
    }
    publishStreamChunk(
      sessionId,
      JSON.stringify({
        ...event,
        runId,
        ...(typeof result.seq === 'number' ? { seq: result.seq } : {}),
      }),
    );
    return { stale: false };
  }

  Context.current().heartbeat('activity-start');
  const heartbeatTimer = setInterval(() => {
    try {
      Context.current().heartbeat('activity-alive');
    } catch {
      // Best-effort periodic heartbeat.
    }
  }, 10000);

  // Publish "processing" status
  await emitEvent({ type: 'status', status: 'processing' });

  // Connect to the backend's MCP servers for tool discovery + execution
  const mcpClient = await withTimeout(
    createStudioMcpClient(organizationId),
    15000,
    'MCP client connect',
  );
  let taskClient: Client | undefined;
  try {
    taskClient = await withTimeout(
      createStudioTaskMcpClient(organizationId),
      15000,
      'MCP task client connect',
    );
    const tools = await mcpClient.tools();
    const pendingTaskEvents = new Map<string, TaskToolEvent[]>();
    const startedToolCalls = new Set<string>();

    // Accumulate parts for periodic flush to Postgres
    const accumulatedParts: any[] = [];
    let lastFlushTime = Date.now();
    let lastFlushedLength = 0;
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

      void emitEvent({
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
      // Heartbeat on every task poll so Temporal knows we're alive during long-running tool calls
      Context.current().heartbeat(`task-poll:${event.taskId}:${event.status}`);

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
      // Block until the task completes and return the final CallToolResult to the model.
      // The client polls tasks/get in the background (spec-correct behavior).
      returnOnTaskCreated: false,
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

    // Token-aware compaction: summarize older messages when approaching context limits.
    // Full history stays in workflow state — compaction is read-only for the LLM call.
    const systemPromptTokens = estimateTokens(systemPrompt);
    const compactionResult = await compactMessages(
      messages,
      systemPromptTokens,
      input.compactionState,
    );
    const llmMessages = compactionResult.messages;

    // Convert messages for AI SDK (preserves tool call/result context)
    const aiMessages = await toAISDKMessages(llmMessages);

    try {
      // Run streamText with MCP tools — tool execution happens via MCP protocol
      const result = streamText({
        model: getModel(),
        system: systemPrompt,
        messages: aiMessages as any,
        tools: taskAwareTools as any,
        stopWhen: stepCountIs(maxSteps),
        experimental_transform: smoothStream(),
        abortSignal: cancellationSignal,
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
        // Check for cooperative cancellation at the top of each iteration
        if (cancellationSignal.aborted) break;

        Context.current().heartbeat('stream-chunk');
        const c = chunk as any;

        if (c.type === 'text-delta') {
          await emitEvent({ type: 'text-delta', text: c.delta });
          // Accumulate text delta into accumulated parts
          const lastPart = accumulatedParts[accumulatedParts.length - 1] as any;
          if (lastPart?.type === 'text') {
            lastPart.text += c.delta;
          } else {
            accumulatedParts.push({ type: 'text', text: c.delta });
          }
        } else if (c.type === 'tool-input-start') {
          markToolCallStarted(c.toolCallId);
          // Don't emit tool-call yet — wait for tool-input-available which has the args.
          // Emitting a tool-call without args here would cause the backend's
          // ensureToolInvocation to create the tool with empty input: {},
          // and then skip the second call that has the actual args.
        } else if (c.type === 'tool-input-available') {
          markToolCallStarted(c.toolCallId);
          await emitEvent({
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
          await emitEvent({
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
          await emitEvent({
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
        if (
          now - lastFlushTime >= FLUSH_INTERVAL_MS &&
          accumulatedParts.length > lastFlushedLength
        ) {
          flushPartialResponse(sessionId, accumulatedParts).catch(() => {});
          lastFlushTime = now;
          lastFlushedLength = accumulatedParts.length;
        }
      }

      // Check if we exited the loop due to cancellation
      if (cancellationSignal.aborted) {
        console.log(
          `[chat-agent] Generation interrupted by cancellation signal for session ${sessionId}`,
        );
        // Flush any accumulated partial state
        if (accumulatedParts.length > 0) {
          await flushPartialResponse(sessionId, accumulatedParts);
        }
        // Emit interrupted event so workflow can decide whether to continue
        // with queued turns or close out the run.
        await emitEvent({ type: 'generation-interrupted', generationId });

        // Build partial assistant message from accumulated parts
        const interruptedMessages: ChatUIMessage[] = [];
        if (accumulatedParts.length > 0) {
          interruptedMessages.push({ role: 'assistant', parts: accumulatedParts });
        }
        return {
          assistantMessages: interruptedMessages,
          interrupted: true,
          compactionState: compactionResult.compactionState,
        };
      }

      // Final flush of accumulated parts
      if (accumulatedParts.length > 0) {
        await flushPartialResponse(sessionId, accumulatedParts);
      }

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

      return { assistantMessages, compactionState: compactionResult.compactionState };
    } catch (error: any) {
      // Handle cooperative cancellation / abort errors
      if (cancellationSignal.aborted || error?.name === 'AbortError') {
        console.log(`[chat-agent] Generation interrupted (caught abort) for session ${sessionId}`);
        if (accumulatedParts.length > 0) {
          await flushPartialResponse(sessionId, accumulatedParts);
        }
        await emitEvent({ type: 'generation-interrupted', generationId });

        const interruptedMessages: ChatUIMessage[] = [];
        if (accumulatedParts.length > 0) {
          interruptedMessages.push({ role: 'assistant', parts: accumulatedParts });
        }
        return {
          assistantMessages: interruptedMessages,
          interrupted: true,
          compactionState: compactionResult.compactionState,
        };
      }

      // Handle NoOutputGeneratedError from AI SDK
      if (
        error?.name === 'AI_NoOutputGeneratedError' ||
        error?.constructor?.name === 'NoOutputGeneratedError'
      ) {
        console.error(
          `[chat-agent] LLM returned empty response for session ${sessionId}:`,
          error.message,
        );

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

      // Handle context length / bad request errors (non-retriable)
      if (error?.statusCode === 400 || error?.name === 'AI_InvalidToolArgumentsError') {
        console.error(
          `[chat-agent] Non-retriable LLM error for session ${sessionId}:`,
          error.message,
        );
        return {
          assistantMessages: [
            {
              role: 'assistant' as const,
              parts: [
                {
                  type: 'text' as const,
                  text: '⚠️ The AI encountered an error it cannot recover from. This may be due to the conversation being too long or an invalid tool response. Please try starting a new conversation or rephrasing your request.',
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
    clearInterval(heartbeatTimer);
    await taskClient?.close().catch(() => {
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

/**
 * Ensure chat run state is reset in backend even when higher-level workflow logic
 * catches errors before the main streaming activity can finalize normally.
 */
export async function markChatRunCompleteActivity(input: {
  sessionId: string;
  runId: string;
}): Promise<void> {
  await appendAndPublishStreamEvent(input.sessionId, input.runId, {
    type: 'status',
    status: 'idle',
  }).catch(() => {
    // Best-effort status signal; completion cleanup still proceeds.
  });
  await notifySessionComplete(input.sessionId, input.runId);
}

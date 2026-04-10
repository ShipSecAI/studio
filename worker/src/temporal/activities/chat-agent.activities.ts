import { Context } from '@temporalio/activity';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createMCPClient } from '@ai-sdk/mcp';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolLoopAgent, generateText, stepCountIs, convertToModelMessages, jsonSchema } from 'ai';
import type { ToolExecutionOptions, UIMessage, UIMessageChunk } from 'ai';
import type Redis from 'ioredis';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, asc } from 'drizzle-orm';

import {
  requireOrgVirtualKey,
  isBudgetExceededError,
  BUDGET_EXCEEDED_USER_MESSAGE,
} from '../../components/ai/utils';
import * as schema from '../../adapters/schema';
import {
  withTaskAwareMcpTools,
  type TaskAwareMcpClient,
  type TaskToolEvent,
} from '../../utils/task-aware-mcp-tools';
import { createInternalBackendClient } from '../../utils/internal-backend-client';

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
  turnId: string;
  runId: string;
  generationId: number;
  organizationId?: string;
  systemPrompt: string;
  messages: ChatUIMessage[];
  maxSteps: number;
  queuedAt?: string;
  compactionState?: {
    summary: string;
    compactedUpToIndex: number;
  };
  /** Hotplug session for org MCP server access (created by workflow) */
  hotplugSession?: HotplugSessionResult | null;
}

interface ChatAgentStepOutput {
  turnId: string;
  runId: string;
  generationId: number;
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

type TurnLifecycleStatus = 'queued' | 'running' | 'completed' | 'interrupted' | 'failed';

/**
 * Checkpoint data stored in Temporal heartbeat details for resumable agent.
 * On activity retry, this lets the agent resume from where it left off
 * instead of restarting fresh (avoiding Frankenstein messages).
 */
interface ActivityCheckpoint {
  /** Accumulated assistant parts. Omitted when recoveryMode is 'db-replay'. */
  accumulatedParts?: ChatMessagePart[];
  eventCounter: number;
  lastFlushedLength: number;
  completedToolCalls: string[];
  attempt: number;
  /** When checkpoint is too large (>1.5MB), parts are omitted and recovered from DB */
  recoveryMode?: 'db-replay';
}

interface TurnStatusPayload {
  turnId: string;
  status: TurnLifecycleStatus;
  reason?: string;
  queuedAt?: string;
  startedAt?: string;
  endedAt?: string;
}

interface ChatChunkEnvelope {
  turnId: string;
  runId: string;
  generationId: number;
  eventId: string;
  chunk: UIMessageChunk;
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

import type { KafkaChatStreamAdapter } from '../../adapters/kafka-chat-stream.adapter';

let globalDb: NodePgDatabase<typeof schema> | undefined;
let globalRedis: Redis | undefined;
let globalBackendUrl: string | undefined;
let globalChatStreamAdapter: KafkaChatStreamAdapter | undefined;

export interface ChatAgentActivityServices {
  database: NodePgDatabase<typeof schema>;
  redis?: Redis;
  backendUrl: string;
  chatStreamAdapter?: KafkaChatStreamAdapter;
}

export function initializeChatAgentActivities(services: ChatAgentActivityServices): void {
  globalDb = services.database;
  globalRedis = services.redis;
  globalBackendUrl = services.backendUrl;
  globalChatStreamAdapter = services.chatStreamAdapter;
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

function getAnthropicBaseUrl(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '');
  if (trimmed.endsWith('/anthropic/v1')) return trimmed;
  if (trimmed.endsWith('/v1')) {
    return `${trimmed.slice(0, -3)}/anthropic/v1`;
  }
  return `${trimmed}/anthropic/v1`;
}

function getModel(overrides?: { apiKey?: string; baseURL?: string }) {
  const baseURL = overrides?.baseURL ?? process.env.BIFROST_BASE_URL?.trim();
  const apiKey = overrides?.apiKey ?? process.env.BIFROST_API_KEY?.trim();
  const modelId = process.env.CHAT_AI_MODEL_ID;

  if (!baseURL || !apiKey || !modelId) {
    throw new Error(
      'Chat AI not configured. Set BIFROST_BASE_URL, BIFROST_API_KEY, and CHAT_AI_MODEL_ID.',
    );
  }

  if (modelId.startsWith('vertex/claude-')) {
    const provider = createAnthropic({
      baseURL: getAnthropicBaseUrl(baseURL),
      apiKey,
      name: 'bifrost-anthropic',
    });
    return provider.messages(modelId);
  }

  // Use OpenAI-compatible API for Bifrost providers that behave correctly on that surface.
  const provider = createOpenAI({ baseURL, apiKey, name: 'bifrost' });
  return provider.chat(modelId);
}

/**
 * Build a model instance with per-org virtual key via Bifrost.
 */
async function getModelForOrg(organizationId?: string) {
  try {
    const virtualKey = await requireOrgVirtualKey(organizationId, {
      backendUrl: globalBackendUrl,
      consumer: 'Chat AI',
    });
    return getModel({ apiKey: virtualKey });
  } catch (error) {
    const fallbackApiKey = process.env.BIFROST_API_KEY?.trim();
    if (organizationId === 'local-dev' && fallbackApiKey) {
      console.warn(
        '[chat-agent] Falling back to local Bifrost API key for local-dev chat because org virtual key resolution failed.',
        error,
      );
      return getModel({ apiKey: fallbackApiKey });
    }
    throw error;
  }
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
  envelope: ChatChunkEnvelope,
): Promise<AppendResult> {
  // Kafka path: broker-acked produce, backend consumer handles persistence + fan-out
  // Return seq: 0 (not null) because the durable per-session seq is assigned by backend ingestion.
  if (globalChatStreamAdapter) {
    try {
      await withTimeout(
        globalChatStreamAdapter.emit(sessionId, {
          turnId: envelope.turnId,
          runId: envelope.runId ?? '',
          generationId: String(envelope.generationId ?? ''),
          eventId: envelope.eventId,
          chunk: envelope.chunk,
        }),
        2000,
        'Kafka chat emit',
      );
      return { seq: 0, staleMismatch: false };
    } catch {
      return { seq: null, staleMismatch: false };
    }
  }

  // REST fallback
  if (!globalBackendUrl) return { seq: null, staleMismatch: false };
  const client = createInternalBackendClient({ baseUrl: globalBackendUrl });
  try {
    const res = await client.appendChatInternalEvent(sessionId, envelope);
    const data = (res.data ?? {}) as { seq?: number };
    const seq = typeof data.seq === 'number' ? data.seq : null;
    return { seq, staleMismatch: false };
  } catch {
    return { seq: null, staleMismatch: false };
  }
}

function createTurnStatusChunk(status: TurnStatusPayload): UIMessageChunk {
  return {
    type: 'data-turn-status',
    data: status,
  } as UIMessageChunk;
}

/** Notify the backend that run state can be finalized/reset as a safety fallback. */
async function notifySessionComplete(sessionId: string, runId: string): Promise<void> {
  if (!globalBackendUrl) return;
  const client = createInternalBackendClient({ baseUrl: globalBackendUrl });
  try {
    await client.completeChatRun(sessionId, { runId });
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Hotplug integration — attach org MCP servers to chat via Hotplug sessions
// ---------------------------------------------------------------------------

interface HotplugSessionResult {
  sessionId: string;
  mcpUrl: string;
  mcpToken: string;
}

/**
 * Fetch enabled MCP servers from backend and create a Hotplug session with
 * them as attachments. Returns the merged MCP endpoint + token, or null if
 * Hotplug is unavailable or no servers are configured.
 */
export async function createHotplugChatSessionActivity(input: {
  chatSessionId: string;
  organizationId?: string;
}): Promise<HotplugSessionResult | null> {
  const hotplugBaseUrl = process.env.HOTPLUG_BASE_URL?.trim();
  const hotplugToken = process.env.HOTPLUG_API_TOKEN?.trim();
  if (!hotplugBaseUrl) {
    console.log('[chat-agent] HOTPLUG_BASE_URL not set, skipping Hotplug integration');
    return null;
  }

  const backendUrl = globalBackendUrl;
  if (!backendUrl) return null;

  const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? 'local-internal-token';

  try {
    // Fetch enabled MCP servers from backend
    const headers: Record<string, string> = { 'x-internal-token': internalToken };
    if (input.organizationId) headers['x-organization-id'] = input.organizationId;

    const serversResp = await fetch(`${backendUrl}/api/v1/mcp-servers/enabled`, { headers });
    if (!serversResp.ok) {
      console.warn(`[chat-agent] Failed to fetch enabled MCP servers: ${serversResp.status}`);
      return null;
    }

    const servers = (await serversResp.json()) as {
      id: string;
      name: string;
      transportType: string;
      endpoint?: string | null;
      command?: string | null;
      args?: string[] | null;
      enabled: boolean;
    }[];

    // Filter to HTTP servers for now (stdio would need managed attachments)
    const httpServers = servers.filter((s) => s.transportType === 'http' && s.endpoint);

    if (httpServers.length === 0) {
      console.log('[chat-agent] No enabled HTTP MCP servers found for Hotplug session');
      return null;
    }

    // Build attachments map: alias -> AttachmentInput
    const attachments: Record<
      string,
      { remote_http: { url: string; headers?: Record<string, string> } }
    > = {};
    for (const server of httpServers) {
      // Resolve server config to get decrypted headers
      const resolveResp = await fetch(`${backendUrl}/api/v1/mcp-servers/${server.id}/resolve`, {
        headers,
      });

      let resolvedHeaders: Record<string, string> = {};
      if (resolveResp.ok) {
        const resolved = (await resolveResp.json()) as { headers?: Record<string, string> };
        resolvedHeaders = resolved.headers ?? {};
      }

      const alias = server.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      attachments[alias] = {
        remote_http: {
          url: server.endpoint!,
          ...(Object.keys(resolvedHeaders).length > 0 ? { headers: resolvedHeaders } : {}),
        },
      };
    }

    // Create Hotplug session with all attachments (one-call create + activate)
    const hotplugHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (hotplugToken) hotplugHeaders['Authorization'] = `Bearer ${hotplugToken}`;

    const createResp = await fetch(`${hotplugBaseUrl}/sessions`, {
      method: 'POST',
      headers: hotplugHeaders,
      body: JSON.stringify({
        identity: {
          tenant_id: input.organizationId ?? 'default',
          user_id: 'chat-agent',
          run_id: input.chatSessionId,
          labels: { source: 'chat', session: input.chatSessionId },
        },
        attachments,
        lifecycle: {
          idle_ttl_ms: 600_000, // 10 minutes idle
          max_duration_ms: 3_600_000, // 1 hour max
        },
      }),
    });

    if (!createResp.ok) {
      const body = await createResp.text();
      console.warn(`[chat-agent] Failed to create Hotplug session: ${createResp.status} ${body}`);
      return null;
    }

    const activation = (await createResp.json()) as {
      session_id: string;
      mcp_url: string;
      mcp_token: string;
    };

    console.log(
      `[chat-agent] Created Hotplug session ${activation.session_id} with ${Object.keys(attachments).length} servers for chat ${input.chatSessionId}`,
    );

    return {
      sessionId: activation.session_id,
      mcpUrl: activation.mcp_url,
      mcpToken: activation.mcp_token,
    };
  } catch (error) {
    console.warn(
      '[chat-agent] Hotplug session creation failed, continuing without org tools:',
      error,
    );
    return null;
  }
}

/**
 * Terminate a Hotplug session. Best-effort — failures are logged but not thrown.
 */
export async function terminateHotplugChatSessionActivity(input: {
  hotplugSessionId: string;
}): Promise<void> {
  const hotplugBaseUrl = process.env.HOTPLUG_BASE_URL?.trim();
  const hotplugToken = process.env.HOTPLUG_API_TOKEN?.trim();
  if (!hotplugBaseUrl) return;

  try {
    const headers: Record<string, string> = {};
    if (hotplugToken) headers['Authorization'] = `Bearer ${hotplugToken}`;

    const resp = await fetch(`${hotplugBaseUrl}/sessions/${input.hotplugSessionId}`, {
      method: 'DELETE',
      headers,
    });

    if (resp.ok) {
      console.log(`[chat-agent] Terminated Hotplug session ${input.hotplugSessionId}`);
    } else {
      console.warn(
        `[chat-agent] Failed to terminate Hotplug session ${input.hotplugSessionId}: ${resp.status}`,
      );
    }
  } catch (error) {
    console.warn(`[chat-agent] Hotplug termination failed for ${input.hotplugSessionId}:`, error);
  }
}

/**
 * Create an MCP client connected to a Hotplug session's merged endpoint.
 * Returns null if the session info is not available.
 */
async function createHotplugMcpClient(hotplug: HotplugSessionResult) {
  return createMCPClient({
    transport: {
      type: 'http',
      url: hotplug.mcpUrl,
      headers: {
        Authorization: `Bearer ${hotplug.mcpToken}`,
      },
    },
  });
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
// Stale tool output truncation (token savings)
// ---------------------------------------------------------------------------

/**
 * Truncate tool outputs on older assistant messages before sending to the LLM.
 * This is a read-only transform — DB and UI keep full outputs.
 *
 * Strategy: keep the last `recentAssistantCount` assistant messages with full
 * tool outputs. Everything older gets outputs truncated to a short summary.
 */
function truncateStaleToolOutputs(
  messages: ChatUIMessage[],
  recentAssistantCount = 4,
): ChatUIMessage[] {
  // Find indices of assistant messages (walking backwards)
  const assistantIndices: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      assistantIndices.push(i);
    }
  }

  // If we have fewer assistant messages than the threshold, nothing to truncate
  if (assistantIndices.length <= recentAssistantCount) {
    return messages;
  }

  // Indices of assistant messages that are "stale" (older than the recent window)
  const staleIndices = new Set(assistantIndices.slice(recentAssistantCount));

  return messages.map((msg, idx) => {
    if (!staleIndices.has(idx)) return msg;

    const truncatedParts = msg.parts.map((part) => {
      if (part.type !== 'tool-invocation' || part.output == null) return part;

      const raw = JSON.stringify(part.output);
      if (raw.length <= 500) return part;

      return {
        ...part,
        output: `[Tool output: ${raw.length} chars truncated. First 200: ${raw.slice(0, 200)}...]`,
      };
    });

    return { ...msg, parts: truncatedParts };
  });
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
  const {
    sessionId,
    turnId,
    runId,
    generationId,
    organizationId,
    systemPrompt,
    messages,
    maxSteps,
    queuedAt,
  } = input;
  const cancellationSignal = Context.current().cancellationSignal;
  const activityInfo = Context.current().info;

  // --- RESUME FROM CHECKPOINT ---
  const checkpoint = activityInfo.heartbeatDetails as ActivityCheckpoint | undefined;
  const isRetry = (activityInfo.attempt ?? 1) > 1 && checkpoint != null;

  // Per-invocation emission state — resume from checkpoint if retrying
  let emissionHalted = false;
  let consecutiveAppendFailures = 0;
  let eventCounter = checkpoint?.eventCounter ?? 0;
  const MAX_CONSECUTIVE_FAILURES = 3;
  const startedAt = new Date().toISOString();

  const nextEventId = () => `${generationId}:${turnId}:${++eventCounter}`;

  class EmissionHaltError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'EmissionHaltError';
    }
  }

  async function appendChunk(
    chunk: UIMessageChunk,
    options: { allowAfterHalt?: boolean; ignoreCircuitBreaker?: boolean } = {},
  ): Promise<void> {
    if (emissionHalted && !options.allowAfterHalt) {
      throw new EmissionHaltError('Emission halted');
    }

    const result = await appendStreamEvent(sessionId, {
      turnId,
      runId,
      generationId,
      eventId: nextEventId(),
      chunk,
    });

    if (result.staleMismatch) {
      emissionHalted = true;
      consecutiveAppendFailures = 0;
      console.warn(
        `[chat-agent] Run mismatch (409) for session ${sessionId}, run ${runId}, halting emission`,
      );
      throw new EmissionHaltError('Run mismatch (409)');
    }

    if (result.seq === null && !options.ignoreCircuitBreaker) {
      consecutiveAppendFailures++;
      if (consecutiveAppendFailures >= MAX_CONSECUTIVE_FAILURES) {
        emissionHalted = true;
        const endedAt = new Date().toISOString();
        console.warn(
          `[chat-agent] ${MAX_CONSECUTIVE_FAILURES} consecutive append failures for session ${sessionId}, halting emission`,
        );
        // Best-effort lifecycle failure marker on breaker open.
        await appendChunk(
          createTurnStatusChunk({
            turnId,
            status: 'failed',
            reason: 'append-circuit-breaker-open',
            queuedAt,
            startedAt,
            endedAt,
          }),
          { allowAfterHalt: true, ignoreCircuitBreaker: true },
        ).catch(() => {
          // Best-effort marker.
        });
        throw new EmissionHaltError('Append circuit breaker opened');
      }
    } else {
      consecutiveAppendFailures = 0;
    }
  }

  const emitTurnStatus = async (
    status: TurnLifecycleStatus,
    options: { reason?: string; endedAt?: string; allowAfterHalt?: boolean } = {},
  ) => {
    await appendChunk(
      createTurnStatusChunk({
        turnId,
        status,
        reason: options.reason,
        queuedAt,
        startedAt,
        endedAt: options.endedAt,
      }),
      { allowAfterHalt: options.allowAfterHalt },
    );
  };

  // Heartbeat checkpoint function — saves real state instead of useless strings
  const heartbeatCheckpoint = (parts: any[], completedTools: Set<string>, flushedLen: number) => {
    const cp: ActivityCheckpoint = {
      accumulatedParts: parts.slice(),
      eventCounter,
      lastFlushedLength: flushedLen,
      completedToolCalls: [...completedTools],
      attempt: activityInfo.attempt ?? 1,
    };

    // Guard against 2MB Temporal payload limit
    const size = JSON.stringify(cp).length;
    if (size > 1_500_000) {
      // Too large — heartbeat a lean version without parts (db-replay mode)
      Context.current().heartbeat({
        eventCounter,
        lastFlushedLength: flushedLen,
        completedToolCalls: [...completedTools],
        attempt: activityInfo.attempt ?? 1,
        recoveryMode: 'db-replay',
      } satisfies ActivityCheckpoint);
    } else {
      Context.current().heartbeat(cp);
    }
  };

  // Initial heartbeat — will be replaced with real checkpoints once streaming starts
  Context.current().heartbeat('activity-start');
  // Periodic checkpoint heartbeat (real data once accumulatedParts is available)
  let heartbeatAccumulatedParts: any[] = [];
  let heartbeatCompletedTools = new Set<string>();
  let heartbeatFlushedLen = 0;
  const heartbeatTimer = setInterval(() => {
    try {
      if (heartbeatAccumulatedParts.length > 0) {
        heartbeatCheckpoint(
          heartbeatAccumulatedParts,
          heartbeatCompletedTools,
          heartbeatFlushedLen,
        );
      } else {
        Context.current().heartbeat('activity-alive');
      }
    } catch {
      // Best-effort periodic heartbeat.
    }
  }, 1000);

  if (isRetry) {
    console.log(
      `[chat-agent] Resuming attempt ${activityInfo.attempt} for session ${sessionId}, ` +
        `turn ${turnId} with ${checkpoint.accumulatedParts?.length ?? 0} recovered parts, ` +
        `eventCounter=${eventCounter}`,
    );
    // Emit resumed running status so clients know agent recovered
    await emitTurnStatus('running', { reason: `resumed-attempt-${activityInfo.attempt}` });
  } else {
    // Lifecycle marker: turn entered running state.
    await emitTurnStatus('running');
  }

  // Connect to the backend's MCP servers for tool discovery + execution
  const mcpClient = await withTimeout(
    createStudioMcpClient(organizationId),
    15000,
    'MCP client connect',
  );

  // Connect to Hotplug merged endpoint for org MCP servers (if session exists)
  let hotplugMcpClient: Awaited<ReturnType<typeof createHotplugMcpClient>> | undefined;
  if (input.hotplugSession) {
    try {
      hotplugMcpClient = await withTimeout(
        createHotplugMcpClient(input.hotplugSession),
        15000,
        'Hotplug MCP client connect',
      );
      console.log(
        `[chat-agent] Connected to Hotplug session ${input.hotplugSession.sessionId} for org tools`,
      );
    } catch (err) {
      console.warn(
        '[chat-agent] Failed to connect to Hotplug MCP, continuing with Studio tools only:',
        err,
      );
    }
  }

  let taskClient: Client | undefined;
  try {
    taskClient = await withTimeout(
      createStudioTaskMcpClient(organizationId),
      15000,
      'MCP task client connect',
    );

    // Load tools from Studio MCP + Hotplug (org servers)
    const studioTools = await mcpClient.tools();
    const hotplugTools = hotplugMcpClient ? await hotplugMcpClient.tools() : {};
    const tools = { ...studioTools, ...hotplugTools };
    const pendingTaskEvents = new Map<string, TaskToolEvent[]>();
    const startedToolCalls = new Set<string>();
    const emittedTaskInvocationChunks = new Set<string>();

    // Accumulate parts for periodic flush to Postgres
    // On retry, restore from checkpoint to continue where we left off
    const accumulatedParts: any[] =
      isRetry && checkpoint?.accumulatedParts ? [...checkpoint.accumulatedParts] : [];
    let lastFlushTime = Date.now();
    let lastFlushedLength = checkpoint?.lastFlushedLength ?? 0;
    const completedToolCalls = new Set<string>(checkpoint?.completedToolCalls ?? []);
    const FLUSH_INTERVAL_MS = 500;

    // Wire heartbeat refs to live accumulation state for periodic checkpoint
    heartbeatAccumulatedParts = accumulatedParts;
    heartbeatCompletedTools = completedToolCalls;
    heartbeatFlushedLen = lastFlushedLength;

    const publishTaskEvent = (event: TaskToolEvent) => {
      const output = {
        source: 'mcp-task' as const,
        eventType: event.type,
        taskId: event.taskId,
        status: event.status,
        statusMessage: event.statusMessage,
        pollInterval: event.pollInterval,
      };

      void appendChunk({
        type: 'tool-output-available',
        toolCallId: event.toolCallId,
        output,
        preliminary: true,
        dynamic: true,
      } as UIMessageChunk).catch((error) => {
        if (!(error instanceof EmissionHaltError)) {
          console.warn('[chat-agent] Failed to append task progress chunk:', error);
        }
      });

      if (!emittedTaskInvocationChunks.has(event.toolCallId)) {
        emittedTaskInvocationChunks.add(event.toolCallId);
        void appendChunk({
          type: 'tool-input-start',
          toolCallId: event.toolCallId,
          toolName: event.toolName ?? 'unknown_tool',
          dynamic: true,
        } as UIMessageChunk).catch(() => {
          // Best-effort.
        });

        void appendChunk({
          type: 'tool-input-available',
          toolCallId: event.toolCallId,
          toolName: event.toolName ?? 'unknown_tool',
          input: {},
          dynamic: true,
        } as UIMessageChunk).catch(() => {
          // Best-effort.
        });
      }

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
      // Heartbeat on every task poll with real checkpoint data
      heartbeatCheckpoint(accumulatedParts, completedToolCalls, lastFlushedLength);

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

    // Register the update_task_plan local tool for structured task tracking.
    // This tool emits a task-plan-update chunk that the frontend renders as
    // a live-updating plan card in the chat UI.
    const taskPlanSchema = jsonSchema({
      type: 'object',
      properties: {
        planId: {
          type: 'string',
          description: 'Stable ID for this plan. Reuse to update an existing plan.',
        },
        title: { type: 'string', description: 'Short title for the plan.' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique task ID within this plan.' },
              label: { type: 'string', description: 'Short description of the task.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'done', 'failed', 'skipped'],
              },
              detail: { type: 'string', description: 'Optional extra context.' },
            },
            required: ['id', 'label', 'status'],
          },
        },
      },
      required: ['planId', 'title', 'tasks'],
    });
    taskAwareTools.update_task_plan = {
      type: 'dynamic' as const,
      description:
        'Create or update a visible task plan. Use this when performing multi-step work (3+ steps) to show the user your plan and progress. Update task statuses as you complete each step. Do not create a plan for simple single-step requests.',
      inputSchema: taskPlanSchema,
      parameters: taskPlanSchema,
      execute: async (input: unknown) => {
        const plan = input as {
          planId: string;
          title: string;
          tasks: { id: string; label: string; status: string; detail?: string }[];
        };

        // Emit the task-plan-update chunk through the same streaming pipeline
        await appendChunk({
          type: 'task-plan-update',
          planId: plan.planId,
          title: plan.title,
          tasks: plan.tasks,
        } as unknown as UIMessageChunk);

        // Upsert the task-plan part in accumulated parts for checkpoint persistence
        const existingIdx = accumulatedParts.findIndex(
          (p: any) => p.type === 'task-plan' && p.planId === plan.planId,
        );
        const planPart = {
          type: 'task-plan',
          planId: plan.planId,
          title: plan.title,
          tasks: plan.tasks,
        };
        if (existingIdx >= 0) {
          accumulatedParts[existingIdx] = planPart;
        } else {
          accumulatedParts.push(planPart);
        }

        const done = plan.tasks.filter((t) => t.status === 'done').length;
        return { success: true, planId: plan.planId, progress: `${done}/${plan.tasks.length}` };
      },
    };

    console.log(
      `[chat-agent] Discovered ${Object.keys(tools).length} MCP tools + update_task_plan for session ${sessionId}`,
    );
    console.log(
      `[chat-agent] Available tools: ${Object.keys(tools).sort().slice(0, 10).join(', ')}${Object.keys(tools).length > 10 ? '...' : ''}`,
    );

    // Heartbeat before LLM call — use checkpoint if we have accumulated state
    if (accumulatedParts.length > 0) {
      heartbeatCheckpoint(accumulatedParts, completedToolCalls, lastFlushedLength);
    } else {
      Context.current().heartbeat('llm-call-start');
    }

    // Token-aware compaction: summarize older messages when approaching context limits.
    // Full history stays in workflow state — compaction is read-only for the LLM call.
    const systemPromptTokens = estimateTokens(systemPrompt);
    const compactionResult = await compactMessages(
      messages,
      systemPromptTokens,
      input.compactionState,
    );
    const llmMessages = compactionResult.messages;

    // Truncate stale tool outputs to save tokens — only recent assistant messages
    // keep full tool outputs. DB and UI are unaffected (this is read-only).
    const llmMessagesWithTruncatedTools = truncateStaleToolOutputs(llmMessages);

    // On retry with checkpoint, append recovered partial to conversation history
    // so the model sees what it already said and can continue seamlessly
    let llmInputMessages = llmMessagesWithTruncatedTools;
    if (isRetry && accumulatedParts.length > 0) {
      llmInputMessages = [
        ...llmMessages,
        { role: 'assistant' as const, parts: accumulatedParts as ChatMessagePart[] },
        {
          role: 'user' as const,
          parts: [
            {
              type: 'text' as const,
              text:
                '[System: Your previous response was interrupted by a transient system failure. ' +
                'Continue exactly from where you left off. Do not repeat what you already said.]',
            },
          ],
        },
      ];
    }

    // Convert messages for AI SDK (preserves tool call/result context)
    const aiMessages = await toAISDKMessages(llmInputMessages);

    try {
      // Run ToolLoopAgent with MCP tools — combines streaming with automatic tool execution loop
      const orgModel = await getModelForOrg(organizationId);

      const agent = new ToolLoopAgent({
        id: `chat-agent-${sessionId}`,
        model: orgModel,
        // Split system prompt for provider-level prompt caching. The stable
        // prefix (behavioral instructions) is marked cacheable; the dynamic
        // suffix (session context, date) is appended without cache hints.
        instructions: systemPrompt,
        providerOptions: {
          anthropic: { cacheControl: { type: 'ephemeral' } },
        },
        tools: taskAwareTools as any,
        stopWhen: stepCountIs(maxSteps),
      });

      const result = await agent.stream({
        messages: aiMessages as any,
        abortSignal: cancellationSignal,
        onStepFinish: (event) => {
          heartbeatCheckpoint(accumulatedParts, completedToolCalls, lastFlushedLength);
          if (event.toolCalls?.length) {
            console.error(
              `[chat-agent] Step finished with ${event.toolCalls.length} tool call(s) for session ${sessionId}:`,
              event.toolCalls.map((tc: any) => `${tc.toolName}(${tc.toolCallId})`).join(', '),
              `| finishReason=${event.finishReason}`,
            );
          }
          if (event.toolResults?.length) {
            console.error(
              `[chat-agent] Step tool results for session ${sessionId}:`,
              event.toolResults
                .map((tr: any) => `${tr.toolName}(${tr.toolCallId}): ${tr.type}`)
                .join(', '),
            );
          }
        },
      });

      // Use toUIMessageStream to get properly formatted UIMessage chunks
      // AND the final responseMessage via onFinish — no custom converter needed.
      let responseMessage: UIMessage | null = null;
      let sawFinishChunk = false;
      let chunkCount = 0;

      console.error(
        `[chat-agent] Starting stream loop for session ${sessionId}, generation ${generationId}, maxSteps=${maxSteps}`,
      );

      const uiStream = result.toUIMessageStream({
        onFinish: ({ responseMessage: msg }) => {
          console.error(
            `[chat-agent] Stream onFinish for session ${sessionId}, responseMessage keys=${msg ? Object.keys(msg).join(',') : 'null'}`,
          );
          if (msg?.parts) {
            console.error(
              `[chat-agent] ResponseMessage parts count=${msg.parts.length}, firstFew=${JSON.stringify(msg.parts.slice(0, 3)).substring(0, 200)}`,
            );
          }
          responseMessage = msg;
        },
      });

      // Stream UIMessage chunks to Redis in real-time.
      // These chunks use the same format the frontend SSE expects.
      // We already have accumulatedParts from the top level.

      for await (const chunk of uiStream) {
        // Check for cooperative cancellation at the top of each iteration
        if (cancellationSignal.aborted) break;

        chunkCount++;
        const c = chunk as any;

        // Log important chunk types for debugging
        if (c.type === 'tool-input-start') {
          console.error(
            `[chat-agent] Tool input start: ${c.toolName}(${c.toolCallId}) for session ${sessionId}`,
          );
        } else if (c.type === 'finish-step') {
          console.error(
            `[chat-agent] Finish step: finishReason=${c.finishReason}, chunks=${chunkCount} for session ${sessionId}`,
          );
        } else if (c.type === 'finish') {
          console.error(
            `[chat-agent] Stream finish: finishReason=${c.finishReason}, totalChunks=${chunkCount} for session ${sessionId}`,
          );
        }

        // Real checkpoint heartbeat instead of useless string
        heartbeatFlushedLen = lastFlushedLength;
        heartbeatCheckpoint(accumulatedParts, completedToolCalls, lastFlushedLength);

        if (c.type === 'finish') {
          sawFinishChunk = true;
        }
        await appendChunk(chunk as UIMessageChunk);

        if (c.type === 'text-delta') {
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
        } else if (c.type === 'tool-input-available') {
          markToolCallStarted(c.toolCallId);
          accumulatedParts.push({
            type: 'tool-invocation',
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            state: 'input-available',
            input: c.input,
          });
        } else if (c.type === 'tool-output-available') {
          // Update the matching tool invocation part
          const toolPart = accumulatedParts.find(
            (p: any) => p.type === 'tool-invocation' && p.toolCallId === c.toolCallId,
          ) as any;
          if (toolPart) {
            toolPart.state = 'output-available';
            toolPart.output = c.output;
            toolPart.preliminary = c.preliminary === true;
          }
          if (c.toolCallId && !c.preliminary) {
            completedToolCalls.add(c.toolCallId);
          }
        } else if (c.type === 'tool-output-error') {
          const toolPart = accumulatedParts.find(
            (p: any) => p.type === 'tool-invocation' && p.toolCallId === c.toolCallId,
          ) as any;
          if (toolPart) {
            toolPart.state = 'output-error';
            toolPart.errorText = c.errorText;
          }
        }

        // Periodic heartbeat checkpoint while streaming.
        const now = Date.now();
        if (now - lastFlushTime >= FLUSH_INTERVAL_MS) {
          lastFlushTime = now;
          lastFlushedLength = accumulatedParts.length;
        }
      }

      // Check if we exited the loop due to cancellation
      if (cancellationSignal.aborted) {
        console.log(
          `[chat-agent] Generation interrupted by cancellation signal for session ${sessionId}`,
        );
        await emitTurnStatus('interrupted', {
          reason: 'cancellation-signal',
          endedAt: new Date().toISOString(),
        });

        // Build partial assistant message from accumulated parts and persist directly.
        // The workflow's CancellationScope discards the activity return value, so we
        // must save here to avoid losing streamed output on refresh.
        const interruptedMessages: ChatUIMessage[] = [];
        if (accumulatedParts.length > 0) {
          interruptedMessages.push({ role: 'assistant', parts: accumulatedParts });
        }
        if (interruptedMessages.length > 0) {
          try {
            await saveChatMessagesActivity({ sessionId, messages: interruptedMessages });
          } catch (saveErr) {
            console.warn(
              `[chat-agent] Failed to persist interrupted messages for session ${sessionId}:`,
              saveErr,
            );
          }
        }
        return {
          turnId,
          runId,
          generationId,
          assistantMessages: interruptedMessages,
          interrupted: true,
          compactionState: compactionResult.compactionState,
        };
      }

      // Emit error for any tool calls that started but never got a result.
      // This happens when the MCP transport fails (e.g. session destroyed) and
      // streamText silently ends the stream without emitting tool-output-error.
      for (const toolCallId of startedToolCalls) {
        if (!completedToolCalls.has(toolCallId)) {
          console.warn(
            `[chat-agent] Tool call ${toolCallId} started but never completed for session ${sessionId} — emitting error`,
          );
          const errorChunk = {
            type: 'tool-output-error',
            toolCallId,
            errorText:
              'Tool execution failed — the connection was lost before a result was received.',
          };
          await appendChunk(errorChunk as UIMessageChunk);
          // Update accumulated parts so persisted messages reflect the error
          const toolPart = accumulatedParts.find(
            (p: any) => p.type === 'tool-invocation' && p.toolCallId === toolCallId,
          ) as any;
          if (toolPart) {
            toolPart.state = 'output-error';
            toolPart.errorText = errorChunk.errorText;
          }
        }
      }

      if (!sawFinishChunk) {
        await appendChunk({ type: 'finish' } as UIMessageChunk);
      }
      await emitTurnStatus('completed', { endedAt: new Date().toISOString() });

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

      return {
        turnId,
        runId,
        generationId,
        assistantMessages,
        compactionState: compactionResult.compactionState,
      };
    } catch (error: any) {
      if (error instanceof EmissionHaltError) {
        const interruptedMessages: ChatUIMessage[] = [];
        if (accumulatedParts.length > 0) {
          interruptedMessages.push({ role: 'assistant', parts: accumulatedParts });
        }
        if (interruptedMessages.length > 0) {
          try {
            await saveChatMessagesActivity({ sessionId, messages: interruptedMessages });
          } catch (saveErr) {
            console.warn(
              `[chat-agent] Failed to persist halted messages for session ${sessionId}:`,
              saveErr,
            );
          }
        }
        return {
          turnId,
          runId,
          generationId,
          assistantMessages: interruptedMessages,
          interrupted: true,
          compactionState: compactionResult.compactionState,
        };
      }

      if (isBudgetExceededError(error)) {
        console.warn(`[chat-agent] Budget exceeded for session ${sessionId}:`, error.message);

        await emitTurnStatus('failed', {
          reason: 'budget-exceeded',
          endedAt: new Date().toISOString(),
        }).catch(() => {
          // Best-effort lifecycle marker.
        });
        await appendChunk(
          createTurnStatusChunk({
            turnId,
            status: 'failed',
            reason: 'budget-exceeded',
            queuedAt,
            startedAt,
            endedAt: new Date().toISOString(),
          }),
          { allowAfterHalt: true },
        ).catch(() => {
          // Best-effort stream update for clients before completion reset.
        });
        await notifySessionComplete(sessionId, runId);

        return {
          turnId,
          runId,
          generationId,
          assistantMessages: [
            {
              role: 'assistant',
              parts: [
                {
                  type: 'text',
                  text: BUDGET_EXCEEDED_USER_MESSAGE,
                },
              ],
            },
          ],
          compactionState: compactionResult.compactionState,
        };
      }

      // Handle cooperative cancellation / abort errors
      if (cancellationSignal.aborted || error?.name === 'AbortError') {
        console.log(`[chat-agent] Generation interrupted (caught abort) for session ${sessionId}`);
        await emitTurnStatus('interrupted', {
          reason: 'abort-error',
          endedAt: new Date().toISOString(),
        }).catch(() => {
          // Best-effort lifecycle marker.
        });

        const interruptedMessages: ChatUIMessage[] = [];
        if (accumulatedParts.length > 0) {
          interruptedMessages.push({ role: 'assistant', parts: accumulatedParts });
        }
        if (interruptedMessages.length > 0) {
          try {
            await saveChatMessagesActivity({ sessionId, messages: interruptedMessages });
          } catch (saveErr) {
            console.warn(
              `[chat-agent] Failed to persist aborted messages for session ${sessionId}:`,
              saveErr,
            );
          }
        }
        return {
          turnId,
          runId,
          generationId,
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
          turnId,
          runId,
          generationId,
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
          turnId,
          runId,
          generationId,
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
      await emitTurnStatus('failed', {
        reason: error instanceof Error ? error.message : String(error),
        endedAt: new Date().toISOString(),
      }).catch(() => {
        // Best-effort lifecycle marker.
      });
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
    await hotplugMcpClient?.close().catch(() => {
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
  organizationId?: string;
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

  const titleModel = await getModelForOrg(input.organizationId);

  const result = await generateText({
    model: titleModel,
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
  // Run completion bookkeeping is best-effort and decoupled from turn chunk emission.
  await notifySessionComplete(input.sessionId, input.runId);
}

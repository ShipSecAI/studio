import { Context } from '@temporalio/activity';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import type Redis from 'ioredis';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, asc } from 'drizzle-orm';

import * as schema from '../../adapters/schema';

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
// Tool definitions fetched from the backend API
// ---------------------------------------------------------------------------

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
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

/** Fetch Studio tool definitions from the backend API */
async function fetchToolDefinitions(organizationId?: string): Promise<ToolDefinition[]> {
  if (!globalBackendUrl) return [];

  try {
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? 'local-internal-token';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-internal-token': internalToken,
    };
    if (organizationId) {
      headers['x-organization-id'] = organizationId;
    }

    const res = await fetch(`${globalBackendUrl}/api/v1/chat/tools`, { headers });
    if (!res.ok) return [];
    return (await res.json()) as ToolDefinition[];
  } catch {
    return [];
  }
}

/** Convert AI SDK response messages to our ChatUIMessage format */
function convertToUIMessages(messages: { role: string; content: unknown }[]): ChatUIMessage[] {
  return messages
    .filter((m) => m.role === 'assistant')
    .map((m) => {
      const parts: ChatMessagePart[] = [];
      if (typeof m.content === 'string') {
        parts.push({ type: 'text', text: m.content });
      } else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === 'text') {
            parts.push({ type: 'text', text: part.text });
          } else if (part.type === 'tool-call') {
            parts.push({
              type: 'tool-invocation',
              toolInvocation: {
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                args: part.args,
                state: 'result',
              },
            });
          }
        }
      }
      return { role: 'assistant' as const, parts };
    });
}

/** Convert ChatUIMessage[] to AI SDK CoreMessage format */
function toAISDKMessages(messages: ChatUIMessage[]): { role: string; content: string }[] {
  return messages.map((m) => {
    const textParts = m.parts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text);
    return {
      role: m.role,
      content: textParts.join('\n') || '',
    };
  });
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

/**
 * Run a single AI agent step: LLM call(s) + tool execution loop.
 * Streams events to Redis pub/sub for real-time frontend relay.
 */
export async function runChatAgentStepActivity(
  input: ChatAgentStepInput,
): Promise<ChatAgentStepOutput> {
  const { sessionId, organizationId, systemPrompt, messages, maxSteps } = input;

  // Publish "processing" status
  publishStreamChunk(sessionId, JSON.stringify({ type: 'status', status: 'processing' }));

  // Build tools from backend API
  const toolDefs = await fetchToolDefinitions(organizationId);
  const tools: Record<string, any> = {};

  for (const def of toolDefs) {
    // Build a Zod schema from the tool definition
    const schemaEntries: Record<string, z.ZodTypeAny> = {};
    if (def.inputSchema && typeof def.inputSchema === 'object') {
      for (const [key, value] of Object.entries(def.inputSchema)) {
        const v = value as { type?: string; description?: string };
        let zodType: z.ZodTypeAny = z.unknown();
        if (v.type === 'string') zodType = z.string();
        if (v.description) zodType = zodType.describe(v.description);
        schemaEntries[key] = zodType.optional();
      }
    }

    tools[def.name] = {
      description: def.description,
      parameters: z.object(schemaEntries),
      execute: async (args: Record<string, unknown>) => {
        // Heartbeat to keep the activity alive during tool execution
        Context.current().heartbeat(`tool:${def.name}`);

        // Publish tool invocation event
        publishStreamChunk(
          sessionId,
          JSON.stringify({ type: 'tool-call', toolName: def.name, args }),
        );

        // Execute tool via backend API
        try {
          const internalToken = process.env.INTERNAL_SERVICE_TOKEN ?? 'local-internal-token';
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'x-internal-token': internalToken,
          };
          if (organizationId) {
            headers['x-organization-id'] = organizationId;
          }

          const res = await fetch(`${globalBackendUrl}/api/v1/chat/tools/${def.name}/execute`, {
            method: 'POST',
            headers,
            body: JSON.stringify(args),
          });

          if (!res.ok) {
            const errText = await res.text();
            return { error: `Tool execution failed: ${errText}` };
          }

          const result = await res.json();

          // Publish tool result
          publishStreamChunk(
            sessionId,
            JSON.stringify({ type: 'tool-result', toolName: def.name, result }),
          );

          return result;
        } catch (error) {
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
    };
  }

  // Heartbeat before LLM call
  Context.current().heartbeat('llm-call-start');

  // Convert messages for AI SDK
  const aiMessages = toAISDKMessages(messages);

  // Run generateText with tool loop (AI SDK v6 uses stopWhen + stepCountIs)
  const result = await generateText({
    model: getModel(),
    system: systemPrompt,
    messages: aiMessages as any,
    tools,
    stopWhen: stepCountIs(maxSteps),
    onStepFinish: ({ text }) => {
      // Heartbeat on each step
      Context.current().heartbeat('step-complete');

      // Stream text chunks
      if (text) {
        publishStreamChunk(sessionId, JSON.stringify({ type: 'text-delta', text }));
      }
    },
  });

  // Publish completion
  publishStreamChunk(sessionId, JSON.stringify({ type: 'status', status: 'idle' }));

  // Convert result to UIMessages
  const assistantMessages = convertToUIMessages(result.response.messages as any);

  // If no structured messages but we have text, create a simple message
  if (assistantMessages.length === 0 && result.text) {
    assistantMessages.push({
      role: 'assistant',
      parts: [{ type: 'text', text: result.text }],
    });
  }

  return { assistantMessages };
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

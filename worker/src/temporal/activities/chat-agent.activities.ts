import { Context } from '@temporalio/activity';
import { createOpenAI } from '@ai-sdk/openai';
import { createMCPClient } from '@ai-sdk/mcp';
import { streamText, generateText, stepCountIs, convertToModelMessages, smoothStream } from 'ai';
import type { UIMessage } from 'ai';
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
  const { sessionId, organizationId, systemPrompt, messages, maxSteps } = input;

  // Publish "processing" status
  publishStreamChunk(sessionId, JSON.stringify({ type: 'status', status: 'processing' }));

  // Connect to the backend's MCP server for tool discovery + execution
  const mcpClient = await createStudioMcpClient(organizationId);

  try {
    const tools = await mcpClient.tools();
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
        tools: tools as any,
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
      for await (const chunk of uiStream) {
        Context.current().heartbeat('stream-chunk');
        const c = chunk as any;

        if (c.type === 'text-delta') {
          publishStreamChunk(sessionId, JSON.stringify({ type: 'text-delta', text: c.delta }));
        } else if (c.type === 'tool-input-start') {
          publishStreamChunk(
            sessionId,
            JSON.stringify({
              type: 'tool-call',
              toolCallId: c.toolCallId,
              toolName: c.toolName,
            }),
          );
        } else if (c.type === 'tool-input-available') {
          publishStreamChunk(
            sessionId,
            JSON.stringify({
              type: 'tool-call',
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              args: c.input,
            }),
          );
        } else if (c.type === 'tool-output-available') {
          publishStreamChunk(
            sessionId,
            JSON.stringify({
              type: 'tool-result',
              toolCallId: c.toolCallId,
              result: c.output,
            }),
          );
        }
      }

      // Publish completion
      publishStreamChunk(sessionId, JSON.stringify({ type: 'status', status: 'idle' }));

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

        // Publish completion even on error
        publishStreamChunk(sessionId, JSON.stringify({ type: 'status', status: 'idle' }));

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

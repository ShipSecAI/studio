import {
  condition,
  defineSignal,
  defineQuery,
  setHandler,
  proxyActivities,
  workflowInfo,
  continueAsNew,
} from '@temporalio/workflow';

// ---------------------------------------------------------------------------
// Types (inlined to avoid webpack bundler issues with custom directories)
// ---------------------------------------------------------------------------

export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-invocation'; toolInvocation: Record<string, unknown> }
  | { type: 'reasoning'; reasoning: string; details?: unknown[] }
  | Record<string, unknown>;

export interface ChatUIMessage {
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

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

interface GenerateSessionTitleInput {
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
}

const { runChatAgentStepActivity, saveChatMessagesActivity } = proxyActivities<{
  runChatAgentStepActivity(input: ChatAgentStepInput): Promise<ChatAgentStepOutput>;
  saveChatMessagesActivity(input: SaveChatMessagesInput): Promise<void>;
}>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '30 seconds',
});

const { generateSessionTitleActivity } = proxyActivities<{
  generateSessionTitleActivity(input: GenerateSessionTitleInput): Promise<string>;
}>({
  startToCloseTimeout: '30 seconds',
});

// ---------------------------------------------------------------------------
// Signals & Queries
// ---------------------------------------------------------------------------

export const userMessageSignal = defineSignal<[ChatUIMessage]>('userMessage');
export const endChatSignal = defineSignal('endChat');

export const getMessagesQuery = defineQuery<ChatUIMessage[]>('getMessages');
export const getStatusQuery = defineQuery<string>('getStatus');

// ---------------------------------------------------------------------------
// Workflow Input
// ---------------------------------------------------------------------------

export interface ChatAgentWorkflowInput {
  sessionId: string;
  organizationId?: string | null;
  systemPrompt: string;
  /** Pre-loaded messages when continuing-as-new */
  initialMessages?: ChatUIMessage[];
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

const MAX_HISTORY_EVENTS = 2000;

export async function chatAgentWorkflow(input: ChatAgentWorkflowInput): Promise<string> {
  const { sessionId, organizationId, systemPrompt } = input;

  const messages: ChatUIMessage[] = input.initialMessages ?? [];
  let status: 'idle' | 'processing' | 'done' = 'idle';
  let chatEnded = false;
  let titleGenerated = (input.initialMessages?.length ?? 0) > 0; // skip if continuing
  const pendingUserMessages: ChatUIMessage[] = [];

  // ---- Signal handlers ----
  setHandler(userMessageSignal, (msg: ChatUIMessage) => {
    pendingUserMessages.push(msg);
  });

  setHandler(endChatSignal, () => {
    chatEnded = true;
  });

  // ---- Query handlers ----
  setHandler(getMessagesQuery, () => messages);
  setHandler(getStatusQuery, () => status);

  // ---- Main loop ----
  while (!chatEnded) {
    // Wait until we have a new user message or the chat is ended
    await condition(() => pendingUserMessages.length > 0 || chatEnded);

    if (chatEnded) break;

    // Process the next pending user message
    const userMsg = pendingUserMessages.shift()!;
    messages.push(userMsg);
    status = 'processing';

    try {
      // Run the AI agent step (LLM calls + tool execution)
      const result = await runChatAgentStepActivity({
        sessionId,
        organizationId: organizationId ?? undefined,
        systemPrompt,
        messages,
        maxSteps: 60,
      });

      // Append assistant messages to conversation history
      if (result.assistantMessages && result.assistantMessages.length > 0) {
        messages.push(...result.assistantMessages);
      }

      // Save assistant messages to DB (durable)
      await saveChatMessagesActivity({
        sessionId,
        messages: result.assistantMessages ?? [],
      });

      // Generate AI title after the first exchange
      if (!titleGenerated) {
        titleGenerated = true;
        const userText = userMsg.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('\n');
        const assistantText = (result.assistantMessages ?? [])
          .flatMap((m) => m.parts)
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('\n');

        if (userText && assistantText) {
          // Fire-and-forget — don't block the chat on title generation
          generateSessionTitleActivity({
            sessionId,
            userMessage: userText,
            assistantMessage: assistantText,
          }).catch(() => {
            // Title generation failure is non-critical
          });
        }
      }
    } catch (err) {
      // On error, add an error message so the user sees feedback
      messages.push({
        role: 'assistant',
        parts: [
          {
            type: 'text',
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      });
    }

    status = 'idle';

    // Continue-as-new if history is getting too large
    if (workflowInfo().historyLength > MAX_HISTORY_EVENTS) {
      await continueAsNew<typeof chatAgentWorkflow>({
        sessionId,
        organizationId,
        systemPrompt,
        initialMessages: messages,
      });
    }
  }

  status = 'done';
  return `Chat session ${sessionId} ended with ${messages.length} messages`;
}

import {
  condition,
  defineSignal,
  defineQuery,
  setHandler,
  proxyActivities,
  workflowInfo,
  continueAsNew,
  CancellationScope,
  isCancellation,
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
  compactionState?: {
    summary: string;
    compactedUpToIndex: number;
  };
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

const { runChatAgentStepActivity, saveChatMessagesActivity, markChatRunCompleteActivity } =
  proxyActivities<{
    runChatAgentStepActivity(input: ChatAgentStepInput): Promise<ChatAgentStepOutput>;
    saveChatMessagesActivity(input: SaveChatMessagesInput): Promise<void>;
    markChatRunCompleteActivity(input: { sessionId: string; runId: string }): Promise<void>;
  }>({
    startToCloseTimeout: '15 minutes',
    heartbeatTimeout: '30 seconds',
    retry: {
      initialInterval: '2 seconds',
      backoffCoefficient: 2,
      maximumInterval: '30 seconds',
      maximumAttempts: 5,
    },
  });

const { generateSessionTitleActivity } = proxyActivities<{
  generateSessionTitleActivity(input: GenerateSessionTitleInput): Promise<string>;
}>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

interface ChatUserTurn {
  message: ChatUIMessage;
  runId: string;
}

// ---------------------------------------------------------------------------
// Signals & Queries
// ---------------------------------------------------------------------------

export const userMessageSignal = defineSignal<[ChatUserTurn]>('userMessage');
export const endChatSignal = defineSignal('endChat');
export const interruptGenerationSignal = defineSignal('interruptGeneration');

export const getMessagesQuery = defineQuery<ChatUIMessage[]>('getMessages');
export const getStatusQuery = defineQuery<string>('getStatus');
export const getGenerationIdQuery = defineQuery<number>('getGenerationId');
export const getPendingCountQuery = defineQuery<number>('getPendingCount');

// ---------------------------------------------------------------------------
// Workflow Input
// ---------------------------------------------------------------------------

export interface ChatAgentWorkflowInput {
  sessionId: string;
  organizationId?: string | null;
  systemPrompt: string;
  /** Pre-loaded messages when continuing-as-new */
  initialMessages?: ChatUIMessage[];
  /** Pending user messages that arrived during processing, forwarded across continue-as-new */
  pendingMessages?: ChatUserTurn[];
  /** Persisted compaction state across continue-as-new */
  compactionState?: {
    summary: string;
    compactedUpToIndex: number;
  };
  /** Monotonic generation counter, forwarded across continue-as-new */
  initialGenerationId?: number;
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

const MAX_HISTORY_EVENTS = 2000;

function getMessageId(message: ChatUIMessage): string | null {
  if (typeof message.id !== 'string') return null;
  const trimmed = message.id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function partsSignature(parts: ChatMessagePart[]): string {
  try {
    return JSON.stringify(parts ?? []);
  } catch {
    return '__unserializable_parts__';
  }
}

export async function chatAgentWorkflow(input: ChatAgentWorkflowInput): Promise<string> {
  const { sessionId, organizationId, systemPrompt } = input;

  const messages: ChatUIMessage[] = input.initialMessages ?? [];
  let compactionState: { summary: string; compactedUpToIndex: number } | undefined =
    input.compactionState;
  let status: 'idle' | 'processing' | 'done' = 'idle';
  let chatEnded = false;
  let titleGenerated = (input.initialMessages?.length ?? 0) > 0; // skip if continuing
  const pendingUserMessages: ChatUserTurn[] = input.pendingMessages ?? [];
  let generationId: number = input.initialGenerationId ?? 0;
  let activeScope: CancellationScope | null = null;

  const seenUserMessageIds = new Set(
    messages
      .filter((message) => message.role === 'user')
      .map(getMessageId)
      .filter((id): id is string => Boolean(id)),
  );

  // ---- Signal handlers ----
  setHandler(userMessageSignal, (turn: ChatUserTurn) => {
    const msg = turn.message;
    // Defensive dedupe for transport retries / duplicate signal delivery.
    if (msg.role !== 'user') {
      return;
    }

    const messageId = getMessageId(msg);
    if (messageId && seenUserMessageIds.has(messageId)) {
      return;
    }

    if (!messageId) {
      const pendingTail = pendingUserMessages[pendingUserMessages.length - 1];
      const latestCommitted = messages[messages.length - 1];
      const incomingSignature = partsSignature(msg.parts);
      const isDuplicatePendingTail =
        pendingTail?.message.role === 'user' &&
        partsSignature(pendingTail.message.parts) === incomingSignature;
      const isImmediateRetryWhileProcessing =
        status === 'processing' &&
        pendingUserMessages.length === 0 &&
        latestCommitted?.role === 'user' &&
        partsSignature(latestCommitted.parts) === incomingSignature;
      if (isDuplicatePendingTail || isImmediateRetryWhileProcessing) {
        return;
      }
    }

    if (messageId) {
      seenUserMessageIds.add(messageId);
    }
    pendingUserMessages.push(turn);
  });

  setHandler(endChatSignal, () => {
    chatEnded = true;
  });

  setHandler(interruptGenerationSignal, () => {
    if (activeScope) {
      activeScope.cancel();
    }
  });

  // ---- Query handlers ----
  setHandler(getMessagesQuery, () => [...messages]);
  setHandler(getStatusQuery, () => status);
  setHandler(getGenerationIdQuery, () => generationId);
  setHandler(getPendingCountQuery, () => pendingUserMessages.length);

  // ---- Main loop ----
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes idle → auto-close

  while (!chatEnded) {
    // Wait until we have a new user message, the chat is ended, or idle timeout
    const gotMessage = await condition(
      () => pendingUserMessages.length > 0 || chatEnded,
      IDLE_TIMEOUT_MS,
    );

    // If timed out waiting for a message, end the workflow
    if (!gotMessage) break;
    if (chatEnded) break;

    // Bundle ALL pending messages for this generation
    const userTurns: ChatUserTurn[] = [];
    while (pendingUserMessages.length > 0) {
      userTurns.push(pendingUserMessages.shift()!);
    }

    const runId = userTurns[0]?.runId ?? 'gen-' + generationId;
    generationId++;

    // Add all user messages to history
    for (const turn of userTurns) {
      messages.push(turn.message);
    }

    status = 'processing';

    activeScope = new CancellationScope();
    try {
      const result = await activeScope.run(async () => {
        return await runChatAgentStepActivity({
          sessionId,
          runId,
          generationId,
          organizationId: organizationId ?? undefined,
          systemPrompt,
          messages,
          maxSteps: 60,
          compactionState,
        });
      });

      // Natural completion — process result
      if (result.compactionState) {
        compactionState = result.compactionState;
      }

      if (result.assistantMessages && result.assistantMessages.length > 0) {
        messages.push(...result.assistantMessages);
      }

      await saveChatMessagesActivity({
        sessionId,
        messages: result.assistantMessages ?? [],
      });

      // Generate AI title after the first exchange
      if (!titleGenerated) {
        titleGenerated = true;
        const firstUserMsg = userTurns[0]?.message;
        const userText = (firstUserMsg?.parts ?? [])
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('\n');
        const assistantText = (result.assistantMessages ?? [])
          .flatMap((m) => m.parts)
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('\n');

        if (userText && assistantText) {
          try {
            await generateSessionTitleActivity({
              sessionId,
              userMessage: userText,
              assistantMessage: assistantText,
            });
          } catch {
            // Title generation failure is non-critical
          }
        }
      }
    } catch (err) {
      if (isCancellation(err)) {
        // Interrupted — activity cancellation handler already flushed partial state
        try {
          await CancellationScope.nonCancellable(async () => {
            await markChatRunCompleteActivity({ sessionId, runId });
          });
        } catch {
          // Best-effort
        }
      } else {
        // Existing error handling
        try {
          await markChatRunCompleteActivity({ sessionId, runId });
        } catch {
          // Best-effort: avoid masking the original failure path.
        }

        messages.push({
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        });

        await saveChatMessagesActivity({
          sessionId,
          messages: [messages[messages.length - 1]],
        }).catch(() => {
          // Best-effort: don't fail the workflow if error persistence fails
        });
      }
    } finally {
      activeScope = null;
    }

    status = 'idle';

    // Continue-as-new if history is getting too large
    if (workflowInfo().historyLength > MAX_HISTORY_EVENTS) {
      await continueAsNew<typeof chatAgentWorkflow>({
        sessionId,
        organizationId,
        systemPrompt,
        initialMessages: messages,
        pendingMessages: pendingUserMessages,
        compactionState,
        initialGenerationId: generationId,
      });
    }
  }

  status = 'done';
  return `Chat session ${sessionId} ended with ${messages.length} messages`;
}

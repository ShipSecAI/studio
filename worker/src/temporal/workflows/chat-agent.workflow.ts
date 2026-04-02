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

interface HotplugSessionResult {
  sessionId: string;
  mcpUrl: string;
  mcpToken: string;
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

interface SaveChatMessagesInput {
  sessionId: string;
  messages: ChatUIMessage[];
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

interface GenerateSessionTitleInput {
  sessionId: string;
  organizationId?: string;
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
    heartbeatTimeout: '10 seconds',
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

const { createHotplugChatSessionActivity, terminateHotplugChatSessionActivity } = proxyActivities<{
  createHotplugChatSessionActivity(input: {
    chatSessionId: string;
    organizationId?: string;
  }): Promise<HotplugSessionResult | null>;
  terminateHotplugChatSessionActivity(input: { hotplugSessionId: string }): Promise<void>;
}>({
  startToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: 2,
  },
});

interface ChatUserTurn {
  turnId: string;
  message: ChatUIMessage;
  runId: string;
  queuedAt?: string;
  generationId?: number;
  submissionId?: string;
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
  /** Active run while queued turns drain, forwarded across continue-as-new */
  activeRunId?: string;
  /** Hotplug session for org MCP servers, forwarded across continue-as-new */
  hotplugSession?: HotplugSessionResult | null;
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
  let activeRunId: string | null = input.activeRunId ?? null;
  let activeScope: CancellationScope | null = null;

  // Create or reuse Hotplug session for org MCP server access
  let hotplugSession: HotplugSessionResult | null = input.hotplugSession ?? null;
  if (!hotplugSession) {
    try {
      hotplugSession = await createHotplugChatSessionActivity({
        chatSessionId: sessionId,
        organizationId: organizationId ?? undefined,
      });
    } catch {
      // Non-critical — chat continues with Studio tools only
    }
  }

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
    const normalizedTurnId =
      typeof turn.turnId === 'string' && turn.turnId.trim().length > 0
        ? turn.turnId
        : `legacy-turn-${turn.runId}-${generationId}-${pendingUserMessages.length + 1}`;

    pendingUserMessages.push({
      ...turn,
      turnId: normalizedTurnId,
      queuedAt: turn.queuedAt ?? new Date().toISOString(),
    });
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

    // Drain and merge ALL pending user messages into one model turn.
    const drainedTurns = pendingUserMessages.splice(0, pendingUserMessages.length);
    const primaryTurn = drainedTurns[0];

    const turnGenerationId =
      typeof primaryTurn?.generationId === 'number' && Number.isFinite(primaryTurn.generationId)
        ? primaryTurn.generationId
        : generationId + 1;
    generationId = Math.max(generationId, turnGenerationId);

    const runId = activeRunId ?? primaryTurn?.runId ?? 'gen-' + turnGenerationId;
    activeRunId = runId;

    // Add ALL drained user messages to history
    for (const turn of drainedTurns) {
      messages.push(turn.message);
    }

    status = 'processing';

    activeScope = new CancellationScope();
    try {
      const result = await activeScope.run(async () => {
        return await runChatAgentStepActivity({
          sessionId,
          turnId: primaryTurn.turnId,
          runId,
          generationId: turnGenerationId,
          organizationId: organizationId ?? undefined,
          systemPrompt,
          messages,
          maxSteps: 60,
          queuedAt: primaryTurn.queuedAt,
          compactionState,
          hotplugSession,
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
        // Use the first user message for title generation context
        const firstUserMsg = drainedTurns[0]?.message;
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
          // Fire-and-forget — don't block the chat on title generation
          generateSessionTitleActivity({
            sessionId,
            organizationId: organizationId ?? undefined,
            userMessage: userText,
            assistantMessage: assistantText,
          }).catch(() => {
            // Title generation failure is non-critical
          });
        }
      }
    } catch (err) {
      if (isCancellation(err)) {
        // Interrupted — the activity already flushed partial state and marker.
      } else {
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

    // Complete the durable run only once the queue is drained.
    // While there are queued turns, keep the same run active so appended
    // events continue to match session.activeRunId.
    if (pendingUserMessages.length === 0) {
      try {
        await CancellationScope.nonCancellable(async () => {
          await markChatRunCompleteActivity({ sessionId, runId });
        });
        activeRunId = null;
      } catch {
        // Best-effort: do not block chat loop on completion marker failures.
      }
    }

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
        activeRunId: activeRunId ?? undefined,
        hotplugSession,
      });
    }
  }

  // Clean up Hotplug session on chat end
  if (hotplugSession) {
    terminateHotplugChatSessionActivity({
      hotplugSessionId: hotplugSession.sessionId,
    }).catch(() => {
      // Best-effort cleanup
    });
  }

  status = 'done';
  return `Chat session ${sessionId} ended with ${messages.length} messages`;
}

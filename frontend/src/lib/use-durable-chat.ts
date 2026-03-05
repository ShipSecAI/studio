import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import type { DurableChatTransport, ChatSessionStateResponse } from './durable-chat-transport';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DurableChatStatus = 'ready' | 'streaming' | 'submitting' | 'error';

export interface UseDurableChatOptions {
  /** The transport instance (shared across the app for SSE reuse). */
  transport: DurableChatTransport;
  /** Current session ID (null/undefined = no session). */
  sessionId: string | null | undefined;
  /** Throttle interval (ms) for batching streaming text updates. Default 80. */
  throttleMs?: number;
  /**
   * Called for every SSE chunk — use for side-effects like queue state
   * management. This fires for ALL session events, not just the active turn.
   */
  onChunk?: (chunk: unknown, context: { sessionId: string; runId?: string }) => void;
  /**
   * Called when messages are refreshed from backend state.
   * Useful for syncing external state (queue, processing status).
   */
  onStateRefresh?: (state: ChatSessionStateResponse) => void;
}

export interface UseDurableChatReturn {
  /** Current message list (backend truth + streaming deltas). */
  messages: UIMessage[];
  /** Hook status: ready, streaming, or submitting (POST in flight). */
  status: DurableChatStatus;
  /** Last error, if any. */
  error: Error | null;
  /** Send a user message. Pass sessionId explicitly for lazy-created sessions. */
  sendMessage: (opts: { text: string; sessionId?: string }) => void;
  /** Replace the local message list (e.g., for hydration or reset). */
  setMessages: (msgs: UIMessage[]) => void;
  /** Fetch fresh state from the backend and update messages. */
  refreshState: () => Promise<ChatSessionStateResponse | null>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hydrateMessages(raw: ChatSessionStateResponse['messages']): UIMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts,
  }));
}

function appendTextDeltaToParts(parts: UIMessage['parts'], delta: string): UIMessage['parts'] {
  if (!delta) return parts;

  const lastPart = parts[parts.length - 1];
  if (lastPart?.type === 'text') {
    return parts.map((part, idx) =>
      idx === parts.length - 1 && part.type === 'text'
        ? { type: 'text' as const, text: part.text + delta }
        : part,
    );
  }

  return [...parts, { type: 'text' as const, text: delta }];
}

function upsertToolInvocationPart(
  parts: UIMessage['parts'],
  update: {
    toolCallId: string;
    toolName?: string;
    state: 'input-available' | 'output-available' | 'output-error';
    input?: unknown;
    output?: unknown;
    errorText?: string;
    preliminary?: boolean;
  },
): UIMessage['parts'] {
  const idx = parts.findIndex(
    (part) =>
      part.type === 'tool-invocation' &&
      'toolCallId' in part &&
      typeof part.toolCallId === 'string' &&
      part.toolCallId === update.toolCallId,
  );

  const nextPart = {
    type: 'tool-invocation' as const,
    toolCallId: update.toolCallId,
    ...(update.toolName ? { toolName: update.toolName } : {}),
    state: update.state,
    ...(update.input !== undefined ? { input: update.input } : {}),
    ...(update.output !== undefined ? { output: update.output } : {}),
    ...(update.errorText !== undefined ? { errorText: update.errorText } : {}),
    ...(update.preliminary !== undefined ? { preliminary: update.preliminary } : {}),
  };

  if (idx < 0) {
    return [...parts, nextPart];
  }

  return parts.map((part, i) => {
    if (i !== idx) return part;
    return {
      ...part,
      ...nextPart,
    } as UIMessage['parts'][number];
  });
}

function partSignature(part: UIMessage['parts'][number]) {
  const typed = part as Record<string, unknown>;
  if (typed.type === 'text') {
    return `text:${String(typed.text ?? '')}`;
  }
  if (typed.type === 'reasoning') {
    return `reasoning:${String(typed.state ?? '')}:${String(typed.text ?? '')}`;
  }
  try {
    return JSON.stringify(part);
  } catch {
    return String(typed.type ?? 'unknown');
  }
}

function arePartsEquivalent(nextParts: UIMessage['parts'], prevParts: UIMessage['parts']) {
  if (nextParts === prevParts) return true;
  if (nextParts.length !== prevParts.length) return false;
  for (let i = 0; i < nextParts.length; i++) {
    const next = nextParts[i];
    const prev = prevParts[i];
    if (next === prev) continue;
    if (partSignature(next) !== partSignature(prev)) {
      return false;
    }
  }
  return true;
}

function areMessagesEquivalent(nextMessages: UIMessage[], prevMessages: UIMessage[]) {
  if (nextMessages === prevMessages) return true;
  if (nextMessages.length !== prevMessages.length) return false;
  for (let i = 0; i < nextMessages.length; i++) {
    const next = nextMessages[i];
    const prev = prevMessages[i];
    if (next === prev) continue;
    if (next.id !== prev.id || next.role !== prev.role) return false;
    if (!arePartsEquivalent(next.parts, prev.parts)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDurableChat(options: UseDurableChatOptions): UseDurableChatReturn {
  const {
    transport,
    sessionId,
    throttleMs = 80,
    onChunk: externalOnChunk,
    onStateRefresh,
  } = options;

  // ── Core state ────────────────────────────────────────────────────
  const [messages, setMessagesState] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<DurableChatStatus>('ready');
  const [error, setError] = useState<Error | null>(null);

  // Refs for callback stability
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const latestStreamSeqRef = useRef(0);
  const latestAppliedStateSeqRef = useRef(0);
  const hasHydratedRef = useRef(false);

  // Stable callback refs
  const externalOnChunkRef = useRef(externalOnChunk);
  externalOnChunkRef.current = externalOnChunk;
  const onStateRefreshRef = useRef(onStateRefresh);
  onStateRefreshRef.current = onStateRefresh;

  const clearStreamingState = useCallback(() => {
    activeTurnIdRef.current = null;
    streamingMsgIdRef.current = null;
  }, []);

  const flushPendingMessagesNow = useCallback(() => {
    if (throttleTimerRef.current) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    setMessagesState(messagesRef.current);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (throttleTimerRef.current) return;
    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null;
      setMessagesState(messagesRef.current);
    }, throttleMs);
  }, [throttleMs]);

  const commitMessages = useCallback(
    (next: UIMessage[], mode: 'immediate' | 'throttled' = 'immediate') => {
      messagesRef.current = next;
      if (mode === 'throttled') {
        scheduleFlush();
        return;
      }
      flushPendingMessagesNow();
    },
    [scheduleFlush, flushPendingMessagesNow],
  );

  const refreshState = useCallback(
    async (sid?: string): Promise<ChatSessionStateResponse | null> => {
      const targetId = sid ?? sessionIdRef.current;
      if (!targetId) return null;

      const state = await transport.getState(targetId);
      if (!state || sessionIdRef.current !== targetId) return state;

      const stateSeq = Math.max(0, state.afterSeq ?? state.lastSeq ?? 0);

      // Guard against stale refresh snapshots clobbering active local stream updates.
      const hasActiveStream = activeTurnIdRef.current !== null;
      const isProcessing = state.processingStatus !== 'idle';
      if (hasActiveStream && isProcessing && stateSeq < latestStreamSeqRef.current) {
        onStateRefreshRef.current?.(state);
        return state;
      }

      if (
        !hasActiveStream &&
        hasHydratedRef.current &&
        stateSeq > 0 &&
        stateSeq <= latestAppliedStateSeqRef.current
      ) {
        onStateRefreshRef.current?.(state);
        return state;
      }

      const hydrated = hydrateMessages(state.messages);

      // Don't overwrite local optimistic messages with empty backend state.
      if (hydrated.length === 0 && messagesRef.current.length > 0) {
        onStateRefreshRef.current?.(state);
        return state;
      }

      if (!areMessagesEquivalent(hydrated, messagesRef.current)) {
        commitMessages(hydrated, 'immediate');
      }
      hasHydratedRef.current = true;
      latestAppliedStateSeqRef.current = Math.max(latestAppliedStateSeqRef.current, stateSeq);

      // If backend has moved to canonical turn message id for the active turn,
      // move subsequent deltas to that message id instead of a local temp id.
      if (activeTurnIdRef.current) {
        const canonicalTurnMessageId = `turn-${activeTurnIdRef.current}`;
        if (hydrated.some((m) => m.id === canonicalTurnMessageId)) {
          streamingMsgIdRef.current = canonicalTurnMessageId;
        }
      }

      if (state.processingStatus === 'idle' || !activeTurnIdRef.current) {
        clearStreamingState();
      }

      onStateRefreshRef.current?.(state);
      return state;
    },
    [transport, commitMessages, clearStreamingState],
  );

  // ── SSE chunk handler ─────────────────────────────────────────────

  const handleSseChunk = useCallback(
    (chunk: unknown, context: { sessionId: string; runId?: string }) => {
      externalOnChunkRef.current?.(chunk, context);

      if (!chunk || typeof chunk !== 'object') return;
      const c = chunk as Record<string, unknown>;

      const seq = typeof c.seq === 'number' ? c.seq : null;
      if (seq != null) {
        latestStreamSeqRef.current = Math.max(latestStreamSeqRef.current, seq);
      }

      const chunkTurnId = typeof c.turnId === 'string' ? c.turnId : undefined;
      const inner =
        c.chunk && typeof c.chunk === 'object' ? (c.chunk as Record<string, unknown>) : c;

      if (inner.type === 'text-delta') {
        if (!chunkTurnId) {
          console.warn('[useDurableChat] text-delta without turnId, skipping', inner);
          return;
        }

        if (activeTurnIdRef.current && activeTurnIdRef.current !== chunkTurnId) {
          return;
        }

        const delta = typeof inner.delta === 'string' ? inner.delta : '';
        if (!delta) return;

        activeTurnIdRef.current = chunkTurnId;
        const canonicalTurnMsgId = `turn-${chunkTurnId}`;
        const msgId = streamingMsgIdRef.current ?? canonicalTurnMsgId;
        streamingMsgIdRef.current = msgId;

        const current = messagesRef.current;
        const existingIdx = current.findIndex((m) => m.id === msgId);
        let next: UIMessage[];

        if (existingIdx >= 0) {
          const existing = current[existingIdx];
          const updated: UIMessage = {
            ...existing,
            parts: appendTextDeltaToParts(existing.parts, delta),
          };
          next = [...current];
          next[existingIdx] = updated;
          const hasToolParts = existing.parts.some((part) => part.type === 'tool-invocation');
          commitMessages(next, hasToolParts ? 'immediate' : 'throttled');
        } else {
          next = [
            ...current,
            {
              id: msgId,
              role: 'assistant' as const,
              parts: [{ type: 'text' as const, text: delta }],
            },
          ];
          commitMessages(next, 'throttled');
        }
        setStatus('streaming');
        return;
      }

      if (
        inner.type === 'tool-input-start' ||
        inner.type === 'tool-input-available' ||
        inner.type === 'tool-output-available' ||
        inner.type === 'tool-output-error'
      ) {
        if (!chunkTurnId) {
          return;
        }

        if (activeTurnIdRef.current && activeTurnIdRef.current !== chunkTurnId) {
          return;
        }

        const toolCallId =
          'toolCallId' in inner && typeof inner.toolCallId === 'string' ? inner.toolCallId : null;
        if (!toolCallId) {
          return;
        }

        activeTurnIdRef.current = chunkTurnId;
        const canonicalTurnMsgId = `turn-${chunkTurnId}`;
        const msgId = streamingMsgIdRef.current ?? canonicalTurnMsgId;
        streamingMsgIdRef.current = msgId;

        let update: {
          toolCallId: string;
          toolName?: string;
          state: 'input-available' | 'output-available' | 'output-error';
          input?: unknown;
          output?: unknown;
          errorText?: string;
          preliminary?: boolean;
        } | null = null;

        if (inner.type === 'tool-input-start') {
          update = {
            toolCallId,
            toolName: typeof inner.toolName === 'string' ? inner.toolName : undefined,
            state: 'input-available',
          };
        } else if (inner.type === 'tool-input-available') {
          update = {
            toolCallId,
            toolName: typeof inner.toolName === 'string' ? inner.toolName : undefined,
            state: 'input-available',
            input: inner.input,
          };
        } else if (inner.type === 'tool-output-available') {
          update = {
            toolCallId,
            toolName: typeof inner.toolName === 'string' ? inner.toolName : undefined,
            state: 'output-available',
            output: inner.output,
            preliminary: inner.preliminary === true,
          };
        } else if (inner.type === 'tool-output-error') {
          update = {
            toolCallId,
            toolName: typeof inner.toolName === 'string' ? inner.toolName : undefined,
            state: 'output-error',
            output: inner.output,
            errorText: typeof inner.errorText === 'string' ? inner.errorText : undefined,
          };
        }

        if (!update) {
          return;
        }

        const current = messagesRef.current;
        const existingIdx = current.findIndex((m) => m.id === msgId);
        let next: UIMessage[];

        if (existingIdx >= 0) {
          const existing = current[existingIdx];
          const updated: UIMessage = {
            ...existing,
            parts: upsertToolInvocationPart(existing.parts, update),
          };
          next = [...current];
          next[existingIdx] = updated;
        } else {
          next = [
            ...current,
            {
              id: msgId,
              role: 'assistant' as const,
              parts: upsertToolInvocationPart([], update),
            },
          ];
        }

        commitMessages(next, 'immediate');
        setStatus('streaming');
        return;
      }

      if (inner.type === 'data-turn-status') {
        const data =
          inner.data && typeof inner.data === 'object'
            ? (inner.data as Record<string, unknown>)
            : {};
        const turnStatus = data.status as string | undefined;

        if (turnStatus === 'stopping') {
          setStatus('ready');
          return;
        }

        if (
          turnStatus === 'completed' ||
          turnStatus === 'interrupted' ||
          turnStatus === 'failed' ||
          turnStatus === 'cancelled'
        ) {
          flushPendingMessagesNow();
          clearStreamingState();
          setStatus('ready');

          const pendingCount = typeof data.pendingCount === 'number' ? data.pendingCount : -1;
          if (pendingCount <= 0) {
            void refreshState();
          }
        }
      }
    },
    [commitMessages, clearStreamingState, flushPendingMessagesNow, refreshState],
  );

  // ── Transport chunk subscription ─────────────────────────────────

  useEffect(() => {
    const unsubscribe = transport.onSessionChunk((chunk) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const c = chunk as Record<string, unknown>;
      const runId = typeof c.runId === 'string' ? c.runId : undefined;
      handleSseChunk(chunk, { sessionId: sid, runId });
    });
    return unsubscribe;
  }, [transport, handleSseChunk]);

  // ── Session lifecycle ─────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId) {
      commitMessages([], 'immediate');
      clearStreamingState();
      latestStreamSeqRef.current = 0;
      latestAppliedStateSeqRef.current = 0;
      hasHydratedRef.current = false;
      setStatus('ready');
      setError(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      // Hydrate first so we can resume from the latest known durable cursor.
      const initialState = await refreshState(sessionId);
      if (cancelled || sessionIdRef.current !== sessionId) {
        return;
      }

      const afterSeq = Math.max(0, initialState?.afterSeq ?? initialState?.lastSeq ?? 0);
      await transport.openSessionStream(sessionId, afterSeq);

      if (cancelled || sessionIdRef.current !== sessionId) {
        return;
      }

      // One immediate refresh after stream attach closes the small race window
      // between initial state fetch and SSE connection establishment.
      void refreshState(sessionId);
    })().catch((err) => {
      if (!cancelled && sessionIdRef.current === sessionId) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    return () => {
      cancelled = true;
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      clearStreamingState();
    };
  }, [sessionId, transport, refreshState, commitMessages, clearStreamingState]);

  // ── Cross-tab sync: visibility change + low-frequency poll ────────

  useEffect(() => {
    if (!sessionId) return;

    const onVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        sessionIdRef.current &&
        !activeTurnIdRef.current
      ) {
        void refreshState();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    const pollTimer = setInterval(() => {
      if (
        sessionIdRef.current &&
        document.visibilityState === 'visible' &&
        !activeTurnIdRef.current
      ) {
        void refreshState();
      }
    }, 10_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(pollTimer);
    };
  }, [sessionId, refreshState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      transport.closeSessionStream();
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
      }
    };
  }, [transport]);

  // ── Send message ──────────────────────────────────────────────────

  const sendMessage = useCallback(
    (opts: { text: string; sessionId?: string }) => {
      const sid = opts.sessionId ?? sessionIdRef.current;
      if (!sid) return;

      setError(null);

      const userMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const userMessage = {
        id: userMsgId,
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: opts.text }],
      } satisfies UIMessage;

      // Optimistic local echo so user message appears immediately in transcript.
      const outboundMessages = [...messagesRef.current, userMessage];
      commitMessages(outboundMessages, 'immediate');
      setStatus('submitting');

      clearStreamingState();

      void (async () => {
        try {
          await transport.sendMessages({
            trigger: 'submit-message',
            chatId: sid,
            messageId: userMsgId,
            messages: outboundMessages,
          });
        } catch (err) {
          if (sessionIdRef.current === sid) {
            setError(err instanceof Error ? err : new Error(String(err)));
            setStatus('error');
          }
        }
      })();
    },
    [transport, commitMessages, clearStreamingState],
  );

  // ── Public setMessages ────────────────────────────────────────────

  const setMessages = useCallback(
    (msgs: UIMessage[]) => {
      commitMessages(msgs, 'immediate');
      clearStreamingState();
    },
    [commitMessages, clearStreamingState],
  );

  return {
    messages,
    status,
    error,
    sendMessage,
    setMessages,
    refreshState,
  };
}

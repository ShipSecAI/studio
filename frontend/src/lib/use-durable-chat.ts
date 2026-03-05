import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import type {
  DurableChatTransport,
  ChatSessionStateResponse,
  SendTurnResponse,
} from './durable-chat-transport';

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
   * Called when a queued turn response is received (turn was enqueued,
   * not immediately executed).
   */
  onQueuedTurn?: (
    response: SendTurnResponse & { clientMessageId?: string },
    context: { sessionId: string },
  ) => void;
  /**
   * Called when messages are refreshed from backend state.
   * Useful for syncing external state (queue, processing status).
   */
  onStateRefresh?: (state: ChatSessionStateResponse) => void;
}

export interface UseDurableChatReturn {
  /** Current message list (backend truth + streaming buffer). */
  messages: UIMessage[];
  /** Hook status: ready, streaming, or submitting (POST in flight). */
  status: DurableChatStatus;
  /** Last error, if any. */
  error: Error | null;
  /** Send a user message. */
  sendMessage: (opts: { text: string }) => void;
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDurableChat(options: UseDurableChatOptions): UseDurableChatReturn {
  const {
    transport,
    sessionId,
    throttleMs = 80,
    onChunk: externalOnChunk,
    onQueuedTurn,
    onStateRefresh,
  } = options;

  // ── Core state ────────────────────────────────────────────────────
  const [baseMessages, setBaseMessages] = useState<UIMessage[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [status, setStatus] = useState<DurableChatStatus>('ready');
  const [error, setError] = useState<Error | null>(null);

  // Refs for callback stability
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const baseMessagesRef = useRef(baseMessages);
  baseMessagesRef.current = baseMessages;
  const streamingTextRef = useRef('');
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);

  // Stable callback refs
  const externalOnChunkRef = useRef(externalOnChunk);
  externalOnChunkRef.current = externalOnChunk;
  const onQueuedTurnRef = useRef(onQueuedTurn);
  onQueuedTurnRef.current = onQueuedTurn;
  const onStateRefreshRef = useRef(onStateRefresh);
  onStateRefreshRef.current = onStateRefresh;

  // ── Derived: merge streaming buffer into messages ─────────────────

  const messages: UIMessage[] =
    streamingMsgId && streamingText
      ? (() => {
          const existing = baseMessages.find((m) => m.id === streamingMsgId);
          if (existing) {
            return baseMessages.map((m) =>
              m.id === streamingMsgId
                ? {
                    ...m,
                    parts: updateTextInParts(m.parts, streamingText),
                  }
                : m,
            );
          }
          return [
            ...baseMessages,
            {
              id: streamingMsgId,
              role: 'assistant' as const,
              parts: [{ type: 'text' as const, text: streamingText }],
            },
          ];
        })()
      : baseMessages;

  // ── State refresh ─────────────────────────────────────────────────

  const refreshState = useCallback(
    async (sid?: string): Promise<ChatSessionStateResponse | null> => {
      const targetId = sid ?? sessionIdRef.current;
      if (!targetId) return null;

      const state = await transport.getState(targetId);
      if (!state || sessionIdRef.current !== targetId) return state;

      const hydrated = hydrateMessages(state.messages);
      baseMessagesRef.current = hydrated;
      setBaseMessages(hydrated);

      // Clear streaming state — backend has the persisted truth now
      streamingTextRef.current = '';
      activeTurnIdRef.current = null;
      setStreamingText('');
      setStreamingMsgId(null);

      onStateRefreshRef.current?.(state);
      return state;
    },
    [transport],
  );

  // ── Streaming buffer flush ────────────────────────────────────────

  const flushBuffer = useCallback(() => {
    setStreamingText(streamingTextRef.current);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (throttleTimerRef.current) return;
    throttleTimerRef.current = setTimeout(() => {
      throttleTimerRef.current = null;
      flushBuffer();
    }, throttleMs);
  }, [throttleMs, flushBuffer]);

  // ── SSE chunk handler ─────────────────────────────────────────────
  // This is passed to the transport and fires for every session SSE event.

  const handleSseChunk = useCallback(
    (chunk: unknown, context: { sessionId: string; runId?: string }) => {
      // Forward to external handler (queue state management, etc.)
      externalOnChunkRef.current?.(chunk, context);

      if (!chunk || typeof chunk !== 'object') return;
      const c = chunk as Record<string, unknown>;

      // Only process chunks for the active turn
      const chunkTurnId = c.turnId as string | undefined;

      // ── Text deltas → streaming buffer ──
      // Process inner chunk if wrapped (from SSE the chunk field contains the actual event)
      const inner =
        c.chunk && typeof c.chunk === 'object' ? (c.chunk as Record<string, unknown>) : c;

      if (inner.type === 'text-delta' && chunkTurnId) {
        if (!activeTurnIdRef.current || activeTurnIdRef.current === chunkTurnId) {
          activeTurnIdRef.current = chunkTurnId;
          streamingTextRef.current += inner.delta as string;
          if (!streamingMsgId) {
            setStreamingMsgId(`streaming-${chunkTurnId}`);
          }
          setStatus('streaming');
          scheduleFlush();
        }
        return;
      }

      // ── Turn status events ──
      if (inner.type === 'data-turn-status') {
        const data =
          inner.data && typeof inner.data === 'object'
            ? (inner.data as Record<string, unknown>)
            : {};
        const turnStatus = data.status as string | undefined;

        if (
          turnStatus === 'completed' ||
          turnStatus === 'interrupted' ||
          turnStatus === 'failed' ||
          turnStatus === 'cancelled'
        ) {
          // Terminal — refresh from backend to get persisted messages
          if (throttleTimerRef.current) {
            clearTimeout(throttleTimerRef.current);
            throttleTimerRef.current = null;
          }
          void refreshState();
          setStatus('ready');
        }
      }
    },
    [scheduleFlush, refreshState, streamingMsgId],
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
      setBaseMessages([]);
      setStreamingText('');
      setStreamingMsgId(null);
      streamingTextRef.current = '';
      activeTurnIdRef.current = null;
      setStatus('ready');
      setError(null);
      return;
    }

    // New session — hydrate from backend and open SSE
    void (async () => {
      const state = await refreshState(sessionId);
      if (state && sessionIdRef.current === sessionId) {
        const afterSeq = Math.max(0, state.afterSeq ?? state.lastSeq ?? 0);
        transport.openSessionStream(sessionId, afterSeq);
      }
    })();

    return () => {
      // Cleanup streaming state on session switch
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      streamingTextRef.current = '';
      activeTurnIdRef.current = null;
    };
  }, [sessionId, transport, refreshState]);

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
    (opts: { text: string }) => {
      const sid = sessionIdRef.current;
      if (!sid) return;

      setError(null);

      // Optimistic user message
      const userMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const userMessage = {
        id: userMsgId,
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: opts.text }],
      } satisfies UIMessage;

      const updated = [...baseMessagesRef.current, userMessage];
      baseMessagesRef.current = updated;
      setBaseMessages(updated);
      setStatus('submitting');

      // Reset streaming state for the new turn
      streamingTextRef.current = '';
      activeTurnIdRef.current = null;
      setStreamingText('');
      setStreamingMsgId(null);

      // POST the turn — the SSE will deliver chunks
      void (async () => {
        try {
          // sendMessages returns a ReadableStream, but with session-level SSE
          // we don't need to consume it — chunks arrive via the SSE handler.
          // We call it to POST the turn and let the transport open/maintain SSE.
          await transport.sendMessages({
            trigger: 'submit-message',
            chatId: sid,
            messageId: userMsgId,
            messages: updated,
          });
          // If status is still submitting (no streaming chunks arrived yet),
          // keep it as submitting — it'll transition to streaming on first text-delta
          // or back to ready on terminal event.
        } catch (err) {
          if (sessionIdRef.current === sid) {
            setError(err instanceof Error ? err : new Error(String(err)));
            setStatus('error');
          }
        }
      })();
    },
    [transport],
  );

  // ── Public setMessages ────────────────────────────────────────────

  const setMessages = useCallback((msgs: UIMessage[]) => {
    baseMessagesRef.current = msgs;
    setBaseMessages(msgs);
    // Clear streaming state
    streamingTextRef.current = '';
    activeTurnIdRef.current = null;
    setStreamingText('');
    setStreamingMsgId(null);
  }, []);

  return {
    messages,
    status,
    error,
    sendMessage,
    setMessages,
    refreshState,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function updateTextInParts(parts: UIMessage['parts'], text: string): UIMessage['parts'] {
  const lastTextIdx = parts.reduce((acc, p, i) => (p.type === 'text' ? i : acc), -1);
  if (lastTextIdx >= 0) {
    return parts.map((p, i) => (i === lastTextIdx ? { type: 'text' as const, text } : p));
  }
  return [...parts, { type: 'text' as const, text }];
}

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
  const streamingMsgIdRef = useRef<string | null>(null);
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

      // Don't overwrite local messages with empty backend state.
      // This happens during lazy session creation: sendMessage adds an
      // optimistic user message while refreshState is still fetching.
      if (hydrated.length === 0 && baseMessagesRef.current.length > 0) {
        onStateRefreshRef.current?.(state);
        return state;
      }

      baseMessagesRef.current = hydrated;
      setBaseMessages(hydrated);

      // Clear streaming state — backend has the persisted truth now
      streamingTextRef.current = '';
      streamingMsgIdRef.current = null;
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

      if (inner.type === 'text-delta' && !chunkTurnId) {
        console.warn('[useDurableChat] text-delta without turnId, skipping', inner);
        return;
      }

      if (inner.type === 'text-delta' && chunkTurnId) {
        if (!activeTurnIdRef.current || activeTurnIdRef.current === chunkTurnId) {
          activeTurnIdRef.current = chunkTurnId;
          streamingTextRef.current += inner.delta as string;
          if (!streamingMsgIdRef.current) {
            const newId = `streaming-${chunkTurnId}`;
            streamingMsgIdRef.current = newId;
            setStreamingMsgId(newId);
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
          // Cancel any pending throttle flush
          if (throttleTimerRef.current) {
            clearTimeout(throttleTimerRef.current);
            throttleTimerRef.current = null;
          }

          // Promote streaming buffer into baseMessages so the text persists
          // while refreshState() fetches the definitive server state.
          if (streamingTextRef.current && streamingMsgIdRef.current) {
            const msgId = streamingMsgIdRef.current;
            const text = streamingTextRef.current;
            const existingMsg = baseMessagesRef.current.find((m) => m.id === msgId);
            if (existingMsg) {
              const updated = baseMessagesRef.current.map((m) =>
                m.id === msgId ? { ...m, parts: updateTextInParts(m.parts, text) } : m,
              );
              baseMessagesRef.current = updated;
              setBaseMessages(updated);
            } else {
              const updated: UIMessage[] = [
                ...baseMessagesRef.current,
                {
                  id: msgId,
                  role: 'assistant' as const,
                  parts: [{ type: 'text' as const, text }],
                },
              ];
              baseMessagesRef.current = updated;
              setBaseMessages(updated);
            }
          }

          // Now clear streaming state
          streamingTextRef.current = '';
          streamingMsgIdRef.current = null;
          activeTurnIdRef.current = null;
          setStreamingText('');
          setStreamingMsgId(null);
          setStatus('ready');

          // Refresh from backend to get the definitive state.
          // Always refresh unless there are explicitly more pending turns.
          // (Worker turn-status events don't include pendingCount/processingStatus.)
          const pendingCount = typeof data.pendingCount === 'number' ? data.pendingCount : -1;
          if (pendingCount > 0) {
            // More turns queued — skip refresh, next turn will trigger one
          } else {
            void refreshState();
          }
        }
      }
    },
    [scheduleFlush, refreshState],
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
      streamingMsgIdRef.current = null;
      activeTurnIdRef.current = null;
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
      // Cleanup streaming state on session switch
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      streamingTextRef.current = '';
      streamingMsgIdRef.current = null;
      activeTurnIdRef.current = null;
    };
  }, [sessionId, transport, refreshState]);

  // ── Cross-tab sync: visibility change + low-frequency poll ────────
  // When the user switches to this tab, refresh state immediately so
  // it picks up any turns started by other tabs. Also poll every 10s
  // as a safety net for SSE connection gaps.

  useEffect(() => {
    if (!sessionId) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && sessionIdRef.current) {
        void refreshState();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    const pollTimer = setInterval(() => {
      if (sessionIdRef.current && document.visibilityState === 'visible') {
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
      streamingMsgIdRef.current = null;
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
    streamingMsgIdRef.current = null;
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

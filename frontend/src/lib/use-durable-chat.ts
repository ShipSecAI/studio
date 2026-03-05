import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIMessage } from 'ai';
import type { ChatSessionStateResponse, DurableChatTransport } from './durable-chat-transport';

export type DurableChatStatus = 'ready' | 'streaming' | 'submitting' | 'error';

export interface UseDurableChatOptions {
  transport: DurableChatTransport;
  sessionId: string | null | undefined;
  onChunk?: (chunk: unknown, context: { sessionId: string; runId?: string }) => void;
  onStateRefresh?: (state: ChatSessionStateResponse) => void;
}

export interface UseDurableChatReturn {
  messages: UIMessage[];
  status: DurableChatStatus;
  error: Error | null;
  sendMessage: (opts: { text: string; sessionId?: string }) => void;
  setMessages: (msgs: UIMessage[]) => void;
  refreshState: () => Promise<ChatSessionStateResponse | null>;
}

type PendingSubmission = {
  id: string;
  message: UIMessage;
};

function hydrateMessages(raw: ChatSessionStateResponse['messages']): UIMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => ({ id: m.id, role: m.role, parts: m.parts }));
}

function appendTextDelta(parts: UIMessage['parts'], delta: string): UIMessage['parts'] {
  if (!delta) return parts;
  const last = parts[parts.length - 1] as Record<string, unknown> | undefined;
  if (last?.type === 'text' && typeof last.text === 'string') {
    return [...parts.slice(0, -1), { type: 'text', text: `${last.text}${delta}` }];
  }
  return [...parts, { type: 'text', text: delta }];
}

function upsertToolPart(
  parts: UIMessage['parts'],
  update: {
    toolCallId: string;
    toolName?: string;
    state: 'input-available' | 'output-available' | 'output-error';
    input?: unknown;
    output?: unknown;
    preliminary?: boolean;
    errorText?: string;
  },
): UIMessage['parts'] {
  const idx = parts.findIndex((part) => {
    const typed = part as Record<string, unknown>;
    return typed?.type === 'tool-invocation' && typed?.toolCallId === update.toolCallId;
  });

  const merged = {
    ...(idx >= 0 ? (parts[idx] as Record<string, unknown>) : {}),
    type: 'tool-invocation' as const,
    toolCallId: update.toolCallId,
    ...(update.toolName ? { toolName: update.toolName } : {}),
    state: update.state,
    ...(update.input !== undefined ? { input: update.input } : {}),
    ...(update.output !== undefined ? { output: update.output } : {}),
    ...(update.preliminary !== undefined ? { preliminary: update.preliminary } : {}),
    ...(update.errorText ? { errorText: update.errorText } : {}),
  } as UIMessage['parts'][number];

  if (idx < 0) return [...parts, merged];
  const next = [...parts];
  next[idx] = merged;
  return next;
}

function normalizeChunk(rawChunk: unknown): Record<string, unknown> | null {
  if (!rawChunk || typeof rawChunk !== 'object') return null;
  const outer = rawChunk as Record<string, unknown>;
  const inner =
    outer.chunk && typeof outer.chunk === 'object'
      ? (outer.chunk as Record<string, unknown>)
      : outer;

  return {
    ...inner,
    ...(inner.turnId === undefined ? { turnId: outer.turnId } : {}),
    ...(inner.seq === undefined ? { seq: outer.seq } : {}),
    ...(inner.generationId === undefined ? { generationId: outer.generationId } : {}),
    ...(inner.runId === undefined ? { runId: outer.runId } : {}),
  };
}

export function useDurableChat(options: UseDurableChatOptions): UseDurableChatReturn {
  const { transport, sessionId, onChunk, onStateRefresh } = options;

  const [messages, setMessagesState] = useState<UIMessage[]>([]);
  const [status, setStatus] = useState<DurableChatStatus>('ready');
  const [error, setError] = useState<Error | null>(null);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;
  const onStateRefreshRef = useRef(onStateRefresh);
  onStateRefreshRef.current = onStateRefresh;

  const lastSeqRef = useRef(0);
  const activeGenerationRef = useRef(0);
  const activeTurnRef = useRef<string | null>(null);
  const lastKnownRunningTurnRef = useRef<string | null>(null);
  const pendingSubmissionsRef = useRef<Map<string, PendingSubmission>>(new Map());
  const ignoredTurnIdsRef = useRef<Set<string>>(new Set());

  const commitMessages = useCallback((next: UIMessage[]) => {
    messagesRef.current = next;
    setMessagesState(next);
  }, []);

  const rebuildWithPending = useCallback((base: UIMessage[]) => {
    const pending = [...pendingSubmissionsRef.current.values()].map((entry) => entry.message);
    return pending.length > 0 ? [...base, ...pending] : base;
  }, []);

  const refreshState = useCallback(
    async (sid?: string): Promise<ChatSessionStateResponse | null> => {
      const target = sid ?? sessionIdRef.current;
      if (!target) return null;

      const state = await transport.getState(target);
      if (!state || sessionIdRef.current !== target) return state;

      const incomingSeq = Math.max(0, state.afterSeq ?? state.lastSeq ?? 0);
      const previousSeq = lastSeqRef.current;
      lastSeqRef.current = Math.max(lastSeqRef.current, incomingSeq);
      activeGenerationRef.current = Math.max(
        activeGenerationRef.current,
        Number(state.activeGeneration ?? state.generationId ?? 0),
      );
      activeTurnRef.current = state.activeTurn?.turnId ?? null;
      lastKnownRunningTurnRef.current =
        state.activeTurn?.turnId ??
        state.queue?.find((turn) => turn.status === 'running')?.turnId ??
        null;

      const hydrated = hydrateMessages(state.messages);
      const merged = rebuildWithPending(hydrated);
      if (
        incomingSeq > previousSeq ||
        pendingSubmissionsRef.current.size > 0 ||
        JSON.stringify(merged) !== JSON.stringify(messagesRef.current)
      ) {
        commitMessages(merged);
      }

      const isProcessing =
        state.processingStatus === 'processing' || state.processingStatus === 'stopping';
      setStatus(isProcessing ? 'streaming' : 'ready');
      onStateRefreshRef.current?.(state);
      return state;
    },
    [commitMessages, rebuildWithPending, transport],
  );

  const applyChunk = useCallback(
    (rawChunk: unknown) => {
      const chunk = normalizeChunk(rawChunk);
      if (!chunk) return;

      const seq = typeof chunk.seq === 'number' ? chunk.seq : null;
      if (seq != null) {
        if (seq <= lastSeqRef.current) return;
        lastSeqRef.current = seq;
      }

      const generation = Number(chunk.generationId ?? (chunk.data as any)?.generationId ?? 0);
      if (Number.isFinite(generation) && generation > 0) {
        if (generation < activeGenerationRef.current) {
          return;
        }
        activeGenerationRef.current = Math.max(activeGenerationRef.current, generation);
      }

      const turnId = typeof chunk.turnId === 'string' ? chunk.turnId : null;
      if (turnId && ignoredTurnIdsRef.current.has(turnId)) {
        return;
      }

      if (turnId && activeTurnRef.current && turnId !== activeTurnRef.current) {
        const type = typeof chunk.type === 'string' ? chunk.type : null;
        if (type !== 'data-turn-status') {
          return;
        }
      }

      const type = typeof chunk.type === 'string' ? chunk.type : null;
      if (!type) return;

      if (type === 'data-turn-status') {
        const data =
          chunk.data && typeof chunk.data === 'object'
            ? (chunk.data as Record<string, unknown>)
            : ({} as Record<string, unknown>);
        const turnStatus = typeof data.status === 'string' ? data.status : null;
        const clientSubmissionId =
          typeof data.clientSubmissionId === 'string' ? data.clientSubmissionId : null;

        if (clientSubmissionId && pendingSubmissionsRef.current.has(clientSubmissionId)) {
          pendingSubmissionsRef.current.delete(clientSubmissionId);
          void refreshState();
        }

        if (turnStatus === 'running' && turnId) {
          activeTurnRef.current = turnId;
          setStatus('streaming');
        }

        if (
          turnStatus === 'completed' ||
          turnStatus === 'interrupted' ||
          turnStatus === 'failed' ||
          turnStatus === 'cancelled'
        ) {
          if (!turnId || activeTurnRef.current === turnId) {
            activeTurnRef.current = null;
          }
          setStatus('ready');
          void refreshState();
        }
        return;
      }

      if (!turnId) return;
      activeTurnRef.current = turnId;
      lastKnownRunningTurnRef.current = turnId;

      const turnMessageId = `turn-${turnId}`;
      const current = messagesRef.current;
      const idx = current.findIndex((m) => m.id === turnMessageId);

      if (type === 'text-delta') {
        const delta = typeof chunk.delta === 'string' ? chunk.delta : '';
        if (!delta) return;

        const next = [...current];
        if (idx >= 0) {
          next[idx] = { ...next[idx], parts: appendTextDelta(next[idx].parts, delta) };
        } else {
          next.push({ id: turnMessageId, role: 'assistant', parts: [{ type: 'text', text: delta }] });
        }
        commitMessages(next);
        setStatus('streaming');
        return;
      }

      if (
        type === 'tool-input-start' ||
        type === 'tool-input-available' ||
        type === 'tool-output-available' ||
        type === 'tool-output-error'
      ) {
        const toolCallId = typeof chunk.toolCallId === 'string' ? chunk.toolCallId : null;
        if (!toolCallId) return;
        const toolName = typeof chunk.toolName === 'string' ? chunk.toolName : undefined;
        const update =
          type === 'tool-input-start'
            ? { toolCallId, toolName, state: 'input-available' as const }
            : type === 'tool-input-available'
              ? { toolCallId, toolName, state: 'input-available' as const, input: chunk.input }
              : type === 'tool-output-available'
                ? {
                    toolCallId,
                    toolName,
                    state: 'output-available' as const,
                    output: chunk.output,
                    preliminary: chunk.preliminary === true,
                  }
                : {
                    toolCallId,
                    toolName,
                    state: 'output-error' as const,
                    output: chunk.output,
                    errorText: typeof chunk.errorText === 'string' ? chunk.errorText : undefined,
                  };

        const next = [...current];
        if (idx >= 0) {
          next[idx] = { ...next[idx], parts: upsertToolPart(next[idx].parts, update) };
        } else {
          next.push({ id: turnMessageId, role: 'assistant', parts: upsertToolPart([], update) });
        }
        commitMessages(next);
        setStatus('streaming');
      }
    },
    [commitMessages, refreshState],
  );

  useEffect(() => {
    const unsubscribe = transport.onSessionChunk((chunk) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const c = chunk as Record<string, unknown>;
      const runId = typeof c.runId === 'string' ? c.runId : undefined;
      onChunkRef.current?.(chunk, { sessionId: sid, runId });
      applyChunk(chunk);
    });
    return unsubscribe;
  }, [applyChunk, transport]);

  useEffect(() => {
    pendingSubmissionsRef.current.clear();
    ignoredTurnIdsRef.current.clear();
    lastSeqRef.current = 0;
    activeGenerationRef.current = 0;
    activeTurnRef.current = null;
    lastKnownRunningTurnRef.current = null;
    setError(null);

    if (!sessionId) {
      commitMessages([]);
      setStatus('ready');
      transport.closeSessionStream();
      return;
    }

    let cancelled = false;
    void (async () => {
      const state = await refreshState(sessionId);
      if (cancelled || sessionIdRef.current !== sessionId) return;
      const afterSeq = Math.max(0, state?.afterSeq ?? state?.lastSeq ?? 0);
      await transport.openSessionStream(sessionId, afterSeq);
      if (cancelled || sessionIdRef.current !== sessionId) return;
      void refreshState(sessionId);
    })().catch((err) => {
      if (!cancelled && sessionIdRef.current === sessionId) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [commitMessages, refreshState, sessionId, transport]);

  useEffect(() => {
    return () => {
      transport.closeSessionStream();
    };
  }, [transport]);

  const sendMessage = useCallback(
    (opts: { text: string; sessionId?: string }) => {
      const sid = opts.sessionId ?? sessionIdRef.current;
      if (!sid) return;

      const text = opts.text.trim();
      if (!text) return;

      const clientSubmissionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const optimisticMessage: UIMessage = {
        id: `pending-${clientSubmissionId}`,
        role: 'user',
        parts: [{ type: 'text', text }],
      };

      pendingSubmissionsRef.current.set(clientSubmissionId, {
        id: clientSubmissionId,
        message: optimisticMessage,
      });

      if (activeTurnRef.current) {
        ignoredTurnIdsRef.current.add(activeTurnRef.current);
      }
      if (lastKnownRunningTurnRef.current) {
        ignoredTurnIdsRef.current.add(lastKnownRunningTurnRef.current);
      }

      commitMessages([...messagesRef.current, optimisticMessage]);
      setStatus('submitting');
      setError(null);

      void (async () => {
        try {
          await transport.sendMessages({
            trigger: 'submit-message',
            chatId: sid,
            messageId: clientSubmissionId,
            messages: [...messagesRef.current, optimisticMessage],
          });
          setStatus('streaming');
        } catch (err) {
          pendingSubmissionsRef.current.delete(clientSubmissionId);
          if (sessionIdRef.current === sid) {
            commitMessages(messagesRef.current.filter((m) => m.id !== optimisticMessage.id));
            setError(err instanceof Error ? err : new Error(String(err)));
            setStatus('error');
          }
        }
      })();
    },
    [commitMessages, transport],
  );

  return {
    messages,
    status,
    error,
    sendMessage,
    setMessages: (msgs) => commitMessages(msgs),
    refreshState: () => refreshState(),
  };
}

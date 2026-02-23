import { useState, useEffect, useCallback, useRef } from 'react';
import { API_V1_URL, getApiAuthHeaders } from '@/services/api';
import type { UIMessage } from 'ai';

interface ReconnectState {
  parts: unknown[];
  isStreaming: boolean;
  runId: string | null;
  lastSeq: number;
}

interface StatusResponse {
  processingStatus: 'idle' | 'processing';
  activeRunId?: string | null;
}

const STATUS_POLL_INTERVAL_MS = 1000;

function applyStreamEvent(parts: unknown[], event: any): unknown[] {
  if (event.type === 'text-delta' && typeof event.text === 'string') {
    const next = [...parts];
    const lastPart = next[next.length - 1] as any;
    if (lastPart?.type === 'text') {
      next[next.length - 1] = { ...lastPart, text: `${lastPart.text ?? ''}${event.text}` };
    } else {
      next.push({ type: 'text', text: event.text });
    }
    return next;
  }

  if (event.type === 'tool-call') {
    const next = [...parts];
    const existingIndex = next.findIndex(
      (part: any) => part?.type === 'tool-invocation' && part.toolCallId === event.toolCallId,
    );
    const invocation = {
      type: 'tool-invocation',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      state: 'input-available',
      input: event.args ?? {},
    };
    if (existingIndex >= 0) {
      const existing = next[existingIndex] as any;
      next[existingIndex] = {
        ...existing,
        ...invocation,
        input: event.args ?? existing.input ?? {},
      };
    } else {
      next.push(invocation);
    }
    return next;
  }

  if (
    event.type === 'tool-result' ||
    event.type === 'tool-progress' ||
    event.type === 'tool-error'
  ) {
    const next = [...parts];
    const existingIndex = next.findIndex(
      (part: any) => part?.type === 'tool-invocation' && part.toolCallId === event.toolCallId,
    );

    const ensureInvocation = () => ({
      type: 'tool-invocation',
      toolCallId: event.toolCallId,
      toolName: event.toolName ?? 'tool',
      state: 'input-available',
      input: {},
    });

    if (existingIndex < 0) {
      next.push(ensureInvocation());
    }

    const targetIndex = existingIndex >= 0 ? existingIndex : next.length - 1;
    const existing = next[targetIndex] as any;

    if (event.type === 'tool-error') {
      next[targetIndex] = {
        ...existing,
        state: 'output-error',
        errorText: typeof event.errorText === 'string' ? event.errorText : 'Tool execution failed',
      };
      return next;
    }

    const output = event.type === 'tool-result' ? event.result : event.output;
    next[targetIndex] = {
      ...existing,
      state: 'output-available',
      output,
      preliminary: event.type === 'tool-progress' || event.preliminary === true,
    };
    return next;
  }

  return parts;
}

export function useChatReconnect(sessionId: string | null) {
  const [state, setState] = useState<ReconnectState | null>(null);
  const stateRef = useRef<ReconnectState | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    statusAbortRef.current?.abort();
    statusAbortRef.current = null;
  }, []);

  const attachRunStream = useCallback(
    async (
      targetSessionId: string,
      runId: string,
      afterSeq: number,
      headers: Record<string, string>,
    ) => {
      stopStreaming();
      const streamAbort = new AbortController();
      streamAbortRef.current = streamAbort;

      setState((prev) => {
        if (prev && prev.runId === runId) {
          return { ...prev, isStreaming: true };
        }
        return {
          parts: [],
          isStreaming: true,
          runId,
          lastSeq: afterSeq,
        };
      });

      try {
        const streamRes = await fetch(
          `${API_V1_URL}/chat/sessions/${targetSessionId}/stream?format=sse&runId=${encodeURIComponent(runId)}&afterSeq=${afterSeq}`,
          {
            headers,
            signal: streamAbort.signal,
          },
        );

        if (!streamRes.ok || !streamRes.body) {
          setState((prev) =>
            prev && prev.runId === runId ? { ...prev, isStreaming: false } : prev,
          );
          return;
        }

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              setState((prev) =>
                prev && prev.runId === runId ? { ...prev, isStreaming: false } : prev,
              );
              return;
            }

            try {
              const event = JSON.parse(data) as Record<string, any>;
              if (typeof event.runId === 'string' && event.runId !== runId) {
                continue;
              }

              setState((prev) => {
                const current: ReconnectState =
                  prev && prev.runId === runId
                    ? prev
                    : { parts: [], isStreaming: true, runId, lastSeq: afterSeq };
                const seq = typeof event.seq === 'number' ? event.seq : current.lastSeq;
                if (typeof event.seq === 'number' && event.seq <= current.lastSeq) {
                  return current;
                }
                return {
                  ...current,
                  parts: applyStreamEvent(current.parts, event),
                  lastSeq: seq,
                  isStreaming: !(event.type === 'status' && event.status === 'idle'),
                };
              });
            } catch {
              // Ignore malformed events
            }
          }
        }
      } catch {
        // Stream interrupted (navigation, abort, network)
      } finally {
        setState((prev) => (prev && prev.runId === runId ? { ...prev, isStreaming: false } : prev));
      }
    },
    [stopStreaming],
  );

  useEffect(() => {
    if (!sessionId) {
      stopPolling();
      stopStreaming();
      setState(null);
      return;
    }

    let cancelled = false;
    const statusAbort = new AbortController();
    statusAbortRef.current = statusAbort;

    (async () => {
      try {
        const headers = await getApiAuthHeaders();

        const checkStatus = async () => {
          if (cancelled) return;
          try {
            const res = await fetch(`${API_V1_URL}/chat/sessions/${sessionId}/status`, {
              headers,
              signal: statusAbort.signal,
            });
            if (!res.ok || cancelled) return;

            const status = (await res.json()) as StatusResponse;
            const activeRunId = typeof status.activeRunId === 'string' ? status.activeRunId : null;

            if (status.processingStatus === 'processing' && activeRunId) {
              const current = stateRef.current;
              const runChanged = current?.runId !== activeRunId;
              const afterSeq = runChanged ? 0 : (current?.lastSeq ?? 0);

              if (runChanged || !streamAbortRef.current) {
                void attachRunStream(sessionId, activeRunId, afterSeq, headers);
              }
              return;
            }

            setState((prev) => (prev ? { ...prev, isStreaming: false } : prev));
          } catch {
            // Ignore polling errors; next interval will retry
          }
        };

        await checkStatus();
        pollIntervalRef.current = window.setInterval(() => {
          void checkStatus();
        }, STATUS_POLL_INTERVAL_MS);
      } catch {
        setState(null);
      }
    })();

    return () => {
      cancelled = true;
      stopPolling();
      stopStreaming();
      setState(null);
    };
  }, [sessionId, attachRunStream, stopPolling, stopStreaming]);

  const partialMessage =
    state && state.parts.length > 0
      ? ({
          id: `partial-${sessionId}-${state.runId ?? 'none'}`,
          role: 'assistant' as const,
          parts: state.parts as UIMessage['parts'],
        } as UIMessage)
      : null;

  return {
    partialMessage,
    isReconnecting: state?.isStreaming ?? false,
    hasPartial: Boolean(state && state.parts.length > 0),
  };
}

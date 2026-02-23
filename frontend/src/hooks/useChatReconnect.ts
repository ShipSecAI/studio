import { useState, useEffect, useCallback, useRef } from 'react';
import { API_V1_URL, getApiAuthHeaders } from '@/services/api';
import type { UIMessage } from 'ai';

interface PartialResponseState {
  /** Parts from the in-flight assistant response, read from Postgres */
  parts: unknown[];
  /** Whether we're currently connected to the live pub/sub stream */
  isStreaming: boolean;
}

/**
 * Hook that enables reconnecting to an in-progress chat stream after
 * page refresh or when opening in a second tab.
 *
 * On mount (or when sessionId changes):
 * 1. Checks GET /status — if 'processing', the AI is still generating
 * 2. Fetches GET /partial — accumulated response so far from Postgres
 * 3. Opens GET /stream (SSE) — subscribes to live pub/sub deltas
 * 4. Merges partial + live deltas into a synthetic assistant message
 *
 * Returns the partial message to render, and a flag indicating if a
 * reconnected stream is active.
 */
export function useChatReconnect(sessionId: string | null) {
  const [partialState, setPartialState] = useState<PartialResponseState | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cleanup = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setPartialState(null);
      return;
    }

    const abortController = new AbortController();
    abortRef.current = abortController;

    (async () => {
      try {
        const headers = await getApiAuthHeaders();

        // Step 1: Check processing status
        const statusRes = await fetch(`${API_V1_URL}/chat/sessions/${sessionId}/status`, {
          headers,
          signal: abortController.signal,
        });
        if (!statusRes.ok || abortController.signal.aborted) return;
        const { processingStatus } = await statusRes.json();

        if (processingStatus !== 'processing') {
          setPartialState(null);
          return;
        }

        // Step 2: Fetch partial response from Postgres
        let initialParts: unknown[] = [];
        try {
          const partialRes = await fetch(`${API_V1_URL}/chat/sessions/${sessionId}/partial`, {
            headers,
            signal: abortController.signal,
          });
          if (partialRes.ok) {
            const data = await partialRes.json();
            initialParts = data.parts ?? [];
          }
        } catch {
          // Partial may not exist yet — that's fine
        }

        if (abortController.signal.aborted) return;

        setPartialState({ parts: initialParts, isStreaming: true });

        // Step 3: Subscribe to live SSE stream
        // Note: EventSource doesn't support custom headers, so we use fetch + ReadableStream
        const streamRes = await fetch(
          `${API_V1_URL}/chat/sessions/${sessionId}/stream?format=sse`,
          { headers, signal: abortController.signal },
        );

        if (!streamRes.ok || !streamRes.body) {
          setPartialState((prev) => (prev ? { ...prev, isStreaming: false } : null));
          return;
        }

        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Read SSE events and update partial state
        const processStream = async () => {
          try {
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
                  setPartialState((prev) => (prev ? { ...prev, isStreaming: false } : null));
                  return;
                }

                try {
                  const event = JSON.parse(data);

                  if (event.type === 'text-delta' && typeof event.text === 'string') {
                    setPartialState((prev) => {
                      if (!prev) return prev;
                      const parts = [...prev.parts];
                      const lastPart = parts[parts.length - 1] as any;
                      if (lastPart?.type === 'text') {
                        parts[parts.length - 1] = { ...lastPart, text: lastPart.text + event.text };
                      } else {
                        parts.push({ type: 'text', text: event.text });
                      }
                      return { ...prev, parts };
                    });
                  } else if (event.type === 'tool-call') {
                    setPartialState((prev) => {
                      if (!prev) return prev;
                      const parts = [...prev.parts];
                      parts.push({
                        type: 'tool-invocation',
                        toolCallId: event.toolCallId,
                        toolName: event.toolName,
                        state: 'input-available',
                        input: event.args ?? {},
                      });
                      return { ...prev, parts };
                    });
                  } else if (event.type === 'tool-result') {
                    setPartialState((prev) => {
                      if (!prev) return prev;
                      const parts = prev.parts.map((p: any) =>
                        p.type === 'tool-invocation' && p.toolCallId === event.toolCallId
                          ? {
                              ...p,
                              state: 'output-available',
                              output: event.result,
                              preliminary: event.preliminary === true,
                            }
                          : p,
                      );
                      return { ...prev, parts };
                    });
                  } else if (event.type === 'tool-progress') {
                    setPartialState((prev) => {
                      if (!prev) return prev;
                      const parts = prev.parts.map((p: any) =>
                        p.type === 'tool-invocation' && p.toolCallId === event.toolCallId
                          ? {
                              ...p,
                              state: 'output-available',
                              output: event.output,
                              preliminary: true,
                            }
                          : p,
                      );
                      return { ...prev, parts };
                    });
                  } else if (event.type === 'tool-error') {
                    setPartialState((prev) => {
                      if (!prev) return prev;
                      const parts = prev.parts.map((p: any) =>
                        p.type === 'tool-invocation' && p.toolCallId === event.toolCallId
                          ? { ...p, state: 'output-error', errorText: event.errorText }
                          : p,
                      );
                      return { ...prev, parts };
                    });
                  } else if (event.type === 'status' && event.status === 'idle') {
                    setPartialState((prev) => (prev ? { ...prev, isStreaming: false } : null));
                    return;
                  }
                } catch {
                  // Ignore parse errors
                }
              }
            }
          } catch {
            // Stream ended (abort or network error)
          } finally {
            setPartialState((prev) => (prev ? { ...prev, isStreaming: false } : null));
          }
        };

        processStream();
      } catch {
        // Ignore errors on initial check
        setPartialState(null);
      }
    })();

    return () => {
      cleanup();
      setPartialState(null);
    };
  }, [sessionId, cleanup]);

  // Build a synthetic assistant UIMessage from the partial state
  const partialMessage = partialState?.parts?.length
    ? ({
        id: `partial-${sessionId}`,
        role: 'assistant' as const,
        parts: partialState.parts as UIMessage['parts'],
      } as UIMessage)
    : null;

  return {
    /** Synthetic assistant message with accumulated partial response */
    partialMessage,
    /** Whether we're attached to a reconnected live stream */
    isReconnecting: partialState?.isStreaming ?? false,
    /** Whether we have any partial state (even after stream ends) */
    hasPartial: partialState !== null && (partialState.parts?.length ?? 0) > 0,
  };
}

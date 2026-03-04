import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';

export interface DurableChatTransportOptions {
  apiBase: string;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

interface StatusResponse {
  processingStatus: 'idle' | 'processing';
  activeRunId?: string | null;
  pendingCount?: number;
  generationId?: number | null;
}

interface SendMessageResponse {
  runId?: string;
  queued?: boolean;
  activeRunId?: string;
}

/**
 * Custom ChatTransport for multi-client durable streaming.
 *
 * How it works:
 * 1. sendMessages: POSTs the message, gets runId, then GETs the stream
 * 2. reconnectToStream: Checks for active run, then GETs the stream
 *
 * Both paths use the same GET /stream endpoint, ensuring all clients
 * (sender, late-joiners, refreshers) receive identical event streams.
 */
export class DurableChatTransport implements ChatTransport<UIMessage> {
  constructor(private options: DurableChatTransportOptions) {}
  private isEphemeralChatId(chatId: string): boolean {
    return chatId.startsWith('new-') || chatId.startsWith('chat-');
  }

  async sendMessages(options: {
    trigger: 'submit-message' | 'regenerate-message';
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal?: AbortSignal;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const { chatId: sessionId, messages, abortSignal } = options;
    const lastMessage = messages[messages.length - 1];

    const headers = await this.options.getAuthHeaders();

    // Step 1: POST the message - just signals the workflow, returns runId
    const postRes = await fetch(`${this.options.apiBase}/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ messages: [lastMessage] }),
      signal: abortSignal,
    });

    if (!postRes.ok) {
      const errorText = await postRes.text().catch(() => 'Unknown error');
      throw new Error(`Failed to send message: ${postRes.status} - ${errorText}`);
    }

    const responseData = (await postRes.json()) as SendMessageResponse;

    if (responseData.queued) {
      // Message was queued — return an empty stream that closes immediately.
      // The polling loop in ChatInterface will detect the generation transition
      // and reconnect to the new stream when it starts.
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.close();
        },
      });
    }

    if (!responseData.runId) {
      throw new Error('No runId in response and message was not queued');
    }

    // Step 2: GET the stream - unified streaming path
    return this.fetchStream(sessionId, responseData.runId, 0, headers);
  }

  async reconnectToStream(
    options: {
      chatId: string;
      runId?: string | null;
      afterSeq?: number;
    },
    signal?: AbortSignal,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const { chatId: sessionId, runId, afterSeq = 0 } = options;
    if (this.isEphemeralChatId(sessionId)) {
      return null;
    }

    const headers = await this.options.getAuthHeaders();

    // If caller already knows the runId, skip the extra status fetch.
    if (runId) {
      return this.fetchStream(sessionId, runId, afterSeq, headers, signal);
    }

    // Step 1: Check if there's an active stream
    const statusRes = await fetch(`${this.options.apiBase}/chat/sessions/${sessionId}/status`, {
      headers,
      signal,
    });

    if (!statusRes.ok) {
      return null;
    }

    const { processingStatus, activeRunId } = (await statusRes.json()) as StatusResponse;

    if (processingStatus !== 'processing' || !activeRunId) {
      return null; // No active stream to reconnect to
    }

    // Step 2: GET the stream from the beginning
    return this.fetchStream(sessionId, activeRunId, 0, headers, signal);
  }

  async interruptGeneration(sessionId: string): Promise<{ success: boolean }> {
    const headers = await this.options.getAuthHeaders();
    const res = await fetch(`${this.options.apiBase}/chat/sessions/${sessionId}/interrupt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
    });
    if (!res.ok) {
      return { success: false };
    }
    return (await res.json()) as { success: boolean };
  }

  async getStatus(sessionId: string): Promise<StatusResponse | null> {
    if (this.isEphemeralChatId(sessionId)) return null;
    const headers = await this.options.getAuthHeaders();
    const res = await fetch(`${this.options.apiBase}/chat/sessions/${sessionId}/status`, {
      headers,
    });
    if (!res.ok) return null;
    return (await res.json()) as StatusResponse;
  }

  /**
   * Fetches the SSE stream and converts it to a ReadableStream<UIMessageChunk>.
   *
   * This is the unified streaming path used by:
   * - Tab 1 after sending a message
   * - Tab 2+ joining mid-stream
   * - Any tab after refresh
   */
  private fetchStream(
    sessionId: string,
    runId: string,
    afterSeq: number,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): ReadableStream<UIMessageChunk> {
    const url = new URL(
      `${this.options.apiBase}/chat/sessions/${sessionId}/stream`,
      window.location.origin,
    );
    url.searchParams.set('runId', runId);
    url.searchParams.set('afterSeq', String(afterSeq));

    const textDecoder = new TextDecoder();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        const pendingTextDeltas = new Map<string, string>();
        const pendingReasoningDeltas = new Map<string, string>();
        const pendingToolInputDeltas = new Map<string, string>();
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        const FLUSH_INTERVAL_MS = 120;

        const clearFlushTimer = () => {
          if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
        };

        const flushPendingDeltas = () => {
          clearFlushTimer();

          if (pendingTextDeltas.size > 0) {
            for (const [id, delta] of pendingTextDeltas) {
              controller.enqueue({ type: 'text-delta', id, delta });
            }
            pendingTextDeltas.clear();
          }

          if (pendingReasoningDeltas.size > 0) {
            for (const [id, delta] of pendingReasoningDeltas) {
              controller.enqueue({ type: 'reasoning-delta', id, delta });
            }
            pendingReasoningDeltas.clear();
          }

          if (pendingToolInputDeltas.size > 0) {
            for (const [toolCallId, inputTextDelta] of pendingToolInputDeltas) {
              controller.enqueue({ type: 'tool-input-delta', toolCallId, inputTextDelta });
            }
            pendingToolInputDeltas.clear();
          }
        };

        const scheduleFlush = () => {
          if (flushTimer !== null) {
            return;
          }
          flushTimer = setTimeout(() => {
            flushTimer = null;
            flushPendingDeltas();
          }, FLUSH_INTERVAL_MS);
        };

        const handleChunk = (chunk: UIMessageChunk | 'DONE'): 'continue' | 'done' => {
          if (chunk === 'DONE') {
            flushPendingDeltas();
            controller.close();
            return 'done';
          }

          if (chunk.type === 'text-delta') {
            pendingTextDeltas.set(chunk.id, (pendingTextDeltas.get(chunk.id) ?? '') + chunk.delta);
            scheduleFlush();
            return 'continue';
          }

          if (chunk.type === 'reasoning-delta') {
            pendingReasoningDeltas.set(
              chunk.id,
              (pendingReasoningDeltas.get(chunk.id) ?? '') + chunk.delta,
            );
            scheduleFlush();
            return 'continue';
          }

          if (chunk.type === 'tool-input-delta') {
            pendingToolInputDeltas.set(
              chunk.toolCallId,
              (pendingToolInputDeltas.get(chunk.toolCallId) ?? '') + chunk.inputTextDelta,
            );
            scheduleFlush();
            return 'continue';
          }

          // Preserve event ordering by flushing accumulated deltas before
          // non-delta chunks (tool boundaries, step markers, finish, etc).
          flushPendingDeltas();
          controller.enqueue(chunk);
          return 'continue';
        };

        try {
          const res = await fetch(url.toString(), { headers, signal });

          if (!res.ok) {
            controller.error(new Error(`Stream fetch failed: ${res.status}`));
            return;
          }

          if (!res.body) {
            controller.error(new Error('No response body'));
            return;
          }

          reader = res.body.getReader();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // Flush any remaining buffer and pending delta batches.
              if (buffer.trim().length > 0) {
                const lines = buffer.split('\n');
                for (const line of lines) {
                  const chunk = this.parseSseLine(line);
                  if (!chunk) continue;
                  const state = handleChunk(chunk);
                  if (state === 'done') {
                    return;
                  }
                }
              }
              flushPendingDeltas();
              controller.close();
              return;
            }

            buffer += textDecoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const chunk = this.parseSseLine(line);
              if (!chunk) continue;

              const state = handleChunk(chunk);
              if (state === 'done') {
                return;
              }
            }
          }
        } catch (error) {
          clearFlushTimer();
          controller.error(error instanceof Error ? error : new Error(String(error)));
        }
      },
      cancel() {
        reader?.cancel();
      },
    });
  }

  private parseSseLine(line: string): UIMessageChunk | 'DONE' | null {
    if (!line.startsWith('data: ')) {
      return null;
    }

    const data = line.slice(6).trim();

    if (data === '[DONE]') {
      return 'DONE';
    }

    try {
      return JSON.parse(data) as UIMessageChunk;
    } catch {
      return null;
    }
  }
}

import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';

export interface DurableChatTransportOptions {
  apiBase: string;
  getAuthHeaders: () => Promise<Record<string, string>>;
  onChunk?: (chunk: unknown, context: { sessionId: string; runId: string }) => void;
  onQueuedTurn?: (response: SendTurnResponse & { clientMessageId?: string }) => void;
}

export interface QueueTurnIdentity {
  turnId?: string;
  clientMessageId?: string | null;
  queuePosition?: number | null;
  status?: string;
  queuedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ChatSessionStateResponse {
  messages?: {
    id: string;
    role: UIMessage['role'];
    parts: UIMessage['parts'];
    createdAt?: string;
  }[];
  afterSeq?: number;
  lastSeq?: number;
  processingStatus: 'idle' | 'processing';
  activeRunId?: string | null;
  activeRunStartedAt?: string | null;
  pendingCount?: number;
  generationId?: number | null;
  steerTargetTurnId?: string | null;
  queue?: QueueTurnIdentity[];
  queuedTurns?: QueueTurnIdentity[];
}

export interface SendTurnResponse {
  runId?: string;
  queued?: boolean;
  activeRunId?: string | null;
  turnId?: string;
  queuePosition?: number | null;
  pendingCount?: number;
  generationId?: number | null;
  steerTargetTurnId?: string | null;
  afterSeq?: number;
  lastSeq?: number;
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

  private getLastUserText(message: UIMessage | undefined): string {
    if (!message) {
      return '';
    }
    return message.parts
      .filter((part): part is Extract<UIMessage['parts'][number], { type: 'text' }> => {
        return part.type === 'text';
      })
      .map((part) => part.text)
      .join('');
  }

  async sendMessages(options: {
    trigger: 'submit-message' | 'regenerate-message';
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal?: AbortSignal;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const { chatId: sessionId, messages, messageId, abortSignal } = options;
    const lastMessage = messages[messages.length - 1];

    const headers = await this.options.getAuthHeaders();
    const clientMessageId = messageId ?? lastMessage?.id;
    const message = this.getLastUserText(lastMessage);

    // Step 1: POST the turn and get run attachment info.
    const postRes = await fetch(`${this.options.apiBase}/chat/sessions/${sessionId}/turns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ message, clientMessageId }),
      signal: abortSignal,
    });

    if (!postRes.ok) {
      const errorText = await postRes.text().catch(() => 'Unknown error');
      throw new Error(`Failed to send message: ${postRes.status} - ${errorText}`);
    }

    const responseData = (await postRes.json()) as SendTurnResponse;

    if (responseData.queued) {
      this.options.onQueuedTurn?.({ ...responseData, clientMessageId });
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.close();
        },
      });
    }

    if (!responseData.runId) {
      throw new Error('No runId in response and turn was not queued');
    }

    // Step 2: GET the stream.
    const afterSeq = Math.max(0, responseData.afterSeq ?? responseData.lastSeq ?? 0);
    return this.fetchStream(sessionId, responseData.runId, afterSeq, headers);
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

    const state = await this.getState(sessionId, signal);
    if (!state || state.processingStatus !== 'processing' || !state.activeRunId) {
      return null;
    }

    const resolvedAfterSeq = Math.max(afterSeq, state.afterSeq ?? state.lastSeq ?? 0);
    return this.fetchStream(sessionId, state.activeRunId, resolvedAfterSeq, headers, signal);
  }

  async interruptTurn(sessionId: string, _turnId: string): Promise<{ success: boolean }> {
    return this.interruptGeneration(sessionId);
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
    const body = (await res.json()) as { success?: boolean; ok?: boolean };
    return { success: body.success ?? body.ok ?? false };
  }

  async steerTurn(sessionId: string, turnId: string): Promise<{ success: boolean }> {
    const headers = await this.options.getAuthHeaders();
    const res = await fetch(`${this.options.apiBase}/chat/sessions/${sessionId}/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ targetTurnId: turnId }),
    });
    if (!res.ok) {
      return { success: false };
    }
    const body = (await res.json()) as { success?: boolean; ok?: boolean };
    return { success: body.success ?? body.ok ?? false };
  }

  async getState(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<ChatSessionStateResponse | null> {
    if (this.isEphemeralChatId(sessionId)) return null;
    const headers = await this.options.getAuthHeaders();
    const res = await fetch(`${this.options.apiBase}/chat/sessions/${sessionId}/state`, {
      headers,
      signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as ChatSessionStateResponse;
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
        const handleChunk = (chunk: unknown | 'DONE'): 'continue' | 'done' => {
          if (chunk === 'DONE') {
            controller.close();
            return 'done';
          }

          this.options.onChunk?.(chunk, { sessionId, runId });
          // Pass raw stream chunks through without transport-side batching.
          controller.enqueue(chunk as UIMessageChunk);
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
          controller.error(error instanceof Error ? error : new Error(String(error)));
        }
      },
      cancel() {
        reader?.cancel();
      },
    });
  }

  private parseSseLine(line: string): unknown | 'DONE' | null {
    if (!line.startsWith('data: ')) {
      return null;
    }

    const data = line.slice(6).trim();

    if (data === '[DONE]') {
      return 'DONE';
    }

    try {
      return JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
}

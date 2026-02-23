import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';

export interface DurableChatTransportOptions {
  apiBase: string;
  getAuthHeaders: () => Promise<Record<string, string>>;
}

interface StatusResponse {
  processingStatus: 'idle' | 'processing';
  activeRunId?: string | null;
}

interface SendMessageResponse {
  runId: string;
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

    const { runId } = (await postRes.json()) as SendMessageResponse;

    // Step 2: GET the stream - unified streaming path
    return this.fetchStream(sessionId, runId, 0, headers);
  }

  async reconnectToStream(options: {
    chatId: string;
  }): Promise<ReadableStream<UIMessageChunk> | null> {
    const { chatId: sessionId } = options;

    const headers = await this.options.getAuthHeaders();

    // Step 1: Check if there's an active stream
    const statusRes = await fetch(`${this.options.apiBase}/chat/sessions/${sessionId}/status`, {
      headers,
    });

    if (!statusRes.ok) {
      return null;
    }

    const { processingStatus, activeRunId } = (await statusRes.json()) as StatusResponse;

    if (processingStatus !== 'processing' || !activeRunId) {
      return null; // No active stream to reconnect to
    }

    // Step 2: GET the stream from the beginning
    return this.fetchStream(sessionId, activeRunId, 0, headers);
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
  ): ReadableStream<UIMessageChunk> {
    const url = new URL(`${this.options.apiBase}/chat/sessions/${sessionId}/stream`);
    url.searchParams.set('runId', runId);
    url.searchParams.set('afterSeq', String(afterSeq));

    const textDecoder = new TextDecoder();

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        try {
          const res = await fetch(url.toString(), { headers });

          if (!res.ok) {
            controller.error(new Error(`Stream fetch failed: ${res.status}`));
            return;
          }

          if (!res.body) {
            controller.error(new Error('No response body'));
            return;
          }

          const reader = res.body.getReader();
          let buffer = '';

          const pump = async (): Promise<void> => {
            const { done, value } = await reader.read();

            if (done) {
              // Flush any remaining buffer
              if (buffer.trim()) {
                this.processBuffer(buffer, controller);
              }
              controller.close();
              return;
            }

            buffer += textDecoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const chunk = this.parseSseLine(line);
              if (chunk) {
                if (chunk === 'DONE') {
                  controller.close();
                  return;
                }
                controller.enqueue(chunk);
              }
            }

            return pump();
          };

          await pump();
        } catch (error) {
          controller.error(error instanceof Error ? error : new Error(String(error)));
        }
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

  private processBuffer(
    buffer: string,
    controller: ReadableStreamDefaultController<UIMessageChunk>,
  ): void {
    const lines = buffer.split('\n');
    for (const line of lines) {
      const chunk = this.parseSseLine(line);
      if (chunk) {
        if (chunk === 'DONE') {
          controller.close();
          return;
        }
        controller.enqueue(chunk);
      }
    }
  }
}

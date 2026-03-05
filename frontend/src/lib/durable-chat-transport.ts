import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';

export interface DurableChatTransportOptions {
  apiBase: string;
  getAuthHeaders: () => Promise<Record<string, string>>;
  onChunk?: (chunk: unknown, context: { sessionId: string; runId?: string }) => void;
  onQueuedTurn?: (
    response: SendTurnResponse & { clientMessageId?: string },
    context: { sessionId: string },
  ) => void;
}

export interface QueueTurnIdentity {
  turnId?: string;
  clientMessageId?: string | null;
  preview?: string | null;
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
  processingStatus: 'idle' | 'processing' | 'stopping';
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
  preview?: string | null;
  pendingCount?: number;
  generationId?: number | null;
  steerTargetTurnId?: string | null;
  afterSeq?: number;
  lastSeq?: number;
}

/**
 * Custom ChatTransport for multi-client durable streaming.
 *
 * Session-level SSE: A single long-lived SSE connection per session streams
 * ALL turn events. Per-turn ReadableStreams are created by filtering on turnId
 * and completing on terminal turn status.
 *
 * Cross-tab sync: Each tab maintains its own SSE connection. The backend
 * fans out all session events to every connected client via Redis pub/sub.
 */
export class DurableChatTransport implements ChatTransport<UIMessage> {
  // Session-level SSE state
  private sessionSseController: AbortController | null = null;
  private sessionEventTarget = new EventTarget();
  private sessionSseSessionId: string | null = null;
  private lastSeq = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private sseConnectedPromise: Promise<void> | null = null;

  constructor(private options: DurableChatTransportOptions) {}

  /** Subscribe to all SSE chunk events. Returns an unsubscribe function. */
  onSessionChunk(handler: (chunk: unknown) => void): () => void {
    const listener = (event: Event) => {
      handler((event as CustomEvent).detail);
    };
    this.sessionEventTarget.addEventListener('chunk', listener);
    return () => this.sessionEventTarget.removeEventListener('chunk', listener);
  }

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

  // ── Session SSE Management ──────────────────────────────────────────

  /**
   * Opens a long-lived SSE connection for the session. All turn events flow
   * through this single connection. Safe to call multiple times — will no-op
   * if already connected to the same session.
   *
   * Returns a promise that resolves once the SSE connection is established
   * (or immediately if already connected).
   */
  openSessionStream(sessionId: string, afterSeq = 0): Promise<void> {
    if (this.isEphemeralChatId(sessionId)) return Promise.resolve();
    if (this.sessionSseSessionId === sessionId && this.sessionSseController) {
      if (afterSeq > this.lastSeq) {
        this.lastSeq = afterSeq;
      }
      return this.sseConnectedPromise ?? Promise.resolve();
    }

    this.closeSessionStream();
    this.sessionSseSessionId = sessionId;
    this.lastSeq = afterSeq;
    this.reconnectAttempts = 0;
    this.sseConnectedPromise = this.startSse(sessionId);
    return this.sseConnectedPromise;
  }

  /** Closes the session SSE connection. */
  closeSessionStream(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.sessionSseController?.abort();
    this.sessionSseController = null;
    this.sessionSseSessionId = null;
  }

  /**
   * Creates a ReadableStream<UIMessageChunk> that filters session SSE events
   * for a specific turn. The stream closes when a terminal turn status is received.
   */
  createTurnStream(turnId: string): ReadableStream<UIMessageChunk> {
    const eventTarget = this.sessionEventTarget;

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        let closed = false;

        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearTimeout(timeout);
          eventTarget.removeEventListener('chunk', handler);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        };

        // Safety timeout: remove listener if no terminal event within 5 minutes
        const timeout = setTimeout(cleanup, 5 * 60 * 1000);

        const handler = (event: Event) => {
          if (closed) return;
          const chunk = (event as CustomEvent).detail;
          if (!chunk || typeof chunk !== 'object') return;

          const chunkTurnId = (chunk as Record<string, unknown>).turnId;
          if (chunkTurnId && chunkTurnId !== turnId) return;

          controller.enqueue(chunk as UIMessageChunk);

          // Close on terminal turn status
          if ((chunk as Record<string, unknown>).type === 'data-turn-status') {
            const data = (chunk as Record<string, unknown>).data;
            const status =
              data && typeof data === 'object' ? (data as Record<string, unknown>).status : null;
            if (
              status === 'completed' ||
              status === 'interrupted' ||
              status === 'failed' ||
              status === 'cancelled'
            ) {
              cleanup();
            }
          }

          if ((chunk as Record<string, unknown>).type === 'finish') {
            cleanup();
          }
        };

        eventTarget.addEventListener('chunk', handler);
      },
    });
  }

  /**
   * Start SSE connection. Resolves once the HTTP response is received
   * (connection established). The read loop continues in the background.
   */
  private async startSse(sessionId: string): Promise<void> {
    const controller = new AbortController();
    this.sessionSseController = controller;

    const headers = await this.options.getAuthHeaders();
    const url = new URL(
      `${this.options.apiBase}/chat/sessions/${sessionId}/stream`,
      window.location.origin,
    );
    url.searchParams.set('afterSeq', String(this.lastSeq));

    let res: Response;
    try {
      res = await fetch(url.toString(), { headers, signal: controller.signal });
      if (!res.ok || !res.body) {
        if (controller.signal.aborted) return;

        let retryAfterMs: number | undefined;
        const retryAfter = res.headers.get('retry-after');
        if (retryAfter) {
          const retryAfterSeconds = Number(retryAfter);
          if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
            retryAfterMs = retryAfterSeconds * 1000;
          } else {
            const retryAfterTime = Date.parse(retryAfter);
            if (Number.isFinite(retryAfterTime)) {
              retryAfterMs = Math.max(0, retryAfterTime - Date.now());
            }
          }
        }

        console.warn(
          `[DurableChatTransport] SSE connection rejected: ${res.status} ${res.statusText}`,
        );
        this.scheduleReconnect(sessionId, retryAfterMs);
        return;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[DurableChatTransport] SSE connection failed:', error);
      this.scheduleReconnect(sessionId);
      return;
    }

    // Connection established — run read loop in background (don't await)
    void this.readSseLoop(res.body, sessionId, controller);
  }

  private async readSseLoop(
    body: ReadableStream<Uint8Array>,
    sessionId: string,
    controller: AbortController,
  ): Promise<void> {
    const reader = body.getReader();
    const textDecoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (buffer.trim().length > 0) {
            for (const line of buffer.split('\n')) {
              this.handleSseLine(line, sessionId);
            }
          }
          break;
        }

        buffer += textDecoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          this.handleSseLine(line, sessionId);
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[DurableChatTransport] SSE read error:', error);
    }

    // Auto-reconnect if not explicitly closed
    this.scheduleReconnect(sessionId);
  }

  private scheduleReconnect(sessionId: string, overrideDelayMs?: number): void {
    if (this.sessionSseSessionId !== sessionId) return;
    if (this.sessionSseController?.signal.aborted) return;
    if (this.reconnectTimer) return;

    const fallbackDelay = Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000);
    const delay =
      overrideDelayMs != null && Number.isFinite(overrideDelayMs)
        ? Math.max(1000, Math.min(overrideDelayMs, 30000))
        : fallbackDelay;
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.sessionSseSessionId === sessionId) {
        this.sseConnectedPromise = this.startSse(sessionId);
      }
    }, delay);
  }

  private handleSseLine(line: string, sessionId: string): void {
    const parsed = this.parseSseLine(line);
    if (!parsed || parsed === 'DONE') return;

    // Reset backoff on any successful data
    this.reconnectAttempts = 0;

    const chunk = parsed as Record<string, unknown>;

    // Track seq for reconnect cursor
    const seq = typeof chunk.seq === 'number' ? chunk.seq : null;
    if (seq != null) {
      if (seq <= this.lastSeq) {
        return;
      }
      this.lastSeq = seq;
    }

    // Global onChunk handler (queue state updates, cursor tracking)
    const runId = typeof chunk.runId === 'string' ? chunk.runId : undefined;
    this.options.onChunk?.(chunk, { sessionId, runId });

    // Fan out to per-turn listeners
    this.sessionEventTarget.dispatchEvent(new CustomEvent('chunk', { detail: chunk }));
  }

  // ── ChatTransport Interface ─────────────────────────────────────────

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

    // POST the turn
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
      this.options.onQueuedTurn?.({ ...responseData, clientMessageId }, { sessionId });
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.close();
        },
      });
    }

    if (!responseData.turnId) {
      throw new Error('No turnId in response and turn was not queued');
    }

    // Create the per-turn stream FIRST so listener is ready before SSE replays
    const turnStream = this.createTurnStream(responseData.turnId);
    const afterSeq = Math.max(0, responseData.afterSeq ?? responseData.lastSeq ?? 0);
    await this.openSessionStream(sessionId, afterSeq);
    return turnStream;
  }

  async reconnectToStream(
    options: {
      chatId: string;
      turnId?: string | null;
      afterSeq?: number;
    },
    signal?: AbortSignal,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const { chatId: sessionId, turnId, afterSeq = 0 } = options;
    if (this.isEphemeralChatId(sessionId)) {
      return null;
    }

    if (turnId) {
      // Create listener before opening SSE so replay events are captured
      const turnStream = this.createTurnStream(turnId);
      await this.openSessionStream(sessionId, afterSeq);
      return turnStream;
    }

    const state = await this.getState(sessionId, signal);
    if (
      !state ||
      (state.processingStatus !== 'processing' && state.processingStatus !== 'stopping')
    ) {
      // Still open SSE for cross-tab sync even when idle
      void this.openSessionStream(sessionId, afterSeq);
      return null;
    }

    // Find active turn to attach to
    const activeTurn =
      state.queue?.find((t) => t.status === 'running') ??
      state.queuedTurns?.find((t) => t.status === 'running');
    if (!activeTurn?.turnId) {
      void this.openSessionStream(sessionId, afterSeq);
      return null;
    }

    // Create listener before opening SSE so replay events are captured
    const turnStream = this.createTurnStream(activeTurn.turnId);
    await this.openSessionStream(sessionId, afterSeq);
    return turnStream;
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

  async steerTurn(sessionId: string, turnId?: string): Promise<{ success: boolean }> {
    const headers = await this.options.getAuthHeaders();
    const res = await fetch(`${this.options.apiBase}/chat/sessions/${sessionId}/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(turnId ? { targetTurnId: turnId } : {}),
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

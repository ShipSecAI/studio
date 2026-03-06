import { expect } from 'bun:test';

import { API_BASE, HEADERS, e2eDescribe, e2eTest } from '../helpers/e2e-harness';

interface ThreadHistoryResponse {
  messages?: Array<{
    id: string;
    role: string;
    parts?: Array<{ type?: string; text?: string }>;
  }>;
  afterSeq?: number;
  lastSeq?: number;
  processingStatus?: 'idle' | 'processing' | 'stopping';
  activeTurn?: { turnId: string; status?: string } | null;
  queue?: Array<{ turnId?: string; status?: string }>;
  queuedTurns?: Array<{ turnId?: string; status?: string }>;
  pendingCount?: number;
}

interface StreamChunk {
  type?: string;
  turnId?: string;
  data?: {
    status?: string;
  };
  delta?: string;
}

async function createSession(title = 'Detachable Chat E2E'): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/sessions`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  const data = await res.json();
  expect(data.id).toBeTruthy();
  return data.id as string;
}

async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/sessions/${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  expect(res.ok).toBe(true);
}

async function getThreadHistory(sessionId: string): Promise<ThreadHistoryResponse> {
  const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/thread-history`, {
    headers: HEADERS,
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as ThreadHistoryResponse;
}

async function submitUserTurn(sessionId: string, text: string) {
  const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/submissions`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      op: 'UserTurn',
      text,
      clientSubmissionId: crypto.randomUUID(),
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as {
    turnId?: string;
    acceptedAtSeq?: number;
    generationId?: number;
  };
}

async function waitForQueuedState(
  sessionId: string,
  timeoutMs = 15_000,
): Promise<ThreadHistoryResponse> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await getThreadHistory(sessionId);
    const queuedTurns = state.queue ?? state.queuedTurns ?? [];
    const hasQueuedOrRunning =
      state.processingStatus === 'processing' ||
      state.activeTurn != null ||
      (state.pendingCount != null && state.pendingCount > 0) ||
      queuedTurns.some((turn) => turn.status === 'queued' || turn.status === 'running');

    if (hasQueuedOrRunning) {
      return state;
    }

    await Bun.sleep(250);
  }

  throw new Error(`Timed out waiting for queued state for session ${sessionId}`);
}

async function waitForSessionToConverge(
  sessionId: string,
  previousAfterSeq: number,
  timeoutMs = 120_000,
): Promise<ThreadHistoryResponse> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await getThreadHistory(sessionId);
    const currentAfterSeq = state.afterSeq ?? state.lastSeq ?? 0;
    if (state.processingStatus === 'idle' && currentAfterSeq > previousAfterSeq) {
      return state;
    }

    await Bun.sleep(1000);
  }

  throw new Error(`Timed out waiting for assistant reply for session ${sessionId}`);
}

async function collectInitialStreamEvents(
  sessionId: string,
  afterSeq: number,
  timeoutMs = 30_000,
): Promise<StreamChunk[]> {
  const events: StreamChunk[] = [];
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/stream?afterSeq=${afterSeq}`, {
      headers: HEADERS,
      signal: abortController.signal,
    });
    expect(res.ok).toBe(true);
    expect(res.body).toBeTruthy();

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) {
          continue;
        }

        const payload = line.slice(6).trim();
        if (!payload) {
          continue;
        }

        let parsed: StreamChunk | null = null;
        try {
          parsed = JSON.parse(payload) as StreamChunk;
        } catch {
          parsed = null;
        }

        if (!parsed) {
          continue;
        }

        events.push(parsed);
        abortController.abort();
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }

  return events;
}

e2eDescribe('Detachable Chat Sessions', () => {
  let sessionId: string;

  e2eTest(
    'hydrates from thread-history and streams durable turn events',
    { timeout: 180_000 },
    async () => {
      sessionId = await createSession('Detachable Durable Stream');

      const initialState = await getThreadHistory(sessionId);
      expect(initialState.processingStatus).toBe('idle');
      expect(initialState.messages ?? []).toHaveLength(0);

      const afterSeq = initialState.afterSeq ?? initialState.lastSeq ?? 0;
      const streamPromise = collectInitialStreamEvents(sessionId, afterSeq);

      const submitResult = await submitUserTurn(sessionId, 'Reply with exactly detachable-ok');
      expect(submitResult.turnId).toBeTruthy();

      const queuedState = await waitForQueuedState(sessionId);
      expect(['processing', 'stopping', 'idle']).toContain(queuedState.processingStatus);

      const streamEvents = await streamPromise;
      expect(streamEvents.length).toBeGreaterThan(0);
      expect(
        streamEvents.some(
          (event) => event.type === 'data-turn-status' && event.turnId === submitResult.turnId,
        ),
      ).toBe(true);

      const finalState = await waitForSessionToConverge(sessionId, afterSeq);
      expect(finalState.processingStatus).toBe('idle');
      expect((finalState.afterSeq ?? finalState.lastSeq ?? 0)).toBeGreaterThan(afterSeq);
      expect(finalState.queue ?? finalState.queuedTurns ?? []).toHaveLength(0);
      expect(
        (finalState.messages ?? []).some(
          (message) =>
            message.role === 'user' &&
            (message.parts ?? []).some((part) => part.type === 'text'),
        ),
      ).toBe(true);
    },
  );

  e2eTest('cleanup detachable chat session', async () => {
    if (!sessionId) {
      return;
    }
    await deleteSession(sessionId);
  });
});

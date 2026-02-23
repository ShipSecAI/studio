/**
 * E2E tests for Detachable Chat Sessions v2.
 *
 * Tests the lifecycle: create session → send message → check status/partial →
 * stream live events → verify completion cleanup.
 *
 * These tests require a running backend + worker + Redis + Postgres.
 * Run with: RUN_E2E=true bun test e2e-tests/core/chat-detachable.test.ts
 */

import { expect } from 'bun:test';

import { API_BASE, HEADERS, e2eDescribe, e2eTest } from '../helpers/e2e-harness';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createSession(title = 'E2E Test Session'): Promise<string> {
    const res = await fetch(`${API_BASE}/chat/sessions`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ title }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.processingStatus).toBe('idle');
    return data.id;
}

async function deleteSession(id: string): Promise<void> {
    await fetch(`${API_BASE}/chat/sessions/${id}`, {
        method: 'DELETE',
        headers: HEADERS,
    });
}

async function getStatus(sessionId: string): Promise<string> {
    const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/status`, {
        headers: HEADERS,
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    return data.processingStatus;
}

async function getPartial(sessionId: string): Promise<{ ok: boolean; parts?: unknown[] }> {
    const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/partial`, {
        headers: HEADERS,
    });
    if (res.status === 404) return { ok: false };
    expect(res.ok).toBe(true);
    const data = await res.json();
    return { ok: true, parts: data.parts };
}

async function upsertPartial(sessionId: string, parts: unknown[]): Promise<void> {
    const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/partial`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ parts }),
    });
    expect(res.ok).toBe(true);
}

async function completeSession(sessionId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/complete`, {
        method: 'POST',
        headers: HEADERS,
        body: '{}',
    });
    expect(res.ok).toBe(true);
}

/**
 * Collect SSE events from the /stream endpoint until DONE or timeout.
 */
async function collectStreamEvents(
    sessionId: string,
    timeoutMs = 5000,
): Promise<{ events: any[]; timedOut: boolean }> {
    const events: any[] = [];
    const abortController = new AbortController();

    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
        const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/stream?format=sse`, {
            headers: HEADERS,
            signal: abortController.signal,
        });

        if (!res.ok || !res.body) {
            clearTimeout(timer);
            return { events, timedOut: false };
        }

        const reader = res.body.getReader();
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
                    clearTimeout(timer);
                    return { events, timedOut: false };
                }
                try {
                    events.push(JSON.parse(data));
                } catch {
                    // ignore
                }
            }
        }

        clearTimeout(timer);
        return { events, timedOut: false };
    } catch {
        clearTimeout(timer);
        return { events, timedOut: true };
    }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

e2eDescribe('Detachable Chat Sessions v2', () => {
    let sessionId: string;

    e2eTest('create session has idle processing status', async () => {
        sessionId = await createSession('Detachable v2 Test');
        const status = await getStatus(sessionId);
        expect(status).toBe('idle');
    });

    e2eTest('partial response returns 404 when idle', async () => {
        const result = await getPartial(sessionId);
        expect(result.ok).toBe(false);
    });

    e2eTest('stream returns immediately when idle', async () => {
        const { events, timedOut } = await collectStreamEvents(sessionId, 3000);
        expect(timedOut).toBe(false);
        expect(events.length).toBeGreaterThanOrEqual(1);
        expect(events[0].type).toBe('status');
        expect(events[0].status).toBe('idle');
    });

    e2eTest('worker partial flush lifecycle', async () => {
        // Simulate what the worker does:
        // 1. Upsert partial response
        await upsertPartial(sessionId, [{ type: 'text', text: 'Hello, I am' }]);

        // 2. Verify partial is readable
        const partial1 = await getPartial(sessionId);
        expect(partial1.ok).toBe(true);
        expect(partial1.parts).toHaveLength(1);
        expect((partial1.parts![0] as any).text).toBe('Hello, I am');

        // 3. Update partial with more content
        await upsertPartial(sessionId, [{ type: 'text', text: 'Hello, I am ShipSec AI' }]);

        const partial2 = await getPartial(sessionId);
        expect(partial2.ok).toBe(true);
        expect((partial2.parts![0] as any).text).toBe('Hello, I am ShipSec AI');

        // 4. Complete session → partial is cleaned up, status goes idle
        await completeSession(sessionId);

        const partial3 = await getPartial(sessionId);
        expect(partial3.ok).toBe(false); // 404

        const status = await getStatus(sessionId);
        expect(status).toBe('idle');
    });

    e2eTest('session detail includes processing status', async () => {
        const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}`, {
            headers: HEADERS,
        });
        expect(res.ok).toBe(true);
        const data = await res.json();
        expect(data.processingStatus).toBe('idle');
    });

    e2eTest('session list includes processing status', async () => {
        const res = await fetch(`${API_BASE}/chat/sessions`, {
            headers: HEADERS,
        });
        expect(res.ok).toBe(true);
        const sessions = await res.json();
        const found = sessions.find((s: any) => s.id === sessionId);
        expect(found).toBeDefined();
        expect(found.processingStatus).toBe('idle');
    });

    e2eTest('cleanup: delete session', async () => {
        await deleteSession(sessionId);
    });
});

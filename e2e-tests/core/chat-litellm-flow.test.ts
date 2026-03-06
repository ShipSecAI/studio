import { expect } from 'bun:test';

import { API_BASE, HEADERS, e2eDescribe, e2eTest } from '../helpers/e2e-harness';

async function createSession(): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/sessions`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ title: 'Chat Provider E2E' }),
  });
  expect(res.status).toBe(201);
  const data = await res.json();
  return data.id as string;
}

async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/sessions/${id}`, {
    method: 'DELETE',
    headers: HEADERS,
  });
  expect(res.ok).toBe(true);
}

async function submitUserTurn(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/submissions`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      op: 'UserTurn',
      text: 'Reply with exactly ok',
      clientSubmissionId: crypto.randomUUID(),
    }),
  });
  expect(res.status).toBe(201);
}

async function waitForAssistantText(sessionId: string, timeoutMs = 120_000): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/thread-history`, {
      headers: HEADERS,
    });
    expect(res.ok).toBe(true);
    const data = await res.json();
    const messages = Array.isArray(data.messages) ? data.messages : [];

    for (const message of [...messages].reverse()) {
      if (message.role !== 'assistant') continue;
      const text = (Array.isArray(message.parts) ? message.parts : [])
        .filter((part: any) => part?.type === 'text')
        .map((part: any) => part.text ?? '')
        .join('');
      if (text.trim().length > 0) {
        return text;
      }
    }

    await Bun.sleep(1000);
  }

  throw new Error(`Timed out waiting for assistant response for session ${sessionId}`);
}

e2eDescribe('Chat Provider Flow', () => {
  let sessionId: string | null = null;

  e2eTest(
    'routes a local chat turn through the configured chat provider',
    { timeout: 180_000 },
    async () => {
      sessionId = await createSession();
      await submitUserTurn(sessionId);

      const assistantText = await waitForAssistantText(sessionId);
      expect(assistantText.trim().toLowerCase()).toBe('ok');
    },
  );

  e2eTest('cleanup chat session', async () => {
    if (!sessionId) return;
    await deleteSession(sessionId);
    sessionId = null;
  });
});

import { expect } from 'bun:test';

import { API_BASE, HEADERS, e2eDescribe, e2eTest } from '../helpers/e2e-harness';

const LITELLM_BASE = process.env.E2E_LITELLM_BASE_URL ?? 'http://127.0.0.1:4001';
const LITELLM_MASTER_KEY = process.env.E2E_LITELLM_MASTER_KEY ?? 'sk-shipsec-local-master';
const LOCAL_ORG_ID = 'local-dev';

interface LiteLLMTeamInfoResponse {
  spend?: number;
  team_info?: {
    spend?: number;
  };
}

function readSpend(payload: LiteLLMTeamInfoResponse): number {
  return payload.team_info?.spend ?? payload.spend ?? 0;
}

async function ensureOrgVirtualKey(): Promise<void> {
  const res = await fetch(`${API_BASE}/internal/billing/litellm-key`, {
    headers: {
      'x-internal-token': HEADERS['x-internal-token'],
      'x-organization-id': LOCAL_ORG_ID,
    },
  });
  expect(res.ok).toBe(true);
  const data = await res.json();
  expect(data.virtualKey).toBeTruthy();
}

async function getTeamSpend(): Promise<number> {
  const res = await fetch(
    `${LITELLM_BASE}/team/info?team_id=${encodeURIComponent(LOCAL_ORG_ID)}`,
    {
      headers: {
        Authorization: `Bearer ${LITELLM_MASTER_KEY}`,
      },
    },
  );
  expect(res.ok).toBe(true);
  const data = (await res.json()) as LiteLLMTeamInfoResponse;
  return readSpend(data);
}

async function createSession(): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/sessions`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ title: 'LiteLLM Chat E2E' }),
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
      text: 'Reply with exactly ok.',
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

async function waitForSpendIncrease(
  previousSpend: number,
  timeoutMs = 30_000,
): Promise<number> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const currentSpend = await getTeamSpend();
    if (currentSpend > previousSpend) {
      return currentSpend;
    }

    await Bun.sleep(1000);
  }

  throw new Error(`Timed out waiting for LiteLLM spend to exceed ${previousSpend}`);
}

e2eDescribe('Chat LiteLLM Flow', () => {
  let sessionId: string | null = null;

  e2eTest(
    'routes a local chat turn through LiteLLM and records org spend',
    { timeout: 180_000 },
    async () => {
      await ensureOrgVirtualKey();
      const spendBefore = await getTeamSpend();

      sessionId = await createSession();
      await submitUserTurn(sessionId);

      const assistantText = await waitForAssistantText(sessionId);
      expect(assistantText.trim().toLowerCase()).toBe('ok');

      const spendAfter = await waitForSpendIncrease(spendBefore);
      expect(spendAfter).toBeGreaterThan(spendBefore);
    },
  );

  e2eTest('cleanup chat session', async () => {
    if (!sessionId) return;
    await deleteSession(sessionId);
    sessionId = null;
  });
});

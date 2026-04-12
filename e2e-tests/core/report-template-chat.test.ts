import { expect } from 'bun:test';

import { API_BASE, HEADERS, e2eDescribe, e2eTest } from '../helpers/e2e-harness';

const BASIC_AUTH_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Basic ${Buffer.from('admin:admin').toString('base64')}`,
};

interface ThreadHistoryMessage {
  id: string;
  role: string;
  parts?: Array<Record<string, unknown>>;
}

async function createSession(title: string): Promise<string> {
  const res = await fetch(`${API_BASE}/chat/sessions`, {
    method: 'POST',
    headers: BASIC_AUTH_HEADERS,
    body: JSON.stringify({ title }),
  });
  expect(res.status).toBe(201);
  const data = await res.json();
  return data.id as string;
}

async function submitUserTurn(sessionId: string, text: string) {
  const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/submissions`, {
    method: 'POST',
    headers: BASIC_AUTH_HEADERS,
    body: JSON.stringify({
      op: 'UserTurn',
      text,
      clientSubmissionId: crypto.randomUUID(),
    }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function getThreadHistory(sessionId: string): Promise<{
  processingStatus?: string;
  messages?: ThreadHistoryMessage[];
}> {
  const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/thread-history`, {
    headers: BASIC_AUTH_HEADERS,
  });
  expect(res.ok).toBe(true);
  return res.json();
}

async function waitForReportTemplateFlow(
  sessionId: string,
  templateName: string,
  timeoutMs = 180_000,
): Promise<{
  assistant: ThreadHistoryMessage;
  createdTemplate: {
    id: string;
    name: string;
    status: string;
    scope: string;
    visibility: string;
    publishedVersionId?: string | null;
  };
}> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const state = await getThreadHistory(sessionId);
    const messages = state.messages ?? [];
    const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
    const templates = await listReportTemplates();
    const createdTemplate = templates.find((template) => template.name === templateName);

    if (
      assistant &&
      getToolParts(assistant, 'create_report_template_draft').length > 0 &&
      getToolParts(assistant, 'render_report_template_preview').length > 0 &&
      getToolParts(assistant, 'publish_report_template').length > 0 &&
      createdTemplate?.status === 'published' &&
      createdTemplate?.publishedVersionId
    ) {
      return { assistant, createdTemplate };
    }

    await Bun.sleep(1000);
  }

  throw new Error(`Timed out waiting for report-template flow for session ${sessionId}`);
}

async function listReportTemplates(): Promise<
  Array<{
    id: string;
    name: string;
    status: string;
    scope: string;
    visibility: string;
    publishedVersionId?: string | null;
  }>
> {
  const res = await fetch(`${API_BASE}/report-templates`, {
    headers: HEADERS,
  });
  expect(res.ok).toBe(true);
  return res.json();
}

function getToolParts(message: ThreadHistoryMessage, toolName: string) {
  return (message.parts ?? []).filter(
    (part) => part.type === 'tool-invocation' && part.toolName === toolName,
  );
}

function getAssistantText(message: ThreadHistoryMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => String(part.text))
    .join('');
}

e2eDescribe('Chat Report Template Flow', () => {
  e2eTest(
    'creates, previews, and publishes a report template through chat tools',
    { timeout: 240_000 },
    async () => {
      const templateName = `Executive Security Review E2E ${Date.now()}`;
      const sessionId = await createSession('Report Template Chat E2E');

      await submitUserTurn(
        sessionId,
        [
          'Use the report-template tools, not a prose-only draft.',
          `Create a draft report template named ${templateName} with create_report_template_draft.`,
          'Then call render_report_template_preview on that draft.',
          'If preview succeeds, call publish_report_template.',
          'Use sample data so the preview renders a leadership report with risk score, key findings, and a remediation priority table.',
          'Return the template id and confirm that preview was rendered through the tool.',
        ].join(' '),
      );

      const { assistant, createdTemplate } = await waitForReportTemplateFlow(
        sessionId,
        templateName,
      );

      expect(getToolParts(assistant, 'create_report_template_draft').length).toBeGreaterThan(0);
      expect(getToolParts(assistant, 'render_report_template_preview').length).toBeGreaterThan(0);
      expect(getToolParts(assistant, 'publish_report_template').length).toBeGreaterThan(0);

      expect(createdTemplate.status).toBe('published');
      expect(createdTemplate.scope).toBe('organization');
      expect(createdTemplate.visibility).toBe('library');
      expect(createdTemplate.publishedVersionId).toBeTruthy();
    },
  );
});

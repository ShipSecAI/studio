import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { extractPorts } from '@shipsec/component-sdk';
import { definition } from '../slack';

describe('Slack Component Template Support', () => {
  let httpFetchMock: ReturnType<typeof mock>;

  const createMockContext = () => {
    httpFetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true, ts: '123' }), { status: 200 })),
    );
    return {
      logger: {
        info: mock(() => {}),
        error: mock(() => {}),
        warn: mock(() => {}),
        debug: mock(() => {}),
      },
      http: {
        fetch: httpFetchMock,
      },
    } as any;
  };

  beforeEach(() => {
    mock.restore();
  });

  it('should interpolate text and blocks with dynamic variables', async () => {
    const mockContext = createMockContext();

    const executePayload = {
      inputs: {
        host: 'prod-db-01',
        severity: 'CRITICAL',
        slackToken: 'xoxb-test',
        channel: 'C1',
        text: 'Alert: {{severity}} issue on {{host}}',
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '*System:* {{host}}' },
          },
        ],
      },
      params: {
        authType: 'bot_token' as const,
      },
    };

    const result = await definition.execute(executePayload as any, mockContext);

    expect(result.ok).toBe(true);
    const body = JSON.parse(httpFetchMock.mock.calls[0][1].body);

    // Check text interpolation
    expect(body.text).toBe('Alert: CRITICAL issue on prod-db-01');

    // Check blocks interpolation
    expect(body.blocks[0].text.text).toBe('*System:* prod-db-01');
  });

  it('should handle JSON string blocks template', async () => {
    const mockContext = createMockContext();

    const executePayload = {
      inputs: {
        user: 'Alice',
        webhookUrl: 'https://webhook',
        text: 'Plain text',
        blocks: '[{"type": "section", "text": {"type": "plain_text", "text": "{{user}} joined" }}]',
      },
      params: {
        authType: 'webhook' as const,
      },
    };

    await definition.execute(executePayload as any, mockContext);

    const body = JSON.parse(httpFetchMock.mock.calls[0][1].body);
    expect(body.blocks[0].text.text).toBe('Alice joined');
  });

  it('should resolve dynamic ports for variables', () => {
    const resolved = definition.resolvePorts!({
      authType: 'bot_token',
      variables: [
        { name: 'error_msg', type: 'string' },
        { name: 'timestamp', type: 'string' },
      ],
    });

    const ports = extractPorts(resolved.inputs!);
    const errorPort = ports.find((i) => i.id === 'error_msg');
    const tsPort = ports.find((i) => i.id === 'timestamp');

    expect(errorPort).toBeDefined();
    expect(tsPort).toBeDefined();
    expect(errorPort?.label).toBe('error_msg');
  });
});

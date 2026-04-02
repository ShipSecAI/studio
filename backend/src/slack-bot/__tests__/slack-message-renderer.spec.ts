import { describe, expect, it } from 'bun:test';

import {
  chunkSlackMrkdwn,
  markdownToSlackMrkdwn,
  renderSlackMessagePayloads,
} from '../slack-message-renderer';

describe('slack message renderer', () => {
  it('converts common markdown into Slack-friendly mrkdwn', () => {
    const rendered = markdownToSlackMrkdwn(`# Heading

See **bold** and ~~strike~~ plus [ShipSec](https://shipsec.ai).
- first
- second`);

    expect(rendered).toContain('*Heading*');
    expect(rendered).toContain('*bold*');
    expect(rendered).toContain('~strike~');
    expect(rendered).toContain('<https://shipsec.ai|ShipSec>');
    expect(rendered).toContain('• first');
  });

  it('keeps oversized code fences balanced across chunks', () => {
    const code = [
      '```ts',
      ...Array.from({ length: 20 }, (_, i) => `line_${i}: ${'x'.repeat(40)}`),
      '```',
    ].join('\n');
    const chunks = chunkSlackMrkdwn(code, 180);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('```') || chunk.startsWith('_continued')).toBeTrue();
      expect(chunk.includes('```')).toBeTrue();
      expect(chunk.length).toBeLessThanOrEqual(180);
    }
  });

  it('renders block payloads for each chunk', () => {
    const payloads = renderSlackMessagePayloads('Hello\n\n' + 'A'.repeat(4000));

    expect(payloads.length).toBeGreaterThan(1);
    expect(payloads[0].blocks?.[0]).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: payloads[0].text,
      },
    });
  });
});

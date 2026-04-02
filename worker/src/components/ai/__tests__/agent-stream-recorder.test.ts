import { describe, expect, it, mock } from 'bun:test';

import { AgentStreamRecorder } from '../agent-stream-recorder';

describe('AgentStreamRecorder', () => {
  it('preserves whitespace-only text deltas', () => {
    const publish = mock(() => Promise.resolve());
    const recorder = new AgentStreamRecorder(
      {
        runId: 'run-1',
        componentRef: 'node-1',
        agentTracePublisher: { publish },
        emitProgress: mock(() => {}),
      } as any,
      'agent-1',
    );

    recorder.emitTextDelta('hello');
    recorder.emitTextDelta(' ');
    recorder.emitTextDelta('\n');

    const parts = (publish.mock.calls as unknown as [any][])
      .map((call) => call[0]?.part)
      .filter(Boolean);
    expect(parts[0]).toMatchObject({ type: 'data-text-start' });
    expect(parts[1]).toMatchObject({ type: 'text-delta', textDelta: 'hello' });
    expect(parts[2]).toMatchObject({ type: 'text-delta', textDelta: ' ' });
    expect(parts[3]).toMatchObject({ type: 'text-delta', textDelta: '\n' });
  });
});

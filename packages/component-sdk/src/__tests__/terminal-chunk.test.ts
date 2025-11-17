import { describe, it, expect, vi } from 'bun:test';
import { createExecutionContext } from '../context';
import { createTerminalChunkEmitter } from '../terminal';

describe('Terminal chunk emitter', () => {
  it('emits base64 payload and increments chunk index', () => {
    const collector = vi.fn();
    const context = createExecutionContext({
      runId: 'run-1',
      componentRef: 'node.a',
      terminalCollector: collector,
    });

    const emitter = createTerminalChunkEmitter(context, 'stdout');

    emitter('hello');
    emitter('world');

    expect(collector).toHaveBeenCalledTimes(2);
    const first = collector.mock.calls[0][0];
    const second = collector.mock.calls[1][0];

    expect(first.chunkIndex).toBe(1);
    expect(second.chunkIndex).toBe(2);
    expect(Buffer.from(first.payload, 'base64').toString()).toBe('hello');
    expect(Buffer.from(second.payload, 'base64').toString()).toBe('world');
    expect(second.deltaMs).toBeGreaterThanOrEqual(0);
  });

    it('no-ops when terminalCollector is missing', () => {
      const context = createExecutionContext({
        runId: 'run-1',
        componentRef: 'node.a',
      });

      const emitter = createTerminalChunkEmitter(context, 'stdout');
      expect(() => emitter('data')).not.toThrow();
    });
});

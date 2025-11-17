import type { TerminalChunkInput, ExecutionContext } from './types';

export type TerminalChunkEmitter = (data: Uint8Array | string) => void;

export function createTerminalChunkEmitter(
  context: ExecutionContext,
  stream: TerminalChunkInput['stream'] = 'pty',
): TerminalChunkEmitter {
  if (!context.terminalCollector) {
    return () => {};
  }

  let chunkIndex = 0;
  let lastTimestamp = Date.now();

  return (data: Uint8Array | string) => {
    if (!context.terminalCollector) {
      return;
    }

    const now = Date.now();
    const payloadBuffer = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);

    chunkIndex += 1;
    const chunk: TerminalChunkInput = {
      runId: context.runId,
      nodeRef: context.componentRef,
      stream,
      chunkIndex,
      payload: payloadBuffer.toString('base64'),
      recordedAt: new Date(now).toISOString(),
      deltaMs: chunkIndex === 1 ? 0 : now - lastTimestamp,
      origin: 'docker',
      runnerKind: 'docker',
    };

    lastTimestamp = now;

    try {
      context.terminalCollector(chunk);
    } catch (error) {
      console.error('[TerminalChunkEmitter] Failed to collect terminal chunk', error);
    }
  };
}

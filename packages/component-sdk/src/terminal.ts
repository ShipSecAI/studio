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
  let lastTimestampMs = 0; // Track milliseconds since last timestamp to ensure uniqueness

  return (data: Uint8Array | string) => {
    if (!context.terminalCollector) {
      return;
    }

    const now = Date.now();
    const payloadBuffer = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
    const dataString = typeof data === 'string' ? data : new TextDecoder().decode(data);

    chunkIndex += 1;
    
    // Ensure each chunk gets a unique timestamp, even if emitted in the same millisecond
    // Add a small increment (0.001ms per chunk) to ensure monotonic ordering
    let chunkTimestamp: number;
    if (now === lastTimestamp) {
      // Same millisecond - add microsecond precision using chunkIndex
      lastTimestampMs += 1;
      chunkTimestamp = now + lastTimestampMs / 1000; // Add microseconds as fractional milliseconds
    } else {
      // New millisecond - reset counter
      lastTimestampMs = 0;
      chunkTimestamp = now;
      lastTimestamp = now;
    }
    
    const chunk: TerminalChunkInput = {
      runId: context.runId,
      nodeRef: context.componentRef,
      stream,
      chunkIndex,
      payload: payloadBuffer.toString('base64'),
      recordedAt: new Date(chunkTimestamp).toISOString(),
      deltaMs: chunkIndex === 1 ? 0 : Math.max(0, chunkTimestamp - (lastTimestamp - (lastTimestampMs - 1) / 1000)),
      origin: 'docker',
      runnerKind: 'docker',
    };

    if (chunkIndex <= 3 || dataString.includes('[') || dataString.includes('progress')) {
      console.debug('[TerminalChunkEmitter] emitting chunk', {
        nodeRef: context.componentRef,
        stream,
        chunkIndex,
        dataLength: dataString.length,
        dataPreview: dataString.substring(0, 100),
        hasNewline: dataString.includes('\n'),
        hasCarriageReturn: dataString.includes('\r'),
        payloadSize: chunk.payload.length,
      });
    }

    lastTimestamp = now;

    try {
      context.terminalCollector(chunk);
    } catch (error) {
      console.error('[TerminalChunkEmitter] Failed to collect terminal chunk', error);
    }
  };
}

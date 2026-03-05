import { describe, it, expect } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { UIMessage } from 'ai';
import { useDurableChat } from '../use-durable-chat';
import type { ChatSessionStateResponse, DurableChatTransport } from '../durable-chat-transport';

function textMessage(id: string, role: UIMessage['role'], text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', text }],
  };
}

function transcriptSignature(messages: UIMessage[]) {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.parts
      .filter((part): part is Extract<UIMessage['parts'][number], { type: 'text' }> => {
        return part.type === 'text';
      })
      .map((part) => part.text)
      .join(''),
  }));
}

class FakeDurableTransport {
  private listeners = new Set<(chunk: unknown) => void>();
  private queuedStates: ChatSessionStateResponse[] = [];
  private fallbackState: ChatSessionStateResponse | null = null;
  public openCalls: { sessionId: string; afterSeq: number }[] = [];
  public closeCalls = 0;

  enqueueState(state: ChatSessionStateResponse) {
    this.queuedStates.push(state);
    this.fallbackState = state;
  }

  setFallbackState(state: ChatSessionStateResponse) {
    this.fallbackState = state;
  }

  emitChunk(chunk: unknown) {
    for (const listener of this.listeners) {
      listener(chunk);
    }
  }

  onSessionChunk(handler: (chunk: unknown) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async openSessionStream(sessionId: string, afterSeq = 0): Promise<void> {
    this.openCalls.push({ sessionId, afterSeq });
  }

  closeSessionStream(): void {
    this.closeCalls += 1;
  }

  async getState(): Promise<ChatSessionStateResponse | null> {
    if (this.queuedStates.length > 0) {
      return this.queuedStates.shift() ?? null;
    }
    return this.fallbackState;
  }
}

describe('useDurableChat E2E parity', () => {
  it('reconciles stream updates to the same transcript as canonical DB state', async () => {
    const transport = new FakeDurableTransport();
    const seenChunks: unknown[] = [];
    const initialState: ChatSessionStateResponse = {
      afterSeq: 10,
      processingStatus: 'processing',
      messages: [textMessage('user-1', 'user', 'hello')],
    };
    const staleState: ChatSessionStateResponse = {
      afterSeq: 10,
      processingStatus: 'processing',
      messages: [textMessage('user-1', 'user', 'hello')],
    };
    const finalState: ChatSessionStateResponse = {
      afterSeq: 12,
      processingStatus: 'idle',
      messages: [
        textMessage('user-1', 'user', 'hello'),
        textMessage('turn-turn-2', 'assistant', 'ab'),
      ],
    };

    // Mount hydration + post-attach refresh + manual refresh while streaming + completion refresh
    transport.enqueueState(initialState);
    transport.enqueueState(staleState);
    transport.enqueueState(staleState);
    transport.enqueueState(finalState);
    transport.setFallbackState(finalState);

    const { result } = renderHook(() =>
      useDurableChat({
        transport: transport as unknown as DurableChatTransport,
        sessionId: 'session-1',
        throttleMs: 1,
        onChunk: (chunk) => {
          seenChunks.push(chunk);
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.messages.length).toBe(1);
    });
    await waitFor(() => {
      expect(transport.openCalls.length).toBeGreaterThan(0);
    });

    act(() => {
      transport.emitChunk({
        seq: 11,
        turnId: 'turn-2',
        type: 'text-delta',
        delta: 'a',
      });
    });
    expect(seenChunks.length).toBeGreaterThan(0);
    expect(result.current.status).toBe('streaming');

    await act(async () => {
      // DB path returns stale seq while local stream is active; should not clobber streamed UI.
      await result.current.refreshState();
    });

    act(() => {
      transport.emitChunk({
        seq: 12,
        turnId: 'turn-2',
        chunk: {
          type: 'data-turn-status',
          data: { status: 'completed', pendingCount: 0 },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
      expect(transcriptSignature(result.current.messages)).toEqual(
        transcriptSignature((finalState.messages ?? []) as UIMessage[]),
      );
    });
  });

  it('does not replace rendered message objects on same-seq DB refresh', async () => {
    const transport = new FakeDurableTransport();
    const stableState: ChatSessionStateResponse = {
      afterSeq: 5,
      processingStatus: 'idle',
      messages: [textMessage('user-1', 'user', 'ping'), textMessage('turn-1', 'assistant', 'pong')],
    };
    const sameSeqCopy: ChatSessionStateResponse = {
      afterSeq: 5,
      processingStatus: 'idle',
      messages: [textMessage('user-1', 'user', 'ping'), textMessage('turn-1', 'assistant', 'pong')],
    };

    transport.enqueueState(stableState);
    transport.enqueueState(sameSeqCopy);
    transport.setFallbackState(sameSeqCopy);

    const { result } = renderHook(() =>
      useDurableChat({
        transport: transport as unknown as DurableChatTransport,
        sessionId: 'session-1',
        throttleMs: 1,
      }),
    );

    await waitFor(() => {
      expect(result.current.messages.length).toBe(2);
    });

    const firstArrayRef = result.current.messages;
    const firstMessageRef = result.current.messages[0];
    const secondMessageRef = result.current.messages[1];

    await act(async () => {
      await result.current.refreshState();
    });

    expect(result.current.messages).toBe(firstArrayRef);
    expect(result.current.messages[0]).toBe(firstMessageRef);
    expect(result.current.messages[1]).toBe(secondMessageRef);
  });
});

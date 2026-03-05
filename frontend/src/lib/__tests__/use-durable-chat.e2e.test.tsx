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

  async sendMessages(): Promise<ReadableStream<unknown>> {
    return new ReadableStream<unknown>({
      start(controller) {
        controller.close();
      },
    });
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

  it('renders tool invocation parts during live stream and converges to DB state', async () => {
    const transport = new FakeDurableTransport();
    const initialState: ChatSessionStateResponse = {
      afterSeq: 20,
      processingStatus: 'processing',
      messages: [textMessage('user-1', 'user', 'run an ASM scan')],
    };
    const finalState: ChatSessionStateResponse = {
      afterSeq: 24,
      processingStatus: 'idle',
      messages: [
        textMessage('user-1', 'user', 'run an ASM scan'),
        {
          id: 'turn-turn-9',
          role: 'assistant',
          parts: [
            {
              type: 'tool-invocation',
              toolCallId: 'tool-1',
              toolName: 'shipsec.subfinder.run',
              state: 'output-available',
              input: { domain: 'example.com' },
              output: { findings: 3 },
            },
            { type: 'text', text: 'Scan complete.' },
          ],
        } as UIMessage,
      ],
    };

    transport.enqueueState(initialState);
    transport.enqueueState(initialState);
    transport.enqueueState(finalState);
    transport.setFallbackState(finalState);

    const { result } = renderHook(() =>
      useDurableChat({
        transport: transport as unknown as DurableChatTransport,
        sessionId: 'session-1',
        throttleMs: 1,
      }),
    );

    await waitFor(() => {
      expect(result.current.messages.length).toBe(1);
    });

    act(() => {
      transport.emitChunk({
        seq: 21,
        turnId: 'turn-9',
        type: 'tool-input-available',
        toolCallId: 'tool-1',
        toolName: 'shipsec.subfinder.run',
        input: { domain: 'example.com' },
      });
    });

    await waitFor(() => {
      const assistant = result.current.messages.find((m) => m.role === 'assistant');
      expect(assistant).toBeDefined();
      expect(assistant?.parts.some((p) => p.type === 'tool-invocation')).toBe(true);
    });

    act(() => {
      transport.emitChunk({
        seq: 22,
        turnId: 'turn-9',
        type: 'tool-output-available',
        toolCallId: 'tool-1',
        toolName: 'shipsec.subfinder.run',
        output: { findings: 3 },
      });
      transport.emitChunk({
        seq: 23,
        turnId: 'turn-9',
        type: 'text-delta',
        delta: 'Scan complete.',
      });
      transport.emitChunk({
        seq: 24,
        turnId: 'turn-9',
        type: 'data-turn-status',
        data: { status: 'completed', pendingCount: 0 },
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
      const assistant = result.current.messages.find((m) => m.id === 'turn-turn-9');
      expect(assistant).toBeDefined();
      const toolPart = assistant?.parts.find((p) => p.type === 'tool-invocation') as
        | { state?: string }
        | undefined;
      expect(toolPart?.state).toBe('output-available');
      expect(transcriptSignature(result.current.messages)).toEqual(
        transcriptSignature((finalState.messages ?? []) as UIMessage[]),
      );
    });
  });

  it('keeps tool calls inline between streamed text segments', async () => {
    const transport = new FakeDurableTransport();
    const initialState: ChatSessionStateResponse = {
      afterSeq: 30,
      processingStatus: 'processing',
      messages: [textMessage('user-1', 'user', 'inspect example.com')],
    };
    const finalState: ChatSessionStateResponse = {
      afterSeq: 35,
      processingStatus: 'idle',
      messages: [
        textMessage('user-1', 'user', 'inspect example.com'),
        {
          id: 'turn-turn-10',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Before tool. ' },
            {
              type: 'tool-invocation',
              toolCallId: 'tool-10',
              toolName: 'shipsec.subfinder.run',
              state: 'output-available',
              input: { domain: 'example.com' },
              output: { subdomains: 12 },
            },
            { type: 'text', text: 'After tool.' },
          ],
        } as UIMessage,
      ],
    };

    transport.enqueueState(initialState);
    transport.enqueueState(initialState);
    transport.enqueueState(finalState);
    transport.setFallbackState(finalState);

    const { result } = renderHook(() =>
      useDurableChat({
        transport: transport as unknown as DurableChatTransport,
        sessionId: 'session-1',
        throttleMs: 1,
      }),
    );

    await waitFor(() => {
      expect(result.current.messages.length).toBe(1);
    });

    act(() => {
      transport.emitChunk({
        seq: 31,
        turnId: 'turn-10',
        type: 'text-delta',
        delta: 'Before tool. ',
      });
      transport.emitChunk({
        seq: 32,
        turnId: 'turn-10',
        type: 'tool-input-available',
        toolCallId: 'tool-10',
        toolName: 'shipsec.subfinder.run',
        input: { domain: 'example.com' },
      });
      transport.emitChunk({
        seq: 33,
        turnId: 'turn-10',
        type: 'tool-output-available',
        toolCallId: 'tool-10',
        toolName: 'shipsec.subfinder.run',
        output: { subdomains: 12 },
      });
      transport.emitChunk({
        seq: 34,
        turnId: 'turn-10',
        type: 'text-delta',
        delta: 'After tool.',
      });
    });

    await waitFor(() => {
      const assistant = result.current.messages.find((m) => m.id === 'turn-turn-10');
      expect(assistant).toBeDefined();
      expect(assistant?.parts[0]?.type).toBe('text');
      expect((assistant?.parts[0] as { text?: string })?.text).toBe('Before tool. ');
      expect(assistant?.parts[1]?.type).toBe('tool-invocation');
      expect(assistant?.parts[2]?.type).toBe('text');
      expect((assistant?.parts[2] as { text?: string })?.text).toBe('After tool.');
    });

    act(() => {
      transport.emitChunk({
        seq: 35,
        turnId: 'turn-10',
        type: 'data-turn-status',
        data: { status: 'completed', pendingCount: 0 },
      });
    });

    await waitFor(() => {
      expect(result.current.status).toBe('ready');
      expect(transcriptSignature(result.current.messages)).toEqual(
        transcriptSignature((finalState.messages ?? []) as UIMessage[]),
      );
    });
  });

  it('keeps optimistic user message visible across stale refresh before DB persistence', async () => {
    const transport = new FakeDurableTransport();
    const initialState: ChatSessionStateResponse = {
      afterSeq: 41,
      processingStatus: 'processing',
      messages: [textMessage('user-1', 'user', 'first')],
    };

    // mount hydrate + post-attach refresh + manual stale refresh
    transport.enqueueState(initialState);
    transport.enqueueState(initialState);
    transport.enqueueState(initialState);
    transport.setFallbackState(initialState);

    const { result } = renderHook(() =>
      useDurableChat({
        transport: transport as unknown as DurableChatTransport,
        sessionId: 'session-1',
        throttleMs: 1,
      }),
    );

    await waitFor(() => {
      expect(result.current.messages.length).toBe(1);
    });

    act(() => {
      result.current.sendMessage({ text: 'second' });
    });

    await waitFor(() => {
      const texts = transcriptSignature(result.current.messages).map((entry) => entry.text);
      expect(texts).toEqual(['first', 'second']);
    });

    await act(async () => {
      await result.current.refreshState();
    });

    const textsAfterRefresh = transcriptSignature(result.current.messages).map(
      (entry) => entry.text,
    );
    expect(textsAfterRefresh).toEqual(['first', 'second']);
  });

  it('ignores late chunks from interrupted previous turn after a new submit', async () => {
    const transport = new FakeDurableTransport();
    const initialState: ChatSessionStateResponse = {
      afterSeq: 50,
      processingStatus: 'processing',
      messages: [
        textMessage('user-1', 'user', 'old question'),
        textMessage('turn-old', 'assistant', 'old answer'),
      ],
    };

    transport.enqueueState(initialState);
    transport.enqueueState(initialState);
    transport.setFallbackState(initialState);

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

    // Old turn is active and streaming before interruption/new submit.
    act(() => {
      transport.emitChunk({
        seq: 51,
        turnId: 'old',
        type: 'text-delta',
        delta: '...',
      });
    });

    act(() => {
      result.current.sendMessage({ text: 'new question' });
    });

    // Late old chunks must be ignored after submit.
    act(() => {
      transport.emitChunk({
        seq: 52,
        turnId: 'old',
        type: 'text-delta',
        delta: 'late-old-content',
      });
      transport.emitChunk({
        seq: 53,
        turnId: 'old',
        type: 'data-turn-status',
        data: { status: 'interrupted', pendingCount: 1 },
      });
    });

    const assistant = result.current.messages.find((message) => message.id === 'turn-old');
    const assistantText = assistant?.parts
      .filter((part): part is Extract<UIMessage['parts'][number], { type: 'text' }> => {
        return part.type === 'text';
      })
      .map((part) => part.text)
      .join('');
    expect(assistantText).toBe('old answer');

    const texts = transcriptSignature(result.current.messages).map((entry) => entry.text);
    expect(texts).toContain('new question');
    expect(texts.join(' ')).not.toContain('late-old-content');
  });

  it('ignores old running-turn chunks after submit even when no prior chunk was seen locally', async () => {
    const transport = new FakeDurableTransport();
    const stateWithRunningOldTurn: ChatSessionStateResponse = {
      afterSeq: 60,
      processingStatus: 'processing',
      queue: [{ turnId: 'old', status: 'running' }],
      messages: [
        textMessage('user-1', 'user', 'old question'),
        textMessage('turn-old', 'assistant', 'old answer'),
      ],
    };

    transport.enqueueState(stateWithRunningOldTurn);
    transport.enqueueState(stateWithRunningOldTurn);
    transport.setFallbackState(stateWithRunningOldTurn);

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

    // Submit immediately (no old stream chunk seen yet in this tab).
    act(() => {
      result.current.sendMessage({ text: 'new question' });
    });

    act(() => {
      transport.emitChunk({
        seq: 61,
        turnId: 'old',
        type: 'text-delta',
        delta: 'late-old-content',
      });
    });

    const assistant = result.current.messages.find((message) => message.id === 'turn-old');
    const assistantText = assistant?.parts
      .filter((part): part is Extract<UIMessage['parts'][number], { type: 'text' }> => {
        return part.type === 'text';
      })
      .map((part) => part.text)
      .join('');
    expect(assistantText).toBe('old answer');
  });
});

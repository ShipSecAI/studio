import { beforeEach, describe, expect, it, jest } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { TemporalService } from '../../temporal/temporal.service';
import type { ChatSessionEventRepository } from '../chat-session-event.repository';
import type { ChatSessionRepository } from '../chat-session.repository';
import { ChatService } from '../chat.service';
import type { ChatStreamService } from '../chat-stream.service';
import type { ChatTurnDraftRepository } from '../chat-turn-draft.repository';
import type { ChatTurnRepository } from '../chat-turn.repository';
import type { ChatPartialRepository } from '../chat-partial.repository';

describe('ChatService Unit Tests', () => {
  let service: ChatService;
  let sessionRepository: ChatSessionRepository;
  let turnRepository: ChatTurnRepository;
  let sessionEventRepository: ChatSessionEventRepository;
  let turnDraftRepository: ChatTurnDraftRepository;
  let partialRepository: ChatPartialRepository;
  let chatStreamService: ChatStreamService;
  let temporalService: TemporalService;

  const mockAuthContext: AuthContext = {
    userId: 'test-user-id',
    organizationId: 'test-org-id',
    roles: ['ADMIN'],
    isAuthenticated: true,
    provider: 'test',
  };

  beforeEach(() => {
    sessionRepository = {
      createSession: jest.fn().mockResolvedValue({
        id: 'session-1',
        title: 'New Conversation',
        status: 'active',
        processingStatus: 'idle',
        activeRunId: null,
        nextEventSeq: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      listSessions: jest.fn().mockResolvedValue([]),
      getSession: jest.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Session',
        status: 'active',
        processingStatus: 'idle',
        activeRunId: null,
        steerTargetTurnId: null,
        nextEventSeq: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      updateSessionTitle: jest.fn(),
      deleteSession: jest.fn(),
      getMessages: jest.fn().mockResolvedValue([]),
      saveMessage: jest.fn().mockResolvedValue({
        id: 'msg-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      setTemporalWorkflowId: jest.fn(),
      setSteerIntent: jest.fn(),
      clearSteerIntent: jest.fn(),
      setProcessingStatus: jest.fn(),
      startRun: jest.fn(),
      completeRun: jest.fn(),
    } as unknown as ChatSessionRepository;

    turnRepository = {
      enqueueTurnWithUserMessage: jest.fn().mockResolvedValue({
        turn: {
          id: 'turn-1',
          userMessage: 'hello',
          status: 'queued',
          queuedAt: new Date('2026-03-04T10:00:00.000Z'),
        },
        position: 1,
        created: true,
      }),
      getTurn: jest.fn().mockResolvedValue({ id: 'turn-1' }),
      getRunningTurn: jest.fn().mockResolvedValue(null),
      getLatestTurn: jest.fn().mockResolvedValue(null),
      listQueuedTurns: jest.fn().mockResolvedValue([]),
      setTurnStatus: jest.fn(),
      setTurnRunning: jest.fn(),
    } as unknown as ChatTurnRepository;

    sessionEventRepository = {
      append: jest.fn().mockResolvedValue(8),
      listAfter: jest.fn().mockResolvedValue([]),
      listByTurn: jest.fn().mockResolvedValue([]),
      getLastSeq: jest.fn().mockResolvedValue(7),
    } as unknown as ChatSessionEventRepository;

    turnDraftRepository = {
      upsert: jest.fn(),
    } as unknown as ChatTurnDraftRepository;

    partialRepository = {
      upsert: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    } as unknown as ChatPartialRepository;

    chatStreamService = {
      publish: jest.fn(),
      isAvailable: jest.fn().mockReturnValue(false),
      subscribe: jest.fn(),
    } as unknown as ChatStreamService;

    temporalService = {
      startChatWorkflow: jest.fn().mockResolvedValue({
        workflowId: 'chat-session-1',
        runId: 'run-1',
      }),
      terminateChatWorkflow: jest.fn(),
      signalChatWorkflow: jest.fn(),
      signalChatInterrupt: jest.fn(),
      signalChatSteerTurn: jest.fn(),
    } as unknown as TemporalService;

    service = new ChatService(
      sessionRepository,
      turnRepository,
      sessionEventRepository,
      turnDraftRepository,
      partialRepository,
      chatStreamService,
      temporalService,
    );
  });

  it('enqueues turn and returns queue metadata', async () => {
    const result = await service.enqueueTurn(
      'session-1',
      { message: 'hello', clientMessageId: 'client-1' },
      mockAuthContext,
    );

    expect(turnRepository.enqueueTurnWithUserMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      message: 'hello',
      clientMessageId: 'client-1',
    });
    expect(sessionRepository.startRun).toHaveBeenCalledWith('session-1', expect.any(String));
    expect(temporalService.signalChatWorkflow).toHaveBeenCalledWith(
      'session-1',
      {
        id: 'client-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
      },
      expect.any(String),
      expect.objectContaining({
        turnId: 'turn-1',
      }),
    );
    expect(result).toEqual({
      turnId: 'turn-1',
      status: 'queued',
      preview: 'hello',
      queuedAt: new Date('2026-03-04T10:00:00.000Z'),
      position: 1,
      queuePosition: 1,
      queued: false,
      runId: expect.any(String),
      pendingCount: 0,
      afterSeq: 7,
      lastSeq: 7,
    });
  });

  it('recovers from stale completed workflow when enqueueing a turn', async () => {
    (sessionRepository.getSession as jest.Mock).mockResolvedValue({
      id: 'session-1',
      title: 'Session',
      status: 'active',
      processingStatus: 'processing',
      activeRunId: 'run-stale',
      organizationId: 'test-org-id',
      steerTargetTurnId: null,
      nextEventSeq: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (temporalService.signalChatWorkflow as jest.Mock)
      .mockRejectedValueOnce(new Error('workflow execution already completed'))
      .mockResolvedValueOnce(undefined);

    const result = await service.enqueueTurn(
      'session-1',
      { message: 'recover me', clientMessageId: 'client-recover' },
      mockAuthContext,
    );

    expect(sessionRepository.completeRun).toHaveBeenCalledWith('session-1', 'run-stale');
    expect(temporalService.startChatWorkflow).toHaveBeenCalledWith({
      sessionId: 'session-1',
      organizationId: 'test-org-id',
      systemPrompt: expect.any(String),
    });
    expect(sessionRepository.startRun).toHaveBeenCalledWith('session-1', expect.any(String));
    expect(temporalService.signalChatWorkflow).toHaveBeenCalledTimes(2);
    expect(result).toEqual(
      expect.objectContaining({
        queued: false,
        runId: expect.any(String),
      }),
    );
  });

  it('projects state with active turn, queue, and lastSeq', async () => {
    (turnRepository.getRunningTurn as jest.Mock).mockResolvedValue({
      id: 'turn-running',
      status: 'running',
      runId: 'run-1',
      generationId: 'gen-1',
      startedAt: new Date('2026-03-04T10:01:00.000Z'),
    });
    (turnRepository.listQueuedTurns as jest.Mock).mockResolvedValue([
      {
        id: 'turn-2',
        status: 'queued',
        userMessage: 'next turn',
        queuedAt: new Date('2026-03-04T10:02:00.000Z'),
      },
    ]);

    const result = await service.getState('session-1', mockAuthContext);

    expect(result).toEqual(
      expect.objectContaining({
        messages: [],
        activeRunId: 'run-1',
        pendingCount: 1,
        steerTargetTurnId: null,
        queueOrder: ['turn-2'],
        afterSeq: 7,
        lastSeq: 7,
        processingStatus: 'processing',
      }),
    );
    expect(result.activeTurn).toEqual(
      expect.objectContaining({
        turnId: 'turn-running',
        status: 'running',
        runId: 'run-1',
      }),
    );
    expect(result.queue[0]).toEqual(
      expect.objectContaining({
        turnId: 'turn-2',
        preview: 'next turn',
        queuePosition: 1,
        status: 'queued',
      }),
    );
  });

  it('recovers active assistant response from partial snapshot before event replay', async () => {
    (sessionRepository.getMessages as jest.Mock).mockResolvedValue([
      {
        id: 'msg-user',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        createdAt: new Date('2026-03-04T10:00:00.000Z'),
      },
    ]);
    (turnRepository.getRunningTurn as jest.Mock).mockResolvedValue({
      id: 'turn-running',
      status: 'running',
      runId: 'run-1',
      generationId: 'gen-1',
      startedAt: new Date('2026-03-04T10:01:00.000Z'),
    });
    (partialRepository.get as jest.Mock).mockResolvedValue({
      parts: [{ type: 'text', text: 'in-progress answer' }],
      updatedAt: new Date('2026-03-04T10:01:30.000Z'),
    });

    const result = await service.getState('session-1', mockAuthContext);

    expect(result.messages).toEqual([
      expect.objectContaining({
        id: 'msg-user',
        role: 'user',
      }),
      expect.objectContaining({
        id: 'turn-turn-running',
        role: 'assistant',
        parts: [{ type: 'text', text: 'in-progress answer' }],
      }),
    ]);
    expect(sessionEventRepository.listByTurn).not.toHaveBeenCalled();
  });

  it('appends internal event with atomic seq and publishes it', async () => {
    const seq = await service.appendInternalEvent('session-1', {
      turnId: 'turn-1',
      runId: 'run-1',
      generationId: 'gen-1',
      eventId: 'evt-1',
      chunk: { type: 'text-delta', text: 'hello' },
    });

    expect(sessionEventRepository.append).toHaveBeenCalledWith({
      sessionId: 'session-1',
      turnId: 'turn-1',
      runId: 'run-1',
      generationId: 'gen-1',
      eventId: 'evt-1',
      chunk: { type: 'text-delta', text: 'hello' },
    });
    expect(turnDraftRepository.upsert).toHaveBeenCalledWith(
      'turn-1',
      { type: 'text-delta', text: 'hello' },
      8,
    );
    expect(chatStreamService.publish).toHaveBeenCalledWith('session-1', {
      seq: 8,
      turnId: 'turn-1',
      runId: 'run-1',
      generationId: 'gen-1',
      eventId: 'evt-1',
      chunk: { type: 'text-delta', text: 'hello' },
    });
    expect(seq).toBe(8);
  });

  it('marks turn running when chunk status indicates running', async () => {
    await service.appendInternalEvent('session-1', {
      turnId: 'turn-1',
      runId: 'run-1',
      generationId: 'gen-1',
      eventId: 'evt-run',
      chunk: { status: 'running' },
    });

    expect(turnRepository.setTurnRunning).toHaveBeenCalledWith(
      'session-1',
      'turn-1',
      'run-1',
      'gen-1',
    );
    expect(sessionRepository.setProcessingStatus).toHaveBeenCalledWith('session-1', 'processing');
  });

  it('interrupt always signals Temporal even when no running turn exists', async () => {
    (turnRepository.getRunningTurn as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'turn-running' });

    const first = await service.interruptGeneration('session-1', mockAuthContext);
    const second = await service.interruptGeneration('session-1', mockAuthContext);

    // Both return ok: true — signal is always sent (workflow handler is idempotent)
    expect(first).toEqual({ ok: true, interruptedTurnId: undefined });
    expect(second).toEqual({ ok: true, interruptedTurnId: 'turn-running' });
    // signalChatInterrupt called for BOTH invocations
    expect(temporalService.signalChatInterrupt).toHaveBeenCalledTimes(2);
    expect(temporalService.signalChatInterrupt).toHaveBeenCalledWith('session-1');
  });

  it('clears partial response state when completing a run', async () => {
    (turnRepository.getRunningTurn as jest.Mock).mockResolvedValue(null);
    (turnRepository.getLatestTurn as jest.Mock).mockResolvedValue(null);

    await service.completeRun('session-1', 'run-1');

    expect(sessionRepository.completeRun).toHaveBeenCalledWith('session-1', 'run-1');
    expect(sessionRepository.clearSteerIntent).toHaveBeenCalledWith('session-1');
    expect(partialRepository.delete).toHaveBeenCalledWith('session-1');
  });
});

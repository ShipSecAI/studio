import { beforeEach, describe, expect, it, jest } from 'bun:test';

import type { AuthContext } from '../../auth/types';
import type { TemporalService } from '../../temporal/temporal.service';
import type { ChatSessionEventRepository } from '../chat-session-event.repository';
import type { ChatSessionRepository } from '../chat-session.repository';
import { ChatService } from '../chat.service';
import type { ChatStreamService } from '../chat-stream.service';
import type { ChatTurnDraftRepository } from '../chat-turn-draft.repository';
import type { ChatTurnRepository } from '../chat-turn.repository';

describe('ChatService Unit Tests', () => {
  let service: ChatService;
  let sessionRepository: ChatSessionRepository;
  let turnRepository: ChatTurnRepository;
  let sessionEventRepository: ChatSessionEventRepository;
  let turnDraftRepository: ChatTurnDraftRepository;
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
        activeTurnId: null,
        activeGenerationId: 0,
        steerTargetTurnId: null,
        nextEventSeq: 1,
        organizationId: 'test-org-id',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getSessionInternal: jest.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Session',
        status: 'active',
        processingStatus: 'idle',
        activeRunId: null,
        activeTurnId: null,
        activeGenerationId: 0,
        steerTargetTurnId: null,
        nextEventSeq: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      updateSessionTitle: jest.fn(),
      deleteSession: jest.fn(),
      setTemporalWorkflowId: jest.fn(),
      setSteerIntent: jest.fn(),
      clearSteerIntent: jest.fn(),
      setProcessingStatus: jest.fn(),
      setActiveTurn: jest.fn(),
      bumpGeneration: jest.fn().mockResolvedValue(1),
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
      listInterruptedTurns: jest.fn().mockResolvedValue([]),
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
      queryChatStatus: jest.fn().mockResolvedValue('idle'),
    } as unknown as TemporalService;

    service = new ChatService(
      sessionRepository,
      turnRepository,
      sessionEventRepository,
      turnDraftRepository,
      chatStreamService,
      temporalService,
    );
  });

  it('submits user turn via vNext operation and returns ack metadata', async () => {
    const result = await service.submitOperation(
      'session-1',
      {
        op: 'UserTurn',
        text: 'hello',
        clientSubmissionId: 'client-1',
      },
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
        generationId: 1,
        submissionId: 'client-1',
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        submissionId: 'client-1',
        operation: 'UserTurn',
        turnId: 'turn-1',
        generationId: 1,
      }),
    );
  });

  it('restarts a completed chat workflow before signaling a queued turn', async () => {
    (sessionRepository.getSession as jest.Mock).mockResolvedValue({
      id: 'session-1',
      title: 'Session',
      status: 'active',
      processingStatus: 'processing',
      activeRunId: 'stale-run-1',
      activeTurnId: null,
      activeGenerationId: 1,
      steerTargetTurnId: null,
      nextEventSeq: 42,
      organizationId: 'test-org-id',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (temporalService.queryChatStatus as jest.Mock).mockResolvedValue('done');
    (sessionEventRepository.listAfter as jest.Mock).mockResolvedValue([
      {
        seq: 1,
        turnId: 'turn-old',
        runId: 'run-old',
        generationId: '1',
        eventId: 'turn-old:queued',
        chunk: {
          type: 'data-turn-status',
          data: {
            turnId: 'turn-old',
            status: 'queued',
            text: 'previous question',
            preview: 'previous question',
            queuedAt: '2026-03-04T10:01:00.000Z',
          },
        },
      },
    ]);
    (sessionEventRepository.getLastSeq as jest.Mock).mockResolvedValue(8);
    (temporalService.startChatWorkflow as jest.Mock).mockResolvedValue({
      workflowId: 'chat-session-1',
      runId: 'run-restarted',
    });

    await service.submitOperation(
      'session-1',
      {
        op: 'UserTurn',
        text: 'hello again',
        clientSubmissionId: 'client-2',
      },
      mockAuthContext,
    );

    expect(sessionRepository.completeRun).toHaveBeenCalledWith('session-1', 'stale-run-1');
    expect(temporalService.startChatWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        organizationId: 'test-org-id',
        initialMessages: [
          {
            id: 'user-turn-old',
            role: 'user',
            parts: [{ type: 'text', text: 'previous question' }],
          },
        ],
      }),
    );
    expect(sessionRepository.startRun).toHaveBeenCalledWith('session-1', 'run-restarted');
    expect(temporalService.signalChatWorkflow).toHaveBeenCalledWith(
      'session-1',
      {
        id: 'client-2',
        role: 'user',
        parts: [{ type: 'text', text: 'hello again' }],
      },
      'run-restarted',
      expect.objectContaining({
        turnId: 'turn-1',
        submissionId: 'client-2',
      }),
    );
  });

  it('interrupt operation signals temporal and returns accepted seq', async () => {
    (turnRepository.getRunningTurn as jest.Mock).mockResolvedValue({ id: 'turn-running' });
    (sessionEventRepository.getLastSeq as jest.Mock).mockResolvedValue(11);

    const result = await service.submitOperation(
      'session-1',
      {
        op: 'Interrupt',
        clientSubmissionId: 'interrupt-1',
      },
      mockAuthContext,
    );

    expect(temporalService.signalChatInterrupt).toHaveBeenCalledWith('session-1');
    expect(result).toEqual({
      submissionId: 'interrupt-1',
      operation: 'Interrupt',
      interruptedTurnId: 'turn-running',
      acceptedAtSeq: 11,
    });
  });

  it('projects thread history with active turn, queue, and lastSeq', async () => {
    (sessionEventRepository.listAfter as jest.Mock).mockResolvedValue([
      {
        seq: 5,
        turnId: 'turn-running',
        runId: 'run-1',
        generationId: '1',
        eventId: 'sub-1:TurnQueued',
        chunk: {
          type: 'data-turn-status',
          data: {
            turnId: 'turn-running',
            status: 'queued',
            text: 'hello',
            preview: 'hello',
            queuedAt: '2026-03-04T10:01:00.000Z',
          },
        },
      },
      {
        seq: 6,
        turnId: 'turn-running',
        runId: 'run-1',
        generationId: '1',
        eventId: 'turn-running:running',
        chunk: {
          type: 'data-turn-status',
          data: {
            turnId: 'turn-running',
            status: 'running',
            startedAt: '2026-03-04T10:01:02.000Z',
          },
        },
      },
      {
        seq: 7,
        turnId: 'turn-2',
        runId: 'run-1',
        generationId: '1',
        eventId: 'sub-2:TurnQueued',
        chunk: {
          type: 'data-turn-status',
          data: {
            turnId: 'turn-2',
            status: 'queued',
            text: 'next turn',
            preview: 'next turn',
            queuedAt: '2026-03-04T10:02:00.000Z',
          },
        },
      },
    ]);

    const result = await service.getThreadHistory('session-1', mockAuthContext);

    expect(result).toEqual(
      expect.objectContaining({
        messages: expect.any(Array),
        pendingCount: 1,
        queueOrder: ['turn-2'],
        afterSeq: 7,
        lastSeq: 7,
        processingStatus: 'processing',
      }),
    );
    expect(result.activeTurn).toEqual(
      expect.objectContaining({ turnId: 'turn-running', status: 'running' }),
    );
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

    expect(first).toEqual({ ok: true, interruptedTurnId: undefined });
    expect(second).toEqual({ ok: true, interruptedTurnId: 'turn-running' });
    expect(temporalService.signalChatInterrupt).toHaveBeenCalledTimes(2);
    expect(temporalService.signalChatInterrupt).toHaveBeenCalledWith('session-1');
  });

  it('completes run and clears steer intent', async () => {
    (turnRepository.getRunningTurn as jest.Mock).mockResolvedValue(null);
    (turnRepository.getLatestTurn as jest.Mock).mockResolvedValue(null);

    await service.completeRun('session-1', 'run-1');

    expect(sessionRepository.completeRun).toHaveBeenCalledWith('session-1', 'run-1');
    expect(sessionRepository.clearSteerIntent).toHaveBeenCalledWith('session-1');
  });
});

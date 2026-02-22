import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { ChatService } from '../chat.service';
import type { ChatSessionRepository } from '../chat-session.repository';
import type { ChatStreamService } from '../chat-stream.service';
import type { TemporalService } from '../../temporal/temporal.service';
import type { AuthContext } from '../../auth/types';

describe('ChatService Unit Tests', () => {
  let service: ChatService;
  let sessionRepository: ChatSessionRepository;
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
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      listSessions: jest.fn().mockResolvedValue([]),
      getSession: jest.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Test',
        status: 'active',
        temporalWorkflowId: 'chat-session-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      updateSessionTitle: jest.fn().mockResolvedValue({
        id: 'session-1',
        title: 'Updated',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      deleteSession: jest.fn().mockResolvedValue(undefined),
      touchSession: jest.fn().mockResolvedValue(undefined),
      saveMessage: jest.fn().mockResolvedValue({
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'user',
        parts: [],
        createdAt: new Date(),
      }),
      getMessages: jest.fn().mockResolvedValue([]),
      setTemporalWorkflowId: jest.fn().mockResolvedValue(undefined),
    } as unknown as ChatSessionRepository;

    chatStreamService = {
      subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    } as unknown as ChatStreamService;

    temporalService = {
      startChatWorkflow: jest.fn().mockResolvedValue({
        workflowId: 'chat-session-1',
        runId: 'run-1',
      }),
      signalChatWorkflow: jest.fn().mockResolvedValue(undefined),
      terminateChatWorkflow: jest.fn().mockResolvedValue(undefined),
    } as unknown as TemporalService;

    service = new ChatService(sessionRepository, chatStreamService, temporalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSession', () => {
    it('creates session and starts Temporal workflow', async () => {
      const result = await service.createSession(mockAuthContext, 'Test Session');

      expect(sessionRepository.createSession).toHaveBeenCalledWith(
        'test-user-id',
        'test-org-id',
        'Test Session',
      );
      expect(temporalService.startChatWorkflow).toHaveBeenCalledWith({
        sessionId: 'session-1',
        organizationId: 'test-org-id',
        systemPrompt: expect.any(String),
      });
      expect(sessionRepository.setTemporalWorkflowId).toHaveBeenCalledWith(
        'session-1',
        'chat-session-1',
      );
      expect(result.id).toBe('session-1');
    });

    it('throws when Temporal workflow fails to start', async () => {
      (temporalService.startChatWorkflow as jest.Mock).mockRejectedValue(
        new Error('Temporal unavailable'),
      );

      await expect(service.createSession(mockAuthContext)).rejects.toThrow('Temporal unavailable');
    });
  });

  describe('listSessions', () => {
    it('lists sessions for user', async () => {
      await service.listSessions(mockAuthContext);
      expect(sessionRepository.listSessions).toHaveBeenCalledWith({
        userId: 'test-user-id',
        organizationId: 'test-org-id',
      });
    });
  });

  describe('deleteSession', () => {
    it('terminates Temporal workflow and deletes session', async () => {
      await service.deleteSession('session-1', mockAuthContext);

      expect(temporalService.terminateChatWorkflow).toHaveBeenCalledWith('session-1');
      expect(sessionRepository.deleteSession).toHaveBeenCalledWith('session-1', {
        userId: 'test-user-id',
        organizationId: 'test-org-id',
      });
    });

    it('still deletes session if Temporal termination fails', async () => {
      (temporalService.terminateChatWorkflow as jest.Mock).mockRejectedValue(
        new Error('not found'),
      );

      await service.deleteSession('session-1', mockAuthContext);

      expect(sessionRepository.deleteSession).toHaveBeenCalled();
    });
  });

  describe('streamChatToResponse', () => {
    it('saves user message and signals Temporal workflow', async () => {
      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          parts: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const mockResponse = {
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      } as any;

      // Don't await - the stream stays open waiting for Redis events
      service.streamChatToResponse('session-1', messages as any, mockAuthContext, mockResponse);

      // Give it a tick to process
      await new Promise((r) => setTimeout(r, 50));

      expect(sessionRepository.saveMessage).toHaveBeenCalledWith('session-1', {
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      });
      expect(temporalService.signalChatWorkflow).toHaveBeenCalledWith('session-1', {
        id: 'msg-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      });
      expect(mockResponse.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          'Content-Type': 'text/event-stream',
          'X-Vercel-AI-UI-Message-Stream': 'v1',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        }),
      );
    });

    it('streams task progress updates as preliminary tool outputs', async () => {
      let streamCallbacks:
        | {
            onEvent: (event: any) => void;
            onComplete: () => void;
            onError: (err: Error) => void;
          }
        | undefined;

      (chatStreamService.subscribe as jest.Mock).mockImplementation((_sessionId, callbacks) => {
        streamCallbacks = callbacks;
        return { unsubscribe: jest.fn() };
      });

      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          parts: [{ type: 'text', text: 'Run workflow' }],
        },
      ];

      const mockResponse = {
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      } as any;

      service.streamChatToResponse('session-1', messages as any, mockAuthContext, mockResponse);
      await new Promise((r) => setTimeout(r, 20));

      streamCallbacks?.onEvent({
        type: 'tool-progress',
        toolCallId: 'call-1',
        output: { status: 'working', statusMessage: 'RUNNING' },
      });
      streamCallbacks?.onComplete();
      await new Promise((r) => setTimeout(r, 20));

      const writes = (mockResponse.write as jest.Mock).mock.calls.map((call) => String(call[0]));
      const progressWrite = writes.find(
        (line) =>
          line.includes('"type":"tool-output-available"') &&
          line.includes('"toolCallId":"call-1"') &&
          line.includes('"preliminary":true'),
      );

      expect(progressWrite).toBeDefined();
    });

    it('streams tool errors as tool-output-error events', async () => {
      let streamCallbacks:
        | {
            onEvent: (event: any) => void;
            onComplete: () => void;
            onError: (err: Error) => void;
          }
        | undefined;

      (chatStreamService.subscribe as jest.Mock).mockImplementation((_sessionId, callbacks) => {
        streamCallbacks = callbacks;
        return { unsubscribe: jest.fn() };
      });

      const messages = [
        {
          id: 'msg-1',
          role: 'user' as const,
          parts: [{ type: 'text', text: 'Run workflow' }],
        },
      ];

      const mockResponse = {
        writeHead: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      } as any;

      service.streamChatToResponse('session-1', messages as any, mockAuthContext, mockResponse);
      await new Promise((r) => setTimeout(r, 20));

      streamCallbacks?.onEvent({
        type: 'tool-error',
        toolCallId: 'call-err-1',
        errorText: 'HTTP 429 Too Many Requests',
      });
      streamCallbacks?.onComplete();
      await new Promise((r) => setTimeout(r, 20));

      const writes = (mockResponse.write as jest.Mock).mock.calls.map((call) => String(call[0]));
      const errorWrite = writes.find(
        (line) =>
          line.includes('"type":"tool-output-error"') &&
          line.includes('"toolCallId":"call-err-1"') &&
          line.includes('"errorText":"HTTP 429 Too Many Requests"'),
      );

      expect(errorWrite).toBeDefined();
    });
  });
});

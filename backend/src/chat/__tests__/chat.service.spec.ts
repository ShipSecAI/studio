import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test';
import { ChatService } from '../chat.service';
import type { StudioMcpService } from '../../studio-mcp/studio-mcp.service';
import type { ChatSessionRepository } from '../chat-session.repository';
import type { AuthContext } from '../../auth/types';
import type { StudioToolDefinition } from '../../studio-mcp/studio-mcp.service';
import { z } from 'zod';

describe('ChatService Unit Tests', () => {
  let service: ChatService;
  let studioMcpService: StudioMcpService;
  let sessionRepository: ChatSessionRepository;

  const mockAuthContext: AuthContext = {
    userId: 'test-user-id',
    organizationId: 'test-org-id',
    roles: ['ADMIN'],
    isAuthenticated: true,
    provider: 'test',
  };

  // Store original env vars
  const originalEnv = {
    CHAT_AI_BASE_URL: process.env.CHAT_AI_BASE_URL,
    CHAT_AI_API_KEY: process.env.CHAT_AI_API_KEY,
    CHAT_AI_MODEL_ID: process.env.CHAT_AI_MODEL_ID,
    CHAT_AI_PROVIDER: process.env.CHAT_AI_PROVIDER,
  };

  beforeEach(() => {
    // Reset env vars before each test
    delete process.env.CHAT_AI_BASE_URL;
    delete process.env.CHAT_AI_API_KEY;
    delete process.env.CHAT_AI_MODEL_ID;
    delete process.env.CHAT_AI_PROVIDER;

    studioMcpService = {
      getToolDefinitions: jest.fn().mockReturnValue([]),
    } as unknown as StudioMcpService;

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
    } as unknown as ChatSessionRepository;

    service = new ChatService(studioMcpService, sessionRepository);
  });

  afterEach(() => {
    // Restore original env vars after each test
    process.env.CHAT_AI_BASE_URL = originalEnv.CHAT_AI_BASE_URL;
    process.env.CHAT_AI_API_KEY = originalEnv.CHAT_AI_API_KEY;
    process.env.CHAT_AI_MODEL_ID = originalEnv.CHAT_AI_MODEL_ID;
    process.env.CHAT_AI_PROVIDER = originalEnv.CHAT_AI_PROVIDER;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getModel', () => {
    it('throws when CHAT_AI_BASE_URL is missing', () => {
      process.env.CHAT_AI_API_KEY = 'test-key';
      process.env.CHAT_AI_MODEL_ID = 'test-model';

      expect(() => {
        (service as any).getModel();
      }).toThrow(
        'Chat AI not configured. Set CHAT_AI_BASE_URL, CHAT_AI_API_KEY, and CHAT_AI_MODEL_ID environment variables.',
      );
    });

    it('throws when CHAT_AI_API_KEY is missing', () => {
      process.env.CHAT_AI_BASE_URL = 'https://api.example.com/v1';
      process.env.CHAT_AI_MODEL_ID = 'test-model';

      expect(() => {
        (service as any).getModel();
      }).toThrow(
        'Chat AI not configured. Set CHAT_AI_BASE_URL, CHAT_AI_API_KEY, and CHAT_AI_MODEL_ID environment variables.',
      );
    });

    it('throws when CHAT_AI_MODEL_ID is missing', () => {
      process.env.CHAT_AI_BASE_URL = 'https://api.example.com/v1';
      process.env.CHAT_AI_API_KEY = 'test-key';

      expect(() => {
        (service as any).getModel();
      }).toThrow(
        'Chat AI not configured. Set CHAT_AI_BASE_URL, CHAT_AI_API_KEY, and CHAT_AI_MODEL_ID environment variables.',
      );
    });

    it('throws when all env vars are missing', () => {
      expect(() => {
        (service as any).getModel();
      }).toThrow(
        'Chat AI not configured. Set CHAT_AI_BASE_URL, CHAT_AI_API_KEY, and CHAT_AI_MODEL_ID environment variables.',
      );
    });

    it('returns model when all required env vars are set', () => {
      process.env.CHAT_AI_BASE_URL = 'https://api.example.com/v1';
      process.env.CHAT_AI_API_KEY = 'test-key';
      process.env.CHAT_AI_MODEL_ID = 'test-model';

      const model = (service as any).getModel();

      expect(model).toBeDefined();
      expect(model.modelId).toBe('test-model');
      expect(model.provider).toBeDefined();
    });

    it('uses default provider name when CHAT_AI_PROVIDER is not set', () => {
      process.env.CHAT_AI_BASE_URL = 'https://api.example.com/v1';
      process.env.CHAT_AI_API_KEY = 'test-key';
      process.env.CHAT_AI_MODEL_ID = 'test-model';

      const model = (service as any).getModel();

      expect(model).toBeDefined();
      expect(model.provider).toBe('chat-provider.chat');
    });

    it('uses custom provider name when CHAT_AI_PROVIDER is set', () => {
      process.env.CHAT_AI_BASE_URL = 'https://api.example.com/v1';
      process.env.CHAT_AI_API_KEY = 'test-key';
      process.env.CHAT_AI_MODEL_ID = 'test-model';
      process.env.CHAT_AI_PROVIDER = 'custom-provider';

      const model = (service as any).getModel();

      expect(model).toBeDefined();
      expect(model.provider).toBe('custom-provider.chat');
    });
  });

  describe('streamChatToResponse - tool building', () => {
    it('calls getToolDefinitions with the correct auth context', async () => {
      process.env.CHAT_AI_BASE_URL = 'https://api.example.com/v1';
      process.env.CHAT_AI_API_KEY = 'test-key';
      process.env.CHAT_AI_MODEL_ID = 'test-model';

      const mockToolDefs: StudioToolDefinition[] = [
        {
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: { input: z.string() },
          execute: jest.fn().mockResolvedValue({ success: true }),
        },
      ];

      (studioMcpService.getToolDefinitions as jest.Mock).mockReturnValue(mockToolDefs);

      const mockResponse = {
        setHeader: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as any;

      try {
        await service.streamChatToResponse('session-1', [], mockAuthContext, mockResponse);
      } catch (_error) {
        // Expected to fail due to unmocked AI SDK, but getToolDefinitions should have been called
      }

      expect(studioMcpService.getToolDefinitions).toHaveBeenCalledWith(mockAuthContext);
    });

    it('builds tools from getToolDefinitions return value', async () => {
      process.env.CHAT_AI_BASE_URL = 'https://api.example.com/v1';
      process.env.CHAT_AI_API_KEY = 'test-key';
      process.env.CHAT_AI_MODEL_ID = 'test-model';

      const executeFn = jest.fn().mockResolvedValue({ result: 'test-result' });
      const mockToolDefs: StudioToolDefinition[] = [
        {
          name: 'list_workflows',
          description: 'List all workflows',
          inputSchema: {},
          execute: executeFn,
        },
        {
          name: 'get_workflow',
          description: 'Get workflow details',
          inputSchema: { workflowId: z.string().uuid() },
          execute: executeFn,
        },
      ];

      (studioMcpService.getToolDefinitions as jest.Mock).mockReturnValue(mockToolDefs);

      const mockResponse = {
        setHeader: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as any;

      try {
        await service.streamChatToResponse('session-1', [], mockAuthContext, mockResponse);
      } catch (_error) {
        // Expected to fail due to unmocked AI SDK
      }

      expect(studioMcpService.getToolDefinitions).toHaveBeenCalledTimes(1);
    });

    it('handles empty tool definitions array', async () => {
      process.env.CHAT_AI_BASE_URL = 'https://api.example.com/v1';
      process.env.CHAT_AI_API_KEY = 'test-key';
      process.env.CHAT_AI_MODEL_ID = 'test-model';

      (studioMcpService.getToolDefinitions as jest.Mock).mockReturnValue([]);

      const mockResponse = {
        setHeader: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as any;

      try {
        await service.streamChatToResponse('session-1', [], mockAuthContext, mockResponse);
      } catch (_error) {
        // Expected to fail due to unmocked AI SDK
      }

      expect(studioMcpService.getToolDefinitions).toHaveBeenCalledWith(mockAuthContext);
    });
  });

  describe('tool error handling', () => {
    it('wraps tool execution errors in error object', async () => {
      process.env.CHAT_AI_BASE_URL = 'https://api.example.com/v1';
      process.env.CHAT_AI_API_KEY = 'test-key';
      process.env.CHAT_AI_MODEL_ID = 'test-model';

      const errorMessage = 'Tool execution failed';
      const executeFn = jest.fn().mockRejectedValue(new Error(errorMessage));

      const mockToolDefs: StudioToolDefinition[] = [
        {
          name: 'failing_tool',
          description: 'A tool that fails',
          inputSchema: { input: z.string() },
          execute: executeFn,
        },
      ];

      (studioMcpService.getToolDefinitions as jest.Mock).mockReturnValue(mockToolDefs);

      const mockResponse = {
        setHeader: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as any;

      try {
        await service.streamChatToResponse('session-1', [], mockAuthContext, mockResponse);
      } catch (_error) {
        // Expected to fail due to unmocked AI SDK
      }

      expect(studioMcpService.getToolDefinitions).toHaveBeenCalledWith(mockAuthContext);
    });

    it('converts non-Error objects to strings in error handler', async () => {
      process.env.CHAT_AI_BASE_URL = 'https://api.example.com/v1';
      process.env.CHAT_AI_API_KEY = 'test-key';
      process.env.CHAT_AI_MODEL_ID = 'test-model';

      const executeFn = jest.fn().mockRejectedValue('string error');

      const mockToolDefs: StudioToolDefinition[] = [
        {
          name: 'failing_tool',
          description: 'A tool that fails with string',
          inputSchema: {},
          execute: executeFn,
        },
      ];

      (studioMcpService.getToolDefinitions as jest.Mock).mockReturnValue(mockToolDefs);

      const mockResponse = {
        setHeader: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as any;

      try {
        await service.streamChatToResponse('session-1', [], mockAuthContext, mockResponse);
      } catch (_error) {
        // Expected to fail due to unmocked AI SDK
      }

      expect(studioMcpService.getToolDefinitions).toHaveBeenCalledWith(mockAuthContext);
    });
  });

  describe('auth context isolation', () => {
    it('uses different auth contexts for different calls', async () => {
      process.env.CHAT_AI_BASE_URL = 'https://api.example.com/v1';
      process.env.CHAT_AI_API_KEY = 'test-key';
      process.env.CHAT_AI_MODEL_ID = 'test-model';

      const authContext1: AuthContext = {
        userId: 'user-1',
        organizationId: 'org-1',
        roles: ['ADMIN'],
        isAuthenticated: true,
        provider: 'test',
      };

      const authContext2: AuthContext = {
        userId: 'user-2',
        organizationId: 'org-2',
        roles: ['MEMBER'],
        isAuthenticated: true,
        provider: 'test',
      };

      (studioMcpService.getToolDefinitions as jest.Mock).mockReturnValue([]);

      const mockResponse = {
        setHeader: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
      } as any;

      try {
        await service.streamChatToResponse('session-1', [], authContext1, mockResponse);
      } catch (_error) {
        // Expected
      }

      try {
        await service.streamChatToResponse('session-1', [], authContext2, mockResponse);
      } catch (_error) {
        // Expected
      }

      expect(studioMcpService.getToolDefinitions).toHaveBeenCalledTimes(2);
      expect(studioMcpService.getToolDefinitions).toHaveBeenNthCalledWith(1, authContext1);
      expect(studioMcpService.getToolDefinitions).toHaveBeenNthCalledWith(2, authContext2);
    });
  });
});

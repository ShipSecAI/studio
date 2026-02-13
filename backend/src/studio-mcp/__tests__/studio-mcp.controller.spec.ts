import { describe, it, expect, beforeEach, jest } from 'bun:test';
import { StudioMcpController } from '../studio-mcp.controller';
import type { StudioMcpService } from '../studio-mcp.service';
import type { AuthContext } from '../../auth/types';
import type { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Access private sessions map for assertions
type SessionsMap = Map<
  string,
  { transport: unknown; userId: string | null; organizationId: string | null }
>;
function getSessions(controller: StudioMcpController): SessionsMap {
  return (controller as unknown as { sessions: SessionsMap }).sessions;
}

function createMockRes(): Response & { _status: number; _json: unknown } {
  const res = {
    _status: 200,
    _json: null,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._json = body;
      return res;
    },
    on: jest.fn(),
  } as unknown as Response & { _status: number; _json: unknown };
  return res;
}

function createMockReq(
  overrides: Partial<Request> & { auth?: AuthContext } = {},
): Request & { auth?: AuthContext } {
  return {
    method: 'POST',
    headers: {},
    header: jest.fn().mockReturnValue(undefined),
    body: {},
    ...overrides,
  } as unknown as Request & { auth?: AuthContext };
}

describe('StudioMcpController', () => {
  let controller: StudioMcpController;
  let mcpService: StudioMcpService;

  const authUser1: AuthContext = {
    userId: 'user-1',
    organizationId: 'org-1',
    roles: ['MEMBER'],
    isAuthenticated: true,
    provider: 'api-key',
    apiKeyPermissions: {
      workflows: { run: true, list: true, read: true },
      runs: { read: true, cancel: true },
    },
  };

  const authUser2: AuthContext = {
    userId: 'user-2',
    organizationId: 'org-2',
    roles: ['MEMBER'],
    isAuthenticated: true,
    provider: 'api-key',
    apiKeyPermissions: {
      workflows: { run: true, list: true, read: true },
      runs: { read: true, cancel: true },
    },
  };

  beforeEach(() => {
    mcpService = {
      createServer: jest.fn().mockReturnValue(new McpServer({ name: 'test', version: '1.0.0' })),
    } as unknown as StudioMcpService;

    controller = new StudioMcpController(mcpService);
  });

  it('rejects unauthenticated requests with 401', async () => {
    const req = createMockReq({ auth: undefined });
    const res = createMockRes();

    await controller.handleMcp(req, res);

    expect(res._status).toBe(401);
    expect(res._json).toEqual({
      error: 'Authentication required. Use Bearer sk_live_* API key.',
    });
  });

  it('rejects requests without session ID and without initialize body with 400', async () => {
    const req = createMockReq({
      auth: authUser1,
      method: 'POST',
      headers: {},
      body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    });
    const res = createMockRes();

    await controller.handleMcp(req, res);

    expect(res._status).toBe(400);
  });

  it('returns 404 for unknown session ID', async () => {
    const req = createMockReq({
      auth: authUser1,
      headers: { 'mcp-session-id': 'nonexistent-session' },
    });
    const res = createMockRes();

    await controller.handleMcp(req, res);

    expect(res._status).toBe(404);
    expect(res._json).toEqual({ error: 'Session not found or expired' });
  });

  describe('session identity binding', () => {
    it('rejects session reuse from different user with 403', async () => {
      // Manually insert a session owned by user-1
      const sessions = getSessions(controller);
      const mockTransport = { handleRequest: jest.fn() };
      sessions.set('test-session-id', {
        transport: mockTransport,
        userId: authUser1.userId,
        organizationId: authUser1.organizationId,
      });

      // User-2 tries to use user-1's session
      const req = createMockReq({
        auth: authUser2,
        method: 'POST',
        headers: { 'mcp-session-id': 'test-session-id' },
        body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      });
      const res = createMockRes();

      await controller.handleMcp(req, res);

      expect(res._status).toBe(403);
      expect(res._json).toEqual({ error: 'Session belongs to a different principal' });
      expect(mockTransport.handleRequest).not.toHaveBeenCalled();
    });

    it('rejects session reuse from different org with 403', async () => {
      const sessions = getSessions(controller);
      const mockTransport = { handleRequest: jest.fn() };
      sessions.set('test-session-id', {
        transport: mockTransport,
        userId: authUser1.userId,
        organizationId: authUser1.organizationId,
      });

      // Same user ID but different org
      const crossOrgAuth: AuthContext = {
        ...authUser1,
        organizationId: 'different-org',
      };
      const req = createMockReq({
        auth: crossOrgAuth,
        method: 'POST',
        headers: { 'mcp-session-id': 'test-session-id' },
        body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      });
      const res = createMockRes();

      await controller.handleMcp(req, res);

      expect(res._status).toBe(403);
      expect(mockTransport.handleRequest).not.toHaveBeenCalled();
    });

    it('allows session reuse from same principal', async () => {
      const sessions = getSessions(controller);
      const mockTransport = { handleRequest: jest.fn() };
      sessions.set('test-session-id', {
        transport: mockTransport,
        userId: authUser1.userId,
        organizationId: authUser1.organizationId,
      });

      const req = createMockReq({
        auth: authUser1,
        method: 'POST',
        headers: { 'mcp-session-id': 'test-session-id' },
        body: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
      });
      const res = createMockRes();

      await controller.handleMcp(req, res);

      // Should have forwarded to the transport, not returned an error
      expect(res._status).toBe(200); // not changed to 403 or 404
      expect(mockTransport.handleRequest).toHaveBeenCalled();
    });

    it('cleans up session on DELETE from same principal', async () => {
      const sessions = getSessions(controller);
      const mockTransport = { handleRequest: jest.fn() };
      sessions.set('test-session-id', {
        transport: mockTransport,
        userId: authUser1.userId,
        organizationId: authUser1.organizationId,
      });

      const req = createMockReq({
        auth: authUser1,
        method: 'DELETE',
        headers: { 'mcp-session-id': 'test-session-id' },
      });
      const res = createMockRes();

      await controller.handleMcp(req, res);

      expect(sessions.has('test-session-id')).toBe(false);
      expect(mockTransport.handleRequest).toHaveBeenCalled();
    });
  });
});

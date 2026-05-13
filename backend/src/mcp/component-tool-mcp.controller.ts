import { Controller, All, Req, Res, Logger, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import { Public } from '../auth/public.decorator';
import { ComponentToolMcpService } from './component-tool-mcp.service';

/**
 * Serves component tools as an MCP endpoint scoped to a single workflow run.
 *
 * This endpoint is called by the Hotplug gateway (not by external agents).
 * Authentication uses the internal service token (`x-internal-token` header).
 *
 * Route: POST /api/v1/mcp/run-tools/:runId   — Streamable HTTP MCP transport
 *
 * The transport is stateless (no session ID persistence): each request creates
 * a new transport that is discarded after the response is sent. This matches
 * how the Hotplug stdio-proxy forwards JSON-RPC over HTTP without session state.
 */

const INTERNAL_TOKEN = process.env.INTERNAL_SERVICE_TOKEN ?? 'local-internal-token';

interface RunToolsRequest extends Request {
  params: { runId: string };
}

interface McpSession {
  transport: StreamableHTTPServerTransport;
  createdAtMs: number;
  lastTouchedAtMs: number;
}

@ApiTags('mcp')
@Controller('mcp/run-tools')
@Public()
export class ComponentToolMcpController {
  private readonly logger = new Logger(ComponentToolMcpController.name);
  private static readonly SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes

  // In-memory session map keyed by MCP session ID.
  // NOTE: Single-instance design. For horizontal scaling, use sticky sessions.
  private readonly sessions = new Map<string, McpSession & { runId: string }>();

  constructor(private readonly componentToolMcpService: ComponentToolMcpService) {}

  private pruneExpiredSessions(nowMs = Date.now()): void {
    for (const [id, session] of this.sessions.entries()) {
      if (nowMs - session.lastTouchedAtMs <= ComponentToolMcpController.SESSION_TTL_MS) continue;
      this.logger.warn(`ComponentToolMcp session expired by TTL: ${id}`);
      this.cleanupSession(id, session);
    }
  }

  private cleanupSession(
    sessionId: string,
    session: { transport: StreamableHTTPServerTransport },
  ): void {
    this.sessions.delete(sessionId);
    const transport = session.transport as unknown as { close?: () => void | Promise<void> };
    Promise.resolve(transport.close?.()).catch(() => {});
  }

  @All(':runId')
  @ApiOperation({ summary: 'Component tool MCP endpoint (Streamable HTTP) for Hotplug gateway' })
  async handleMcp(@Req() req: RunToolsRequest, @Res() res: Response) {
    this.pruneExpiredSessions();

    // Validate internal token
    const tokenHeader = req.headers['x-internal-token'];
    if (!tokenHeader || tokenHeader !== INTERNAL_TOKEN) {
      throw new UnauthorizedException('Missing or invalid x-internal-token');
    }

    const { runId } = req.params;
    if (!runId) {
      return res.status(400).json({ error: 'runId is required' });
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const body = req.body as unknown;
    const isPost = req.method === 'POST';
    const isGet = req.method === 'GET';
    const isDelete = req.method === 'DELETE';
    const isInitRequest =
      isPost &&
      (isInitializeRequest(body) ||
        (Array.isArray(body) && body.some((item) => isInitializeRequest(item))));

    // ---- Existing session ----
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }

      // Ensure the session belongs to this run
      if (session.runId !== runId) {
        return res.status(403).json({ error: 'Session belongs to a different run' });
      }

      session.lastTouchedAtMs = Date.now();
      const { transport } = session;

      if (isGet) {
        res.on('close', () => {
          // Keep the MCP session alive when the SSE connection closes. Hotplug and
          // proxies can reconnect GET streams while POST tool calls still need the
          // same session ID.
          this.logger.log(
            `ComponentToolMcp SSE connection closed for session ${sessionId} (session kept alive)`,
          );
          session.lastTouchedAtMs = Date.now();
        });
        void transport.handleRequest(req as any, res as any);
      } else if (isDelete) {
        this.logger.log(`ComponentToolMcp session terminated: ${sessionId}`);
        await transport.handleRequest(req as any, res as any, body);
        this.cleanupSession(sessionId, session);
      } else {
        await transport.handleRequest(req as any, res as any, body);
      }
      return;
    }

    // ---- New session (initialize) ----
    if (!isInitRequest) {
      return res
        .status(400)
        .json({ error: 'Missing Mcp-Session-Id header. Send an initialize request first.' });
    }

    this.logger.log(`[ComponentToolMcp] New session for run=${runId}`);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });

    try {
      const server = await this.componentToolMcpService.getServerForRun(runId);
      await server.connect(transport);
    } catch (error) {
      this.logger.error(`[ComponentToolMcp] Failed to create server for run=${runId}: ${error}`);
      return res.status(500).json({ error: 'Failed to initialize MCP server for run' });
    }

    // Handle the initialize request (sends response with Mcp-Session-Id header)
    await transport.handleRequest(req as any, res as any, body);

    // Store session keyed by the generated session ID
    if (transport.sessionId) {
      const nowMs = Date.now();
      this.sessions.set(transport.sessionId, {
        transport,
        runId,
        createdAtMs: nowMs,
        lastTouchedAtMs: nowMs,
      });
      this.logger.log(
        `[ComponentToolMcp] Session created: ${transport.sessionId} for run=${runId}`,
      );
    }
  }
}

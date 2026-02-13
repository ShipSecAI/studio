import { Controller, All, Req, Res, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import type { AuthContext } from '../auth/types';
import { StudioMcpService } from './studio-mcp.service';

/**
 * Exposes ShipSec Studio as an MCP server for external agents.
 *
 * Auth: Uses global AuthGuard which validates Bearer sk_live_* API keys.
 * Protocol: MCP Streamable HTTP only (POST for messages, GET for server-push, DELETE for session end).
 *
 * Endpoint: /api/v1/studio-mcp
 */
@ApiTags('studio-mcp')
@Controller('studio-mcp')
export class StudioMcpController {
  private readonly logger = new Logger(StudioMcpController.name);

  // Active session transports keyed by MCP session ID.
  // NOTE: In-memory — single-instance design. For horizontal scaling, use sticky sessions.
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(private readonly studioMcpService: StudioMcpService) {}

  @All()
  @ApiOperation({ summary: 'Studio MCP endpoint (Streamable HTTP) for external agents' })
  async handleMcp(@Req() req: Request & { auth?: AuthContext }, @Res() res: Response) {
    const auth = req.auth;
    if (!auth?.isAuthenticated) {
      return res
        .status(401)
        .json({ error: 'Authentication required. Use Bearer sk_live_* API key.' });
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
      const transport = this.transports.get(sessionId);
      if (!transport) {
        return res.status(404).json({ error: 'Session not found or expired' });
      }

      if (isGet) {
        res.on('close', () => {
          this.logger.log(`Studio MCP SSE closed for session ${sessionId}`);
          this.transports.delete(sessionId);
        });
        // Cast: Express Request extends IncomingMessage; handleRequest accepts it at runtime
        void transport.handleRequest(req as any, res as any);
      } else if (isDelete) {
        this.logger.log(`Studio MCP session terminated: ${sessionId}`);
        await transport.handleRequest(req as any, res as any, body);
        this.transports.delete(sessionId);
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

    this.logger.log(
      `New Studio MCP session for org=${auth.organizationId}, provider=${auth.provider}`,
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });

    const server = this.studioMcpService.createServer(auth);
    await server.connect(transport);

    // Handle the initialize request (sends response with Mcp-Session-Id header)
    await transport.handleRequest(req as any, res as any, body);

    // Store transport by the session ID generated during initialize
    if (transport.sessionId) {
      this.transports.set(transport.sessionId, transport);
      this.logger.log(`Studio MCP session created: ${transport.sessionId}`);
    }
  }
}

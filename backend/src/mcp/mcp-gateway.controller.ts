import { Controller, All, UseGuards, Req, Res, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { Public } from '../auth/public.decorator';
import { McpAuthGuard, type McpGatewayRequest } from './mcp-auth.guard';
import { McpGatewayService } from './mcp-gateway.service';

@ApiTags('mcp')
@Controller('mcp')
@Public()
@UseGuards(McpAuthGuard)
export class McpGatewayController {
  private readonly logger = new Logger(McpGatewayController.name);

  // Mapping of runId to its current Streamable HTTP transport
  private readonly transports = new Map<string, StreamableHTTPServerTransport>();

  constructor(private readonly mcpGateway: McpGatewayService) {}

  @All('gateway')
  @ApiOperation({ summary: 'Unified MCP Gateway endpoint (Streamable HTTP)' })
  async handleGateway(@Req() req: McpGatewayRequest, @Res() res: Response) {
    const auth = req.auth;
    if (!auth || !auth.extra) {
      return res.status(401).send('Authentication missing');
    }

    const runId = auth.extra.runId as string;
    const organizationId = auth.extra.organizationId as string | null;

    if (!runId) {
      return res.status(400).send('runId missing in session token');
    }

    let transport = this.transports.get(runId);

    // Initialization if transport doesn't exist
    if (!transport) {
      this.logger.log(`Initializing new MCP transport for run: ${runId}`);

      const allowedToolsHeader = req.headers['x-allowed-tools'];
      const allowedTools =
        typeof allowedToolsHeader === 'string'
          ? allowedToolsHeader.split(',').map((t) => t.trim())
          : undefined;

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => runId,
      });
      this.transports.set(runId, transport);

      try {
        const server = await this.mcpGateway.getServerForRun(runId, organizationId, allowedTools);
        await server.connect(transport);
      } catch (error) {
        this.logger.error(`Failed to initialize MCP server for run ${runId}: ${error}`);
        this.transports.delete(runId);
        return res
          .status(error instanceof Error && error.name === 'NotFoundException' ? 404 : 403)
          .send(error instanceof Error ? error.message : 'Access denied');
      }
    }

    if (req.method === 'GET') {
      // Cleanup on client disconnect (specifically for the SSE stream)
      res.on('close', async () => {
        this.logger.log(`MCP SSE connection closed for run: ${runId}`);
        // We don't necessarily want to delete the transport here if POSTs are still allowed,
        // but for ShipSec run-bounded sessions, closing SSE usually means the agent is done.
        this.transports.delete(runId);
        await this.mcpGateway.cleanupRun(runId);
      });

      // Handle the initial GET request to start the SSE stream
      // We don't await this because for SSE, it blocks until the connection is closed.
      void transport.handleRequest(req, res);
    } else {
      // Handle POST (Messages) or DELETE (Session termination)
      await transport.handleRequest(req, res, req.body);
    }
  }
}

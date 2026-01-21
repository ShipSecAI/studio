import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { McpAuthService } from './mcp-auth.service';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/**
 * Request interface for MCP Gateway which uses spec-compliant AuthInfo
 */
export interface McpGatewayRequest extends Request {
  auth?: AuthInfo;
}

@Injectable()
export class McpAuthGuard implements CanActivate {
  private readonly logger = new Logger(McpAuthGuard.name);

  constructor(private readonly mcpAuthService: McpAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<McpGatewayRequest>();

    let token: string | undefined;

    // Try Authorization header (Standard Bearer token)
    const authHeader = request.headers['authorization'];
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
      this.logger.log(`Found Bearer token in Authorization header for ${request.url}`);
    }

    if (!token) {
      this.logger.warn(`Missing or invalid Authorization header for MCP request to ${request.url}`);
      throw new UnauthorizedException('Bearer token required in Authorization header');
    }

    const authInfo = await this.mcpAuthService.validateToken(token);
    if (authInfo) {
      this.logger.log(`Successfully validated MCP session token for run: ${authInfo.extra?.runId}`);
    }

    if (!authInfo) {
      this.logger.warn('Invalid or expired MCP session token');
      throw new UnauthorizedException('Invalid or expired session token');
    }

    // Attach spec-compliant auth info to request
    request.auth = authInfo;

    return true;
  }
}

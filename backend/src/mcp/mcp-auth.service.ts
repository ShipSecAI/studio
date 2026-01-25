import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { uuid4 } from '@temporalio/workflow';
import { TOOL_REGISTRY_REDIS } from './tool-registry.service';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export interface McpSessionMetadata {
  runId: string;
  organizationId: string | null;
  agentId?: string;
  allowedNodeIds?: string[];
  expiresAt: number;
}

@Injectable()
export class McpAuthService {
  private readonly logger = new Logger(McpAuthService.name);
  private readonly TOKEN_PREFIX = 'mcp:session:';

  constructor(@Inject(TOOL_REGISTRY_REDIS) private readonly redis: Redis) {}

  /**
   * Generate a secure, short-lived session token for an MCP agent
   */
  async generateSessionToken(
    runId: string,
    organizationId: string | null,
    agentId = 'agent',
    allowedNodeIds?: string[],
    ttlSeconds = 3600, // 1 hour default
  ): Promise<string> {
    const token = `mcp_sk_${uuid4().replace(/-/g, '')}`;
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

    const metadata: McpSessionMetadata = {
      runId,
      organizationId,
      agentId,
      allowedNodeIds,
      expiresAt,
    };

    await this.redis.set(
      `${this.TOKEN_PREFIX}${token}`,
      JSON.stringify(metadata),
      'EX',
      ttlSeconds,
    );

    return token;
  }

  /**
   * Validate a session token and return the corresponding AuthInfo
   */
  async validateToken(token: string): Promise<AuthInfo | null> {
    const data = await this.redis.get(`${this.TOKEN_PREFIX}${token}`);
    if (!data) {
      return null;
    }

    try {
      const metadata: McpSessionMetadata = JSON.parse(data);

      // Map to MCP Spec AuthInfo
      return {
        token,
        clientId: metadata.agentId || 'unknown-agent',
        scopes: ['tools:list', 'tools:call', 'resources:list'],
        expiresAt: metadata.expiresAt,
        extra: {
          runId: metadata.runId,
          organizationId: metadata.organizationId,
          allowedNodeIds: metadata.allowedNodeIds,
        },
      };
    } catch (err) {
      this.logger.error(`Failed to parse MCP session metadata: ${err}`);
      return null;
    }
  }

  /**
   * Revoke a specific session token
   */
  async revokeToken(token: string): Promise<void> {
    await this.redis.del(`${this.TOKEN_PREFIX}${token}`);
  }
}

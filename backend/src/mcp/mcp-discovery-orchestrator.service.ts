import { Injectable, Logger, BadRequestException, Inject, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';

import { TemporalService } from '../temporal/temporal.service';
import type {
  DiscoveryInputDto,
  DiscoveryStatusDto,
  DiscoveryStartResponseDto,
  GroupDiscoveryInputDto,
  GroupDiscoveryStartResponseDto,
  GroupDiscoveryStatusDto,
} from './dto/mcp-discovery.dto';
import { MCP_DISCOVERY_REDIS } from './mcp.tokens';

@Injectable()
export class McpDiscoveryOrchestratorService implements OnModuleDestroy {
  private readonly logger = new Logger(McpDiscoveryOrchestratorService.name);

  constructor(
    private readonly temporalService: TemporalService,
    @Inject(MCP_DISCOVERY_REDIS) private readonly redis: Redis,
  ) {}

  async onModuleDestroy(): Promise<void> {
    // Best-effort shutdown.
    try {
      await this.redis.quit();
    } catch {
      // ignore
    }
  }

  async startDiscovery(input: DiscoveryInputDto): Promise<DiscoveryStartResponseDto> {
    const workflowId = randomUUID();
    const cacheToken = randomUUID();

    this.logger.log(
      `Starting MCP discovery workflow ${workflowId} for ${input.transport} server: ${input.name} (cache: ${cacheToken})`,
    );

    // Store cache token in Redis (worker populates final result); expire in 5 minutes.
    await this.redis.setex(
      `mcp-discovery:${cacheToken}`,
      300,
      JSON.stringify({ status: 'pending', workflowId }),
    );

    await this.temporalService.startWorkflow({
      workflowType: 'mcpDiscoveryWorkflow',
      workflowId,
      taskQueue: this.temporalService.getDefaultTaskQueue(),
      args: [{ ...input, cacheToken }],
    });

    return { workflowId, cacheToken, status: 'started' };
  }

  async getStatus(workflowId: string): Promise<DiscoveryStatusDto> {
    this.logger.debug(`Querying MCP discovery status for workflow ${workflowId}`);

    const result = await this.temporalService.queryWorkflow<{
      status: 'running' | 'completed' | 'failed';
      tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
      toolCount?: number;
      error?: string;
      errorCode?: string;
    }>({
      workflowId,
      queryType: 'getDiscoveryResult',
    });

    if (!result) {
      return { workflowId, status: 'running' };
    }

    return {
      workflowId,
      status: result.status,
      tools: result.tools,
      toolCount: result.toolCount,
      error: result.error,
      errorCode: result.errorCode,
    };
  }

  async startGroupDiscovery(
    input: GroupDiscoveryInputDto,
  ): Promise<GroupDiscoveryStartResponseDto> {
    const workflowId = randomUUID();
    const cacheTokens: Record<string, string> = {};

    const serverNames = input.servers.map((server) => server.name);
    const uniqueNames = new Set(serverNames);
    if (uniqueNames.size !== serverNames.length) {
      throw new BadRequestException('Server names must be unique for group discovery');
    }

    for (const server of input.servers) {
      cacheTokens[server.name] = randomUUID();
    }

    this.logger.log(
      `Starting MCP group discovery workflow ${workflowId} for ${input.servers.length} server(s)`,
    );

    await Promise.all(
      Object.values(cacheTokens).map((cacheToken) =>
        this.redis.setex(
          `mcp-discovery:${cacheToken}`,
          300,
          JSON.stringify({ status: 'pending', workflowId }),
        ),
      ),
    );

    await this.temporalService.startWorkflow({
      workflowType: 'mcpGroupDiscoveryWorkflow',
      workflowId,
      taskQueue: this.temporalService.getDefaultTaskQueue(),
      args: [{ ...input, cacheTokens }],
    });

    return { workflowId, cacheTokens, status: 'started' };
  }

  async getGroupStatus(workflowId: string): Promise<GroupDiscoveryStatusDto> {
    this.logger.debug(`Querying MCP group discovery status for workflow ${workflowId}`);

    const result = await this.temporalService.queryWorkflow<{
      status: 'running' | 'completed' | 'failed';
      results?: {
        name: string;
        status: 'running' | 'completed' | 'failed';
        tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
        toolCount?: number;
        error?: string;
        cacheToken?: string;
      }[];
      error?: string;
      errorCode?: string;
    }>({
      workflowId,
      queryType: 'getGroupDiscoveryResult',
    });

    if (!result) {
      return { workflowId, status: 'running' };
    }

    return {
      workflowId,
      status: result.status,
      results: result.results,
      error: result.error,
      errorCode: result.errorCode,
    };
  }
}

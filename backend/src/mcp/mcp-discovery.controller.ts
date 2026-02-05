import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerApiResponse } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

import { TemporalService } from '../temporal/temporal.service';
import {
  DiscoveryInputDto,
  DiscoveryStatusDto,
  DiscoveryStartResponseDto,
  GroupDiscoveryInputDto,
  GroupDiscoveryStartResponseDto,
  GroupDiscoveryStatusDto,
} from './dto/mcp-discovery.dto';

@ApiTags('mcp')
@Controller('mcp')
export class McpDiscoveryController {
  private readonly logger = new Logger(McpDiscoveryController.name);
  private readonly redis: Redis;

  constructor(private readonly temporalService: TemporalService) {
    // Initialize Redis for caching discovery results
    const redisUrl = process.env.REDIS_URL || process.env.TERMINAL_REDIS_URL;
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    } else {
      // Fallback to localhost
      this.redis = new Redis('redis://localhost:6379');
    }
  }

  @Post('discover')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start MCP tool discovery',
    description:
      'Initiates an asynchronous discovery workflow for an MCP server. Returns 202 ACCEPTED with a workflow ID for tracking progress.',
  })
  @SwaggerApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Discovery workflow started successfully',
    type: DiscoveryStartResponseDto,
  })
  @SwaggerApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input parameters',
  })
  async discover(@Body() input: DiscoveryInputDto): Promise<DiscoveryStartResponseDto> {
    const workflowId = randomUUID();
    const cacheToken = randomUUID();

    this.logger.log(
      `Starting MCP discovery workflow ${workflowId} for ${input.transport} server: ${input.name} (cache: ${cacheToken})`,
    );

    try {
      // Store cache token in Redis (will be populated when discovery completes)
      // Expires in 5 minutes
      await this.redis.setex(
        `mcp-discovery:${cacheToken}`,
        300,
        JSON.stringify({ status: 'pending', workflowId }),
      );

      // Start Temporal workflow for MCP discovery with cache token
      await this.temporalService.startWorkflow({
        workflowType: 'mcpDiscoveryWorkflow',
        workflowId,
        taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'shipsec-dev',
        args: [{ ...input, cacheToken }],
      });

      this.logger.log(`MCP discovery workflow ${workflowId} started successfully`);

      return {
        workflowId,
        cacheToken,
        status: 'started',
      };
    } catch (error) {
      this.logger.error(
        `Failed to start MCP discovery workflow ${workflowId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  @Get('discover/:workflowId')
  @ApiOperation({
    summary: 'Get MCP discovery status',
    description:
      'Queries the status of an MCP discovery workflow by workflow ID. Returns current status and discovered tools if available.',
  })
  @SwaggerApiResponse({
    status: HttpStatus.OK,
    description: 'Discovery status retrieved successfully',
    type: DiscoveryStatusDto,
  })
  @SwaggerApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Workflow not found',
  })
  async getStatus(@Param('workflowId') workflowId: string): Promise<DiscoveryStatusDto> {
    this.logger.debug(`Querying MCP discovery status for workflow ${workflowId}`);

    try {
      // Query workflow for current result
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

      if (result) {
        return {
          workflowId,
          status: result.status,
          tools: result.tools,
          toolCount: result.toolCount,
          error: result.error,
          errorCode: result.errorCode,
        };
      }

      // Workflow is still running, no result yet
      return {
        workflowId,
        status: 'running',
      };
    } catch (error) {
      // Workflow not found or query failed
      if (error instanceof Error && error.message.includes('workflow not found')) {
        this.logger.warn(`Discovery workflow ${workflowId} not found`);
        throw error;
      }

      this.logger.error(
        `Failed to query discovery workflow ${workflowId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  @Post('discover-group')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start MCP group tool discovery',
    description:
      'Initiates an asynchronous discovery workflow for multiple MCP servers. Returns 202 ACCEPTED with a workflow ID for tracking progress.',
  })
  @SwaggerApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Group discovery workflow started successfully',
    type: GroupDiscoveryStartResponseDto,
  })
  async discoverGroup(
    @Body() input: GroupDiscoveryInputDto,
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

    try {
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
        taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'shipsec-dev',
        args: [{ ...input, cacheTokens }],
      });

      this.logger.log(`MCP group discovery workflow ${workflowId} started successfully`);

      return {
        workflowId,
        cacheTokens,
        status: 'started',
      };
    } catch (error) {
      this.logger.error(
        `Failed to start MCP group discovery workflow ${workflowId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  @Get('discover-group/:workflowId')
  @ApiOperation({
    summary: 'Get MCP group discovery status',
    description:
      'Queries the status of an MCP group discovery workflow by workflow ID. Returns current status and discovered tools if available.',
  })
  @SwaggerApiResponse({
    status: HttpStatus.OK,
    description: 'Group discovery status retrieved successfully',
    type: GroupDiscoveryStatusDto,
  })
  async getGroupStatus(
    @Param('workflowId') workflowId: string,
  ): Promise<GroupDiscoveryStatusDto> {
    this.logger.debug(`Querying MCP group discovery status for workflow ${workflowId}`);

    try {
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

      if (result) {
        return {
          workflowId,
          status: result.status,
          results: result.results,
          error: result.error,
          errorCode: result.errorCode,
        };
      }

      return {
        workflowId,
        status: 'running',
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('workflow not found')) {
        this.logger.warn(`Group discovery workflow ${workflowId} not found`);
        throw error;
      }

      this.logger.error(
        `Failed to query group discovery workflow ${workflowId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}

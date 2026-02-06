import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse as SwaggerApiResponse } from '@nestjs/swagger';

import { McpDiscoveryOrchestratorService } from './mcp-discovery-orchestrator.service';
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
  constructor(private readonly orchestrator: McpDiscoveryOrchestratorService) {}

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
    return this.orchestrator.startDiscovery(input);
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
    return this.orchestrator.getStatus(workflowId);
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
    return this.orchestrator.startGroupDiscovery(input);
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
  async getGroupStatus(@Param('workflowId') workflowId: string): Promise<GroupDiscoveryStatusDto> {
    return this.orchestrator.getGroupStatus(workflowId);
  }
}

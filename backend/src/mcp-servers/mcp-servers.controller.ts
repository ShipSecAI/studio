import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiOperation,
} from '@nestjs/swagger';

import { McpServersService } from './mcp-servers.service';
import {
  CreateMcpServerDto,
  UpdateMcpServerDto,
  McpServerResponse,
  McpToolResponse,
  TestConnectionResponse,
  HealthStatusResponse,
} from './mcp-servers.dto';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('mcp-servers')
@Controller('mcp-servers')
export class McpServersController {
  constructor(private readonly mcpServersService: McpServersService) {}

  @Get()
  @ApiOperation({ summary: 'List all MCP servers' })
  @ApiOkResponse({ type: [McpServerResponse] })
  async listServers(
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<McpServerResponse[]> {
    return this.mcpServersService.listServers(auth);
  }

  @Get('enabled')
  @ApiOperation({ summary: 'List enabled MCP servers only' })
  @ApiOkResponse({ type: [McpServerResponse] })
  async listEnabledServers(
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<McpServerResponse[]> {
    return this.mcpServersService.listEnabledServers(auth);
  }

  @Get('tools')
  @ApiOperation({ summary: 'List all tools from enabled MCP servers' })
  @ApiOkResponse({ type: [McpToolResponse] })
  async getAllTools(
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<McpToolResponse[]> {
    return this.mcpServersService.getAllTools(auth);
  }

  @Get('health')
  @ApiOperation({ summary: 'Get health status of all enabled servers' })
  @ApiOkResponse({ type: [HealthStatusResponse] })
  async getHealthStatuses(
    @CurrentAuth() auth: AuthContext | null,
  ): Promise<HealthStatusResponse[]> {
    return this.mcpServersService.getHealthStatuses(auth);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific MCP server' })
  @ApiOkResponse({ type: McpServerResponse })
  async getServer(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<McpServerResponse> {
    return this.mcpServersService.getServer(auth, id);
  }

  @Get(':id/tools')
  @ApiOperation({ summary: 'List discovered tools from a server' })
  @ApiOkResponse({ type: [McpToolResponse] })
  async getServerTools(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<McpToolResponse[]> {
    return this.mcpServersService.getServerTools(auth, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new MCP server configuration' })
  @ApiCreatedResponse({ type: McpServerResponse })
  async createServer(
    @CurrentAuth() auth: AuthContext | null,
    @Body() body: CreateMcpServerDto,
  ): Promise<McpServerResponse> {
    return this.mcpServersService.createServer(auth, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an MCP server configuration' })
  @ApiOkResponse({ type: McpServerResponse })
  async updateServer(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateMcpServerDto,
  ): Promise<McpServerResponse> {
    return this.mcpServersService.updateServer(auth, id, body);
  }

  @Post(':id/toggle')
  @ApiOperation({ summary: 'Toggle MCP server enabled/disabled status' })
  @ApiOkResponse({ type: McpServerResponse })
  async toggleServer(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<McpServerResponse> {
    return this.mcpServersService.toggleServer(auth, id);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Test connection to an MCP server' })
  @ApiOkResponse({ type: TestConnectionResponse })
  async testConnection(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TestConnectionResponse> {
    return this.mcpServersService.testServerConnection(auth, id);
  }

  @Post(':id/discover')
  @ApiOperation({ summary: 'Force re-discover tools from an MCP server' })
  @ApiOkResponse({ type: [McpToolResponse] })
  async discoverTools(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<McpToolResponse[]> {
    // For now, return existing tools - actual discovery will be in Phase 3
    // when we integrate the MCP client service
    return this.mcpServersService.getServerTools(auth, id);
  }

  @Post(':serverId/tools/:toolId/toggle')
  @ApiOperation({ summary: 'Toggle a tool enabled/disabled state' })
  @ApiOkResponse({ type: McpToolResponse })
  async toggleToolEnabled(
    @CurrentAuth() auth: AuthContext | null,
    @Param('serverId', new ParseUUIDPipe()) serverId: string,
    @Param('toolId', new ParseUUIDPipe()) toolId: string,
  ): Promise<McpToolResponse> {
    return this.mcpServersService.toggleToolEnabled(auth, serverId, toolId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an MCP server configuration' })
  @ApiNoContentResponse()
  async deleteServer(
    @CurrentAuth() auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.mcpServersService.deleteServer(auth, id);
  }
}

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
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';

import { McpGroupsService } from './mcp-groups.service';
import {
  CreateMcpGroupDto,
  UpdateMcpGroupDto,
  McpGroupResponse,
  McpGroupServerResponse,
  AddServerToGroupDto,
  UpdateServerInGroupDto,
  SyncTemplatesResponse,
  GroupTemplateDto,
  ImportTemplateRequestDto,
  ImportGroupTemplateResponse,
} from './dto/mcp-groups.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentAuth } from '../auth/auth-context.decorator';
import type { AuthContext } from '../auth/types';

@ApiTags('mcp-groups')
@Controller('mcp-groups')
export class McpGroupsController {
  constructor(private readonly mcpGroupsService: McpGroupsService) {}

  @Get()
  @ApiOperation({ summary: 'List all MCP groups' })
  @ApiQuery({ name: 'enabled', required: false, type: Boolean })
  @ApiOkResponse({ type: [McpGroupResponse] })
  async listGroups(@Query('enabled') enabled?: string): Promise<McpGroupResponse[]> {
    const enabledOnly = enabled === 'true';
    return this.mcpGroupsService.listGroups(enabledOnly);
  }

  @Get('templates')
  @ApiOperation({ summary: 'List available MCP group templates' })
  @ApiOkResponse()
  async listTemplates() {
    return this.mcpGroupsService.listTemplates();
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get a group by slug' })
  @ApiOkResponse({ type: McpGroupResponse })
  async getGroupBySlug(@Param('slug') slug: string): Promise<McpGroupResponse> {
    return this.mcpGroupsService.getGroupBySlug(slug);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific MCP group' })
  @ApiOkResponse({ type: McpGroupResponse })
  async getGroup(@Param('id', new ParseUUIDPipe()) id: string): Promise<McpGroupResponse> {
    return this.mcpGroupsService.getGroup(id);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Create a new MCP group (admin only)' })
  @ApiCreatedResponse({ type: McpGroupResponse })
  async createGroup(
    @CurrentAuth() _auth: AuthContext | null,
    @Body() body: CreateMcpGroupDto,
  ): Promise<McpGroupResponse> {
    return this.mcpGroupsService.createGroup(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an MCP group' })
  @ApiOkResponse({ type: McpGroupResponse })
  async updateGroup(
    @CurrentAuth() _auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateMcpGroupDto,
  ): Promise<McpGroupResponse> {
    return this.mcpGroupsService.updateGroup(id, body);
  }

  @Delete(':id')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an MCP group (admin only)' })
  @ApiNoContentResponse()
  async deleteGroup(
    @CurrentAuth() _auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.mcpGroupsService.deleteGroup(id);
  }

  // Group-Server relationship endpoints

  @Get(':id/servers')
  @ApiOperation({ summary: 'Get servers in a group' })
  @ApiOkResponse({ type: [McpGroupServerResponse] })
  async getServersInGroup(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<McpGroupServerResponse[]> {
    return this.mcpGroupsService.getServersInGroup(id);
  }

  @Post(':id/servers')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Add a server to a group (admin only)' })
  @ApiCreatedResponse({ type: [McpGroupServerResponse] })
  async addServerToGroup(
    @CurrentAuth() _auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: AddServerToGroupDto,
  ): Promise<McpGroupServerResponse[]> {
    return this.mcpGroupsService.addServerToGroup(id, body);
  }

  @Patch(':id/servers/:serverId')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Update server metadata in a group (admin only)' })
  @ApiOkResponse({ type: [McpGroupServerResponse] })
  async updateServerInGroup(
    @CurrentAuth() _auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('serverId', new ParseUUIDPipe()) serverId: string,
    @Body() body: UpdateServerInGroupDto,
  ): Promise<McpGroupServerResponse[]> {
    return this.mcpGroupsService.updateServerInGroup(id, serverId, body);
  }

  @Delete(':id/servers/:serverId')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a server from a group (admin only)' })
  @ApiNoContentResponse()
  async removeServerFromGroup(
    @CurrentAuth() _auth: AuthContext | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('serverId', new ParseUUIDPipe()) serverId: string,
  ): Promise<void> {
    await this.mcpGroupsService.removeServerFromGroup(id, serverId);
  }

  // Template sync endpoint

  @Post('sync-templates')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Sync group templates from code (admin only)' })
  @ApiOkResponse({ type: SyncTemplatesResponse })
  async syncTemplates(@CurrentAuth() _auth: AuthContext | null): Promise<SyncTemplatesResponse> {
    return this.mcpGroupsService.syncTemplates();
  }

  @Post('templates/:slug/import')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Import a group template (admin only)' })
  @ApiOkResponse({ type: ImportGroupTemplateResponse })
  async importTemplate(
    @CurrentAuth() _auth: AuthContext | null,
    @Param('slug') slug: string,
    @Body() body: ImportTemplateRequestDto,
  ): Promise<ImportGroupTemplateResponse> {
    return this.mcpGroupsService.importTemplate(slug, body);
  }
}

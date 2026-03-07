import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ToolRegistryService } from './tool-registry.service';
import { McpGatewayService } from './mcp-gateway.service';
import { McpGroupsService } from '../mcp-groups/mcp-groups.service';
import { McpAuthService } from './mcp-auth.service';
import {
  CleanupRunRequestDto,
  CleanupRunResponseDto,
  GenerateMcpTokenRequestDto,
  GenerateMcpTokenResponseDto,
  RegisterComponentToolInput,
  RegisterGroupServerRequestDto,
  RegisterGroupServerResponseDto,
  RegisterMcpServerInput,
  ToolsReadyRequestDto,
  ToolsReadyResponseDto,
} from './dto/mcp.dto';

@ApiTags('internal-mcp')
@Controller('internal/mcp')
export class InternalMcpController {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly mcpGroupsService: McpGroupsService,
    private readonly mcpGatewayService: McpGatewayService,
    private readonly mcpAuthService: McpAuthService,
  ) {}

  @Post('generate-token')
  @ApiOkResponse({ type: GenerateMcpTokenResponseDto })
  async generateToken(
    @Body() body: GenerateMcpTokenRequestDto,
  ): Promise<GenerateMcpTokenResponseDto> {
    const token = await this.mcpAuthService.generateSessionToken(
      body.runId,
      body.organizationId ?? null,
      body.agentId,
      body.allowedNodeIds,
    );
    return { token };
  }

  @Post('register-component')
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
      },
    },
  })
  async registerComponent(@Body() body: RegisterComponentToolInput) {
    await this.toolRegistry.registerComponentTool(body);
    await this.mcpGatewayService.refreshServersForRun(body.runId);
    return { success: true };
  }

  /**
   * Register an MCP server with pre-discovered tools.
   * This is the only way to register MCP servers.
   */
  @Post('register-mcp-server')
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        toolCount: { type: 'number' },
      },
    },
  })
  async registerMcpServer(@Body() body: RegisterMcpServerInput) {
    await this.toolRegistry.registerMcpServer(body);
    await this.mcpGatewayService.refreshServersForRun(body.runId);
    return { success: true, toolCount: body.tools?.length ?? 0 };
  }

  @Post('cleanup')
  @ApiOkResponse({ type: CleanupRunResponseDto })
  async cleanupRun(@Body() body: CleanupRunRequestDto): Promise<CleanupRunResponseDto> {
    const containerIds = await this.toolRegistry.cleanupRun(body.runId);
    return { containerIds };
  }

  @Post('tools-ready')
  @ApiOkResponse({ type: ToolsReadyResponseDto })
  async areToolsReady(@Body() body: ToolsReadyRequestDto): Promise<ToolsReadyResponseDto> {
    const ready = await this.toolRegistry.areAllToolsReady(body.runId, body.requiredNodeIds);
    return { ready };
  }

  @Post('register-group-server')
  @ApiOkResponse({ type: RegisterGroupServerResponseDto })
  async registerGroupServer(
    @Body() body: RegisterGroupServerRequestDto,
  ): Promise<RegisterGroupServerResponseDto> {
    const serverConfig = await this.mcpGroupsService.getServerConfig(body.groupSlug, body.serverId);
    return serverConfig;
  }
}

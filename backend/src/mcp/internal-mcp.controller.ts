import { Body, Controller, Post } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { McpGatewayService } from './mcp-gateway.service';
import { McpGroupsService } from '../mcp-groups/mcp-groups.service';
import { McpAuthService } from './mcp-auth.service';
import {
  RegisterComponentToolInput,
  RegisterLocalMcpInput,
  RegisterRemoteMcpInput,
} from './dto/mcp.dto';

@Controller('internal/mcp')
export class InternalMcpController {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly mcpAuthService: McpAuthService,
    private readonly mcpGroupsService: McpGroupsService,
    private readonly mcpGatewayService: McpGatewayService,
  ) {}

  @Post('generate-token')
  async generateToken(
    @Body()
    body: {
      runId: string;
      organizationId?: string | null;
      agentId?: string;
      allowedNodeIds?: string[];
    },
  ) {
    const token = await this.mcpAuthService.generateSessionToken(
      body.runId,
      body.organizationId ?? null,
      body.agentId,
      body.allowedNodeIds,
    );
    return { token };
  }

  @Post('register-component')
  async registerComponent(@Body() body: RegisterComponentToolInput) {
    await this.toolRegistry.registerComponentTool(body);
    await this.mcpGatewayService.refreshServersForRun(body.runId);
    return { success: true };
  }

  @Post('register-remote')
  async registerRemote(@Body() body: RegisterRemoteMcpInput) {
    await this.toolRegistry.registerRemoteMcp(body);
    await this.mcpGatewayService.refreshServersForRun(body.runId);
    return { success: true };
  }

  @Post('register-local')
  async registerLocal(@Body() body: RegisterLocalMcpInput) {
    await this.toolRegistry.registerLocalMcp(body);
    await this.mcpGatewayService.refreshServersForRun(body.runId);
    return { success: true };
  }

  @Post('cleanup')
  async cleanupRun(@Body() body: { runId: string }) {
    const containerIds = await this.toolRegistry.cleanupRun(body.runId);
    return { containerIds };
  }

  @Post('tools-ready')
  async areToolsReady(@Body() body: { runId: string; requiredNodeIds: string[] }) {
    const ready = await this.toolRegistry.areAllToolsReady(body.runId, body.requiredNodeIds);
    return { ready };
  }

  @Post('register-group-server')
  async registerGroupServer(
    @Body() body: { runId: string; nodeId: string; groupSlug: string; serverId: string },
  ) {
    const serverConfig = await this.mcpGroupsService.getServerConfig(body.groupSlug, body.serverId);
    return serverConfig;
  }
}

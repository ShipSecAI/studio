import { Body, Controller, Post } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
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
  ) {}

  @Post('generate-token')
  async generateToken(
    @Body() body: { runId: string; organizationId?: string | null; agentId?: string },
  ) {
    const token = await this.mcpAuthService.generateSessionToken(
      body.runId,
      body.organizationId ?? null,
      body.agentId,
    );
    return { token };
  }

  @Post('register-component')
  async registerComponent(@Body() body: RegisterComponentToolInput) {
    await this.toolRegistry.registerComponentTool(body);
    return { success: true };
  }

  @Post('register-remote')
  async registerRemote(@Body() body: RegisterRemoteMcpInput) {
    await this.toolRegistry.registerRemoteMcp(body);
    return { success: true };
  }

  @Post('register-local')
  async registerLocal(@Body() body: RegisterLocalMcpInput) {
    await this.toolRegistry.registerLocalMcp(body);
    return { success: true };
  }
}

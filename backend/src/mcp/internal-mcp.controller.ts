import { Body, Controller, Post } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import {
  RegisterComponentToolInput,
  RegisterLocalMcpInput,
  RegisterRemoteMcpInput,
} from './dto/mcp.dto';

@Controller('internal/mcp')
export class InternalMcpController {
  constructor(private readonly toolRegistry: ToolRegistryService) {}

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

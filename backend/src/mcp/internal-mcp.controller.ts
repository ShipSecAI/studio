import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { AuthGuard } from '../auth/auth.guard';
import { ToolRegistryService } from './tool-registry.service';
import { RegisterToolRequestDto } from './dto/mcp-gateway.dto';

@Controller('internal/mcp')
@UseGuards(AuthGuard)
export class InternalMcpController {
  constructor(private readonly toolRegistry: ToolRegistryService) {}

  @Post('register')
  async registerTool(
    @Body(new ZodValidationPipe(RegisterToolRequestDto)) body: RegisterToolRequestDto,
  ) {
    if (body.type === 'component') {
      return this.toolRegistry.registerComponentTool({
        runId: body.runId,
        nodeId: body.nodeId,
        toolName: body.toolName,
        componentId: body.componentId,
        description: body.description,
        inputSchema: body.inputSchema as any,
        credentials: body.credentials,
      });
    }

    if (body.type === 'remote-mcp') {
      return this.toolRegistry.registerRemoteMcp({
        runId: body.runId,
        nodeId: body.nodeId,
        toolName: body.toolName,
        description: body.description,
        inputSchema: body.inputSchema as any,
        endpoint: body.endpoint!,
      });
    }

    if (body.type === 'local-mcp') {
      return this.toolRegistry.registerLocalMcp({
        runId: body.runId,
        nodeId: body.nodeId,
        toolName: body.toolName,
        description: body.description,
        inputSchema: body.inputSchema as any,
        endpoint: body.endpoint!,
        containerId: body.containerId!,
      });
    }
  }
}

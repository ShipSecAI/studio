import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ToolRegistryService, TOOL_REGISTRY_REDIS } from './tool-registry.service';
import { McpGatewayService } from './mcp-gateway.service';
import { McpAuthService } from './mcp-auth.service';
import { McpGatewayController } from './mcp-gateway.controller';
import { SecretsModule } from '../secrets/secrets.module';
import { InternalMcpController } from './internal-mcp.controller';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Global()
@Module({
  imports: [SecretsModule, WorkflowsModule, ApiKeysModule],
  controllers: [McpGatewayController, InternalMcpController],
  providers: [
    {
      provide: TOOL_REGISTRY_REDIS,
      useFactory: () => {
        // Use the same Redis URL as terminal or a dedicated one
        const url = process.env.TOOL_REGISTRY_REDIS_URL ?? process.env.TERMINAL_REDIS_URL;
        if (!url) {
          console.warn('[MCP] Redis URL not set; tool registry disabled');
        } else {
          console.info(`[MCP] Tool registry Redis URL: ${url}`);
        }
        if (!url) {
          return null;
        }
        return new Redis(url);
      },
    },
    ToolRegistryService,
    McpAuthService,
    McpGatewayService,
  ],
  exports: [ToolRegistryService, McpGatewayService, McpAuthService],
})
export class McpModule {}

import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ToolRegistryService, TOOL_REGISTRY_REDIS } from './tool-registry.service';
import { McpGatewayService } from './mcp-gateway.service';
import { McpGatewayController } from './mcp-gateway.controller';
import { InternalMcpController } from './internal-mcp.controller';
import { SecretsModule } from '../secrets/secrets.module';
import { WorkflowsModule } from '../workflows/workflows.module';

@Global()
@Module({
  imports: [SecretsModule, WorkflowsModule],
  controllers: [McpGatewayController, InternalMcpController],
  providers: [
    {
      provide: TOOL_REGISTRY_REDIS,
      useFactory: () => {
        // Use the same Redis URL as terminal or a dedicated one
        const url = process.env.TOOL_REGISTRY_REDIS_URL ?? process.env.TERMINAL_REDIS_URL;
        if (!url) {
          return null;
        }
        return new Redis(url);
      },
    },
    ToolRegistryService,
    McpGatewayService,
  ],
  exports: [ToolRegistryService, McpGatewayService],
})
export class McpModule {}

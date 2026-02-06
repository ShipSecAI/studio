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
import { McpDiscoveryController } from './mcp-discovery.controller';
import { TemporalModule } from '../temporal/temporal.module';
import { McpGroupsModule } from '../mcp-groups/mcp-groups.module';
import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';
import { DatabaseModule } from '../database/database.module';
import { McpDiscoveryOrchestratorService } from './mcp-discovery-orchestrator.service';
import { MCP_DISCOVERY_REDIS } from './mcp.tokens';

@Global()
@Module({
  imports: [
    SecretsModule,
    WorkflowsModule,
    ApiKeysModule,
    TemporalModule,
    DatabaseModule,
    McpGroupsModule,
  ],
  controllers: [McpGatewayController, InternalMcpController, McpDiscoveryController],
  providers: [
    {
      provide: MCP_DISCOVERY_REDIS,
      useFactory: () => {
        // Keep consistent with the worker-side caching (worker uses REDIS_URL || TERMINAL_REDIS_URL || localhost).
        const redisUrl =
          process.env.REDIS_URL || process.env.TERMINAL_REDIS_URL || 'redis://localhost:6379';
        return new Redis(redisUrl);
      },
    },
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
    McpDiscoveryOrchestratorService,
    McpServersRepository,
  ],
  exports: [ToolRegistryService, McpGatewayService, McpAuthService],
})
export class McpModule {}

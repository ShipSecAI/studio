import { Module } from '@nestjs/common';
import Redis from 'ioredis';

import { DatabaseModule } from '../database/database.module';
import { SecretsModule } from '../secrets/secrets.module';
import { TemporalModule } from '../temporal/temporal.module';
import { McpServersController } from './mcp-servers.controller';
import { McpServersEncryptionService } from './mcp-servers.encryption';
import { McpServersRepository } from './mcp-servers.repository';
import { McpServersService } from './mcp-servers.service';

// Redis injection token - must match the one in mcp-servers.service.ts
const MCP_SERVERS_REDIS = 'MCP_SERVERS_REDIS';

@Module({
  imports: [DatabaseModule, SecretsModule, TemporalModule],
  controllers: [McpServersController],
  providers: [
    McpServersService,
    McpServersRepository,
    McpServersEncryptionService,
    {
      provide: MCP_SERVERS_REDIS,
      useFactory: () => {
        const url =
          process.env.REDIS_URL ?? process.env.TERMINAL_REDIS_URL ?? 'redis://localhost:6379';
        return new Redis(url);
      },
    },
  ],
  exports: [McpServersService],
})
export class McpServersModule {}

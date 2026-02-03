import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SecretsModule } from '../secrets/secrets.module';
import { McpServersController } from './mcp-servers.controller';
import { McpServersEncryptionService } from './mcp-servers.encryption';
import { McpServersRepository } from './mcp-servers.repository';
import { McpServersService } from './mcp-servers.service';

@Module({
  imports: [DatabaseModule, SecretsModule],
  controllers: [McpServersController],
  providers: [McpServersService, McpServersRepository, McpServersEncryptionService],
  exports: [McpServersService],
})
export class McpServersModule {}

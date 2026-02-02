import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { McpGroupsController } from './mcp-groups.controller';
import { McpGroupsRepository } from './mcp-groups.repository';
import { McpGroupsService } from './mcp-groups.service';
import { McpGroupsSeedingService } from './mcp-groups-seeding.service';
import { McpServersRepository } from '../mcp-servers/mcp-servers.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [McpGroupsController],
  providers: [McpGroupsService, McpGroupsRepository, McpGroupsSeedingService, McpServersRepository],
  exports: [McpGroupsService],
})
export class McpGroupsModule {}

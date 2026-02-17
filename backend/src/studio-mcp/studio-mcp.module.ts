import { Module } from '@nestjs/common';

import { WorkflowsModule } from '../workflows/workflows.module';
import { StudioMcpController } from './studio-mcp.controller';
import { StudioMcpService } from './studio-mcp.service';

@Module({
  imports: [WorkflowsModule],
  controllers: [StudioMcpController],
  providers: [StudioMcpService],
})
export class StudioMcpModule {}

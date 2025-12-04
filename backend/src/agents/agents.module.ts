import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { WorkflowsModule } from '../workflows/workflows.module';
import { TraceModule } from '../trace/trace.module';

@Module({
  imports: [WorkflowsModule, TraceModule],
  controllers: [AgentsController],
})
export class AgentsModule {}

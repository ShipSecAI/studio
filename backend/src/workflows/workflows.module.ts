import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { TemporalModule } from '../temporal/temporal.module';
import { WorkflowRepository } from './repository/workflow.repository';
import { WorkflowRunRepository } from './repository/workflow-run.repository';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
// import { WorkflowsBootstrapService } from './workflows.bootstrap';

@Module({
  imports: [DatabaseModule, TemporalModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowRepository, WorkflowRunRepository], // Removed WorkflowsBootstrapService
  exports: [WorkflowsService],
})
export class WorkflowsModule {}

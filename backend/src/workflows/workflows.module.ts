import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { WorkflowRepository } from './repository/workflow.repository';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [DatabaseModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowRepository],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}

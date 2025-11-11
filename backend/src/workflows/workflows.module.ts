import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { TemporalModule } from '../temporal/temporal.module';
import { StorageModule } from '../storage/storage.module';
import { WorkflowRepository } from './repository/workflow.repository';
import { WorkflowRunRepository } from './repository/workflow-run.repository';
import { WorkflowVersionRepository } from './repository/workflow-version.repository';
import { WorkflowRoleRepository } from './repository/workflow-role.repository';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowRoleGuard } from './workflow-role.guard';
// import { WorkflowsBootstrapService } from './workflows.bootstrap';

@Module({
  imports: [DatabaseModule, TemporalModule, StorageModule],
  controllers: [WorkflowsController],
  providers: [
    WorkflowsService,
    WorkflowRepository,
    WorkflowRunRepository,
    WorkflowVersionRepository,
    WorkflowRoleRepository,
    WorkflowRoleGuard,
  ],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}

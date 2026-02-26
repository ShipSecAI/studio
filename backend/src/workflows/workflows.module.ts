import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { TemporalModule } from '../temporal/temporal.module';
import { StorageModule } from '../storage/storage.module';
import { TerminalModule } from '../terminal/terminal.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditModule } from '../audit/audit.module';
import { NodeIOModule } from '../node-io/node-io.module';
import { TraceModule } from '../trace/trace.module';
import { WorkflowRepository } from './repository/workflow.repository';
import { WorkflowRunRepository } from './repository/workflow-run.repository';
import { WorkflowVersionRepository } from './repository/workflow-version.repository';
import { WorkflowRoleRepository } from './repository/workflow-role.repository';
import { TerminalRecordRepository } from './repository/terminal-record.repository';
import { TerminalArchiveService } from './terminal-archive.service';
import { WorkflowsController } from './workflows.controller';
import { InternalRunsController } from './internal-runs.controller';
import { WorkflowsService } from './workflows.service';
import { SystemWorkflowsService } from './system-workflows.service';
import { WorkflowRoleGuard } from './workflow-role.guard';
// import { WorkflowsBootstrapService } from './workflows.bootstrap';

@Module({
  imports: [
    DatabaseModule,
    TemporalModule,
    StorageModule,
    TerminalModule,
    AnalyticsModule,
    AuditModule,
    NodeIOModule,
    TraceModule,
    // GitHubAppModule is @Global() — no import needed here.
    // WorkflowsService accesses it via @Optional() @Inject('GitHubAppService').
  ],
  controllers: [WorkflowsController, InternalRunsController],
  providers: [
    WorkflowsService,
    SystemWorkflowsService,
    WorkflowRepository,
    WorkflowRunRepository,
    WorkflowVersionRepository,
    WorkflowRoleRepository,
    TerminalRecordRepository,
    TerminalArchiveService,
    WorkflowRoleGuard,
  ],
  exports: [
    WorkflowsService,
    SystemWorkflowsService,
    WorkflowRepository,
    WorkflowRunRepository,
    WorkflowVersionRepository,
  ],
})
export class WorkflowsModule {}

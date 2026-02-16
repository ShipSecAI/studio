import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { WorkflowTemplatesService } from './workflow-templates.service';
import { WorkflowTemplatesController } from './workflow-templates.controller';

@Module({
  imports: [DatabaseModule, WorkflowsModule, ApiKeysModule, AuthModule],
  providers: [WorkflowTemplatesService],
  controllers: [WorkflowTemplatesController],
  exports: [WorkflowTemplatesService],
})
export class WorkflowTemplatesModule {}

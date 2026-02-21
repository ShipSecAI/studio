import { Module } from '@nestjs/common';
import { AsmController } from './asm.controller';
import { AsmService } from './asm.service';
import { WorkflowsModule } from '../workflows/workflows.module';
import { WorkflowTemplatesModule } from '../workflow-templates/workflow-templates.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule, WorkflowsModule, WorkflowTemplatesModule, ApiKeysModule, AuthModule],
  controllers: [AsmController],
  providers: [AsmService],
  exports: [AsmService],
})
export class AsmModule {}

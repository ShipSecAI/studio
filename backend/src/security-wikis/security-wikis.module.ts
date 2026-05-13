import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { SecurityWikisController } from './security-wikis.controller';
import { SecurityWikisService } from './security-wikis.service';

@Module({
  imports: [DatabaseModule, WorkflowsModule],
  controllers: [SecurityWikisController],
  providers: [SecurityWikisService],
  exports: [SecurityWikisService],
})
export class SecurityWikisModule {}

import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ComponentsModule } from './components/components.module';
import { StorageModule } from './storage/storage.module';
import { TraceModule } from './trace/trace.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { TestingSupportModule } from './testing/testing.module';

const coreModules = [WorkflowsModule, TraceModule, ComponentsModule, StorageModule];
const testingModules =
  process.env.NODE_ENV === 'production' ? [] : [TestingSupportModule];

@Module({
  imports: [...coreModules, ...testingModules],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

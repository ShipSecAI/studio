import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WorkflowsModule } from './workflows/workflows.module';

@Module({
  imports: [WorkflowsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [WorkflowsModule, ApiKeysModule, AuthModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}

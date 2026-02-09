import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { InboundWebhookController } from './inbound-webhook.controller';
import { WebhooksAdminController } from './webhooks.admin.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookRepository } from './repository/webhook.repository';
import { WebhookDeliveryRepository } from './repository/webhook-delivery.repository';
import { WorkflowsModule } from '../workflows/workflows.module';
import { TemporalModule } from '../temporal/temporal.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [WorkflowsModule, TemporalModule, ApiKeysModule, AuthModule, DatabaseModule],
  controllers: [WebhooksController, InboundWebhookController, WebhooksAdminController],
  providers: [WebhooksService, WebhookRepository, WebhookDeliveryRepository],
  exports: [WebhooksService],
})
export class WebhooksModule {}

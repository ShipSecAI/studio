import { Module } from '@nestjs/common';

import { TestingWebhookController } from './testing-webhook.controller';
import { TestingWebhookService } from './testing-webhook.service';

@Module({
  controllers: [TestingWebhookController],
  providers: [TestingWebhookService],
  exports: [TestingWebhookService],
})
export class TestingSupportModule {}

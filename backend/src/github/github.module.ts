import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { githubAppConfig } from '../config/github-app.config';
import { GithubAppService } from './github.service';
import { GithubWebhookController } from './github-webhook.controller';
import { GithubWebhookService } from './github-webhook.service';
import { GithubDispatchService } from './github-dispatch.service';
import { TemporalModule } from '../temporal/temporal.module';

@Module({
  imports: [ConfigModule.forFeature(githubAppConfig), TemporalModule],
  controllers: [GithubWebhookController],
  providers: [GithubAppService, GithubWebhookService, GithubDispatchService],
  exports: [GithubAppService, GithubWebhookService, GithubDispatchService],
})
export class GithubModule {}

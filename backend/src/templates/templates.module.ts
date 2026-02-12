import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { TemplatesController } from './templates.controller';
import { WebhookController } from './webhook.controller';
import { TemplateService } from './templates.service';
import { WorkflowSanitizationService } from './workflow-sanitization.service';
import { TemplatesRepository } from './templates.repository';
import { GitHubSyncService } from './github-sync.service';

/**
 * Templates Module
 * Handles template library operations.
 *
 * Uses GitHub web flow for publishing and GitHub API for syncing templates.
 */
@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [TemplatesController, WebhookController],
  providers: [
    TemplateService,
    WorkflowSanitizationService,
    TemplatesRepository,
    GitHubSyncService,
  ],
  exports: [TemplateService, GitHubSyncService],
})
export class TemplatesModule {}

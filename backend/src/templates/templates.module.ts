import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { TemplatesController } from './templates.controller';
import { TemplateService } from './templates.service';
import { GitHubTemplateService } from './github-template.service';
import { WorkflowSanitizationService } from './workflow-sanitization.service';
import { TemplatesRepository } from './templates.repository';
import { WorkflowsModule } from '../workflows/workflows.module';

// TemplatesModule temporarily disabled due to Bun+NestJS compatibility issue
// See: https://github.com/oven-sh/bun/issues/4858

@Module({
  imports: [DatabaseModule, forwardRef(() => WorkflowsModule), ConfigModule],
  controllers: [TemplatesController],
  providers: [
    TemplateService,
    GitHubTemplateService,
    WorkflowSanitizationService,
    TemplatesRepository,
  ],
  exports: [TemplateService],
})
export class TemplatesModule {}

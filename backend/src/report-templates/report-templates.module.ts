import { Module, forwardRef } from '@nestjs/common';
import { ReportTemplatesController } from './report-templates.controller';
import { ReportTemplatesService } from './report-templates.service';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [forwardRef(() => ApiKeysModule), AiModule],
  controllers: [ReportTemplatesController],
  providers: [ReportTemplatesService],
  exports: [ReportTemplatesService],
})
export class ReportTemplatesModule {}

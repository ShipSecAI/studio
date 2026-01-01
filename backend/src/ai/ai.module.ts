import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { forwardRef } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AiController } from './ai.controller';

@Module({
  imports: [forwardRef(() => ApiKeysModule)],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}

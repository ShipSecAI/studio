import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { forwardRef } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [forwardRef(() => ApiKeysModule)],
  controllers: [],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}

import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { TemporalService } from './temporal.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [TemporalService],
  exports: [TemporalService],
})
export class TemporalModule {}

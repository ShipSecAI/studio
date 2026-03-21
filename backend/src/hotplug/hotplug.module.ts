import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HotplugService } from './hotplug.service';

@Module({
  imports: [ConfigModule],
  providers: [HotplugService],
  exports: [HotplugService],
})
export class HotplugModule {}

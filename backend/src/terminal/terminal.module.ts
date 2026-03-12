import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisStartupGuardService } from './redis-startup-guard.service';
import { TerminalStreamService, TERMINAL_REDIS } from './terminal-stream.service';

@Global()
@Module({
  providers: [
    {
      provide: TERMINAL_REDIS,
      useFactory: () => {
        const url = process.env.REDIS_URL ?? process.env.TERMINAL_REDIS_URL;
        if (!url) {
          return null;
        }
        return new Redis(url);
      },
    },
    RedisStartupGuardService,
    TerminalStreamService,
  ],
  exports: [TERMINAL_REDIS, TerminalStreamService, RedisStartupGuardService],
})
export class TerminalModule {}

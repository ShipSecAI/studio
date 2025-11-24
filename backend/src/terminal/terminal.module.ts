import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { TerminalStreamService, TERMINAL_REDIS } from './terminal-stream.service';

@Global()
@Module({
  providers: [
    {
      provide: TERMINAL_REDIS,
      useFactory: () => {
        const url = process.env.TERMINAL_REDIS_URL;
        if (!url) {
          return null;
        }
        return new Redis(url);
      },
    },
    TerminalStreamService,
  ],
  exports: [TerminalStreamService],
})
export class TerminalModule {}

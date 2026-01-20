import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ToolRegistryService, TOOL_REGISTRY_REDIS } from './tool-registry.service';
import { SecretsModule } from '../secrets/secrets.module';

@Global()
@Module({
  imports: [SecretsModule],
  providers: [
    {
      provide: TOOL_REGISTRY_REDIS,
      useFactory: () => {
        // Use the same Redis URL as terminal or a dedicated one
        const url = process.env.TOOL_REGISTRY_REDIS_URL ?? process.env.TERMINAL_REDIS_URL;
        if (!url) {
          return null;
        }
        return new Redis(url);
      },
    },
    ToolRegistryService,
  ],
  exports: [ToolRegistryService],
})
export class McpModule {}

import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { join } from 'node:path';
import { ThrottlerModule, ThrottlerGuard, seconds } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { authConfig } from './config/auth.config';
import { clickhouseConfig } from './config/clickhouse.config';
import { validateBackendEnv } from './config/env.validate';
import { ClickHouseModule } from './config/clickhouse.module';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import {
  getCoreBackendModules,
  getOptionalBackendModules,
  getTestingBackendModules,
} from './composition/backend-modules';

function getEnvFilePaths(): string[] {
  // In multi-instance dev, each instance has its own env file under:
  //   .instances/instance-N/backend.env
  // Backends run with cwd=backend/, so repo root is `..`.
  const instance = process.env.SHIPSEC_INSTANCE;
  if (instance) {
    // Use only the instance env file. In multi-instance dev the workspace `.env` contains
    // a default DATABASE_URL, and dotenv does not override already-set env vars; mixing
    // would collapse isolation.
    return [join(process.cwd(), '..', '.instances', `instance-${instance}`, 'backend.env')];
  }

  return ['.env', '../.env'];
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: getEnvFilePaths(),
      load: [authConfig, clickhouseConfig],
      validate: validateBackendEnv,
    }),
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;

        return {
          throttlers: [
            {
              name: 'default',
              ttl: seconds(60), // 60 seconds
              limit: 500, // 500 requests per minute
            },
          ],
          storage: redisUrl ? new ThrottlerStorageRedisService(new Redis(redisUrl)) : undefined,
        };
      },
    }),
    EventEmitterModule.forRoot(),
    ClickHouseModule,
    ...getCoreBackendModules(),
    ...getOptionalBackendModules(),
    ...getTestingBackendModules(),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

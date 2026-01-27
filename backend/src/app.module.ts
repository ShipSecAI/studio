import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard, seconds } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import Redis from 'ioredis';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { authConfig } from './config/auth.config';
import { opensearchConfig } from './config/opensearch.config';
import { OpenSearchModule } from './config/opensearch.module';
import { AgentsModule } from './agents/agents.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { ComponentsModule } from './components/components.module';
import { StorageModule } from './storage/storage.module';
import { SecretsModule } from './secrets/secrets.module';
import { TraceModule } from './trace/trace.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { TestingSupportModule } from './testing/testing.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { SchedulesModule } from './schedules/schedules.module';
import { AnalyticsModule } from './analytics/analytics.module';

import { ApiKeysModule } from './api-keys/api-keys.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { HumanInputsModule } from './human-inputs/human-inputs.module';

const coreModules = [
  AgentsModule,
  AnalyticsModule,
  AuthModule,
  WorkflowsModule,
  TraceModule,
  ComponentsModule,
  StorageModule,
  SecretsModule,
  IntegrationsModule,
  SchedulesModule,
  ApiKeysModule,
  WebhooksModule,
  HumanInputsModule,
];

const testingModules = process.env.NODE_ENV === 'production' ? [] : [TestingSupportModule];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      load: [authConfig, opensearchConfig],
    }),
    ThrottlerModule.forRootAsync({
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;

        return {
          throttlers: [
            {
              name: 'default',
              ttl: seconds(60), // 60 seconds
              limit: 100, // 100 requests per minute
            },
          ],
          storage: redisUrl ? new ThrottlerStorageRedisService(new Redis(redisUrl)) : undefined, // Falls back to in-memory storage if Redis not configured
        };
      },
    }),
    OpenSearchModule,
    ...coreModules,
    ...testingModules,
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

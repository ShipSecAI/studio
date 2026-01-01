import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { authConfig } from './config/auth.config';
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
import { ReportTemplatesModule } from './report-templates/report-templates.module';
import { AiModule } from './ai/ai.module';

const coreModules = [
  AgentsModule,
  AiModule,
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
  ReportTemplatesModule,
];

const testingModules =
  process.env.NODE_ENV === 'production' ? [] : [TestingSupportModule];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
      load: [authConfig],
    }),
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
  ],
})
export class AppModule {}

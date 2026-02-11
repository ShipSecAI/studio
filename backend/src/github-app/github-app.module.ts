import { Global, Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GitHubAppController } from './github-app.controller';
import { GitHubAppService } from './github-app.service';
import { GitHubAppRepository } from './github-app.repository';
import { ScanResultSyncService } from './scan-result-sync.service';
import { githubAppConfig } from '../config/github-app.config';
import { DatabaseModule } from '../database/database.module';
import { WorkflowsModule } from '../workflows/workflows.module';

@Global()
@Module({
  imports: [
    DatabaseModule,
    ConfigModule.forFeature(githubAppConfig),
    forwardRef(() => WorkflowsModule),
  ],
  controllers: [GitHubAppController],
  providers: [
    GitHubAppService,
    GitHubAppRepository,
    ScanResultSyncService,
    {
      provide: 'GitHubAppService',
      useFactory: (service: GitHubAppService) => service,
      inject: [GitHubAppService],
    },
  ],
  exports: [GitHubAppService, 'GitHubAppService'],
})
export class GitHubAppModule {}

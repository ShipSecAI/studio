import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AwsService } from './aws.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsRepository } from './integrations.repository';
import { IntegrationsService } from './integrations.service';
import { SetupTokenService } from './setup-token.service';
import { SlackService } from './slack.service';
import { TokenEncryptionService } from './token.encryption';

@Module({
  imports: [DatabaseModule],
  controllers: [IntegrationsController],
  providers: [
    IntegrationsService,
    IntegrationsRepository,
    TokenEncryptionService,
    AwsService,
    SlackService,
    SetupTokenService,
  ],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}

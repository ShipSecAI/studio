import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsRepository } from './integrations.repository';
import { IntegrationsService } from './integrations.service';
import { TokenEncryptionService } from './token.encryption';

@Module({
  imports: [DatabaseModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationsRepository, TokenEncryptionService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}

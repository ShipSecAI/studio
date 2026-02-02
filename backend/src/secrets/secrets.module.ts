import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { SecretsController } from './secrets.controller';
import { SecretsEncryptionService } from './secrets.encryption';
import { SecretsRepository } from './secrets.repository';
import { SecretsService } from './secrets.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SecretsController],
  providers: [SecretsService, SecretsRepository, SecretsEncryptionService],
  exports: [SecretsService, SecretsEncryptionService],
})
export class SecretsModule {}

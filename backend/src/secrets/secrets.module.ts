import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { DatabaseModule } from '../database/database.module';
import { SecretsController } from './secrets.controller';
import { SecretsEncryptionService } from './secrets.encryption';
import { SecretsRepository } from './secrets.repository';
import { SecretsService } from './secrets.service';
import { SecretResolver } from './secret-resolver';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [SecretsController],
  providers: [SecretsService, SecretsRepository, SecretsEncryptionService, SecretResolver],
  exports: [SecretsService, SecretsEncryptionService, SecretResolver],
})
export class SecretsModule {}

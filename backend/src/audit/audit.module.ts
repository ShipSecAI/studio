import { Global, Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { AuditLogsController } from './audit-logs.controller';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [AuditLogsController],
  providers: [AuditLogRepository, AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}

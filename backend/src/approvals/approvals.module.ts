import { Module } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import {
  ApprovalsController,
  PublicApproveController,
  PublicRejectController,
} from './approvals.controller';
import { TemporalModule } from '../temporal/temporal.module';
import { DatabaseModule } from '../database/database.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [TemporalModule, DatabaseModule, ApiKeysModule],
  controllers: [ApprovalsController, PublicApproveController, PublicRejectController],
  providers: [ApprovalsService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}

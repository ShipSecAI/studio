import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { TemporalModule } from '../temporal/temporal.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ScheduleRepository } from './repository/schedule.repository';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [DatabaseModule, TemporalModule, WorkflowsModule],
  controllers: [SchedulesController],
  providers: [SchedulesService, ScheduleRepository],
})
export class SchedulesModule {}

import { forwardRef, Module } from '@nestjs/common';
import { HumanInputsController } from './human-inputs.controller';
import { HumanInputsService } from './human-inputs.service';
import { DatabaseModule } from '../database/database.module';

import { TemporalModule } from '../temporal/temporal.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    DatabaseModule, 
    TemporalModule,
    ApiKeysModule,
    AuthModule,
  ],
  controllers: [HumanInputsController],
  providers: [HumanInputsService],
  exports: [HumanInputsService],
})
export class HumanInputsModule {}

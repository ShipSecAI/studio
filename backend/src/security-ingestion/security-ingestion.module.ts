import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SecurityIngestionController } from './security-ingestion.controller';
import { SecurityIngestionService } from './security-ingestion.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SecurityIngestionController],
  providers: [SecurityIngestionService],
  exports: [SecurityIngestionService],
})
export class SecurityIngestionModule {}

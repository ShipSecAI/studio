import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FilesController } from './files.controller';
import { FilesRepository } from './files.repository';
import { FilesService } from './files.service';
import { MinioConfig } from './minio.config';
import { StorageService } from './storage.service';

@Module({
  imports: [DatabaseModule],
  controllers: [FilesController],
  providers: [MinioConfig, StorageService, FilesService, FilesRepository],
  exports: [FilesService, StorageService],
})
export class StorageModule {}


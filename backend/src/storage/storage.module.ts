import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { FilesController } from './files.controller';
import { FilesRepository } from './files.repository';
import { FilesService } from './files.service';
import { ArtifactsRepository } from './artifacts.repository';
import { ArtifactsService } from './artifacts.service';
import { ArtifactsController } from './artifacts.controller';
import { MinioConfig } from './minio.config';
import { StorageService } from './storage.service';

@Module({
  imports: [DatabaseModule],
  controllers: [FilesController, ArtifactsController],
  providers: [
    MinioConfig,
    StorageService,
    FilesService,
    FilesRepository,
    ArtifactsRepository,
    ArtifactsService,
  ],
  exports: [FilesService, StorageService, ArtifactsService],
})
export class StorageModule {}

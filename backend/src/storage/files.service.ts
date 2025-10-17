import { Injectable, NotFoundException } from '@nestjs/common';

import { FilesRepository } from './files.repository';
import { StorageService, UploadedFile } from './storage.service';

@Injectable()
export class FilesService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly storageService: StorageService,
  ) {}

  async uploadFile(
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<UploadedFile> {
    // Upload to MinIO
    const { storageKey, size } = await this.storageService.uploadFile(
      fileName,
      buffer,
      mimeType,
    );

    // Save metadata to database
    const file = await this.filesRepository.create({
      fileName,
      mimeType,
      size,
      storageKey,
    });

    return {
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      storageKey: file.storageKey,
      uploadedAt: file.uploadedAt,
    };
  }

  async getFileById(id: string): Promise<UploadedFile> {
    const file = await this.filesRepository.findById(id);
    if (!file) {
      throw new NotFoundException(`File with id ${id} not found`);
    }

    return {
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      storageKey: file.storageKey,
      uploadedAt: file.uploadedAt,
    };
  }

  async downloadFile(id: string): Promise<{ buffer: Buffer; file: UploadedFile }> {
    const file = await this.getFileById(id);
    const buffer = await this.storageService.downloadFile(file.storageKey);

    return { buffer, file };
  }

  async listFiles(limit: number = 100): Promise<UploadedFile[]> {
    const files = await this.filesRepository.list(limit);
    return files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      mimeType: f.mimeType,
      size: f.size,
      storageKey: f.storageKey,
      uploadedAt: f.uploadedAt,
    }));
  }

  async deleteFile(id: string): Promise<void> {
    const file = await this.getFileById(id);

    // Delete from MinIO
    await this.storageService.deleteFile(file.storageKey);

    // Delete from database
    await this.filesRepository.delete(id);
  }
}


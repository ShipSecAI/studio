import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';

import { FilesRepository } from './files.repository';
import { StorageService, UploadedFile } from './storage.service';
import type { AuthContext } from '../auth/types';
import { DEFAULT_ORGANIZATION_ID } from '../auth/constants';

@Injectable()
export class FilesService {
  constructor(
    private readonly filesRepository: FilesRepository,
    private readonly storageService: StorageService,
  ) {}

  private resolveOrganizationId(auth: AuthContext | null): string {
    return auth?.organizationId ?? DEFAULT_ORGANIZATION_ID;
  }

  private requireOrganizationId(auth: AuthContext | null): string {
    const organizationId = this.resolveOrganizationId(auth);
    if (!organizationId) {
      throw new BadRequestException('Organization context is required');
    }
    return organizationId;
  }

  async uploadFile(
    auth: AuthContext | null,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<UploadedFile> {
    const organizationId = this.requireOrganizationId(auth);
    // Upload to MinIO
    const { storageKey, size } = await this.storageService.uploadFile(fileName, buffer, mimeType);

    // Save metadata to database
    const file = await this.filesRepository.create({
      fileName,
      mimeType,
      size,
      storageKey,
      organizationId,
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

  async getFileById(auth: AuthContext | null, id: string): Promise<UploadedFile> {
    const organizationId = this.requireOrganizationId(auth);
    const file = await this.filesRepository.findById(id, { organizationId });
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

  async downloadFile(
    auth: AuthContext | null,
    id: string,
  ): Promise<{ buffer: Buffer; file: UploadedFile }> {
    const file = await this.getFileById(auth, id);
    const buffer = await this.storageService.downloadFile(file.storageKey);

    return { buffer, file };
  }

  async listFiles(auth: AuthContext | null, limit = 100): Promise<UploadedFile[]> {
    const organizationId = this.requireOrganizationId(auth);
    const files = await this.filesRepository.list(limit, { organizationId });
    return files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      mimeType: f.mimeType,
      size: f.size,
      storageKey: f.storageKey,
      uploadedAt: f.uploadedAt,
    }));
  }

  async deleteFile(auth: AuthContext | null, id: string): Promise<void> {
    const organizationId = this.requireOrganizationId(auth);
    const file = await this.getFileById(auth, id);

    // Delete from MinIO
    await this.storageService.deleteFile(file.storageKey);

    // Delete from database
    await this.filesRepository.delete(id, { organizationId });
  }
}

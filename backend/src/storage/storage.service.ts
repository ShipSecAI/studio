import { Injectable, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';

import { MinioConfig } from './minio.config';

export interface UploadedFile {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  storageKey: string;
  uploadedAt: Date;
}

@Injectable()
export class StorageService {
  constructor(private readonly minioConfig: MinioConfig) {}

  async uploadFile(
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ storageKey: string; size: number }> {
    const client = this.minioConfig.getClient();
    const bucket = this.minioConfig.getBucketName();

    // Generate unique storage key
    const storageKey = `${randomUUID()}-${fileName}`;

    // Upload to MinIO
    await client.putObject(bucket, storageKey, buffer, buffer.length, {
      'Content-Type': mimeType,
      'x-amz-meta-original-filename': fileName,
    });

    return {
      storageKey,
      size: buffer.length,
    };
  }

  async downloadFilePreview(storageKey: string, length = 1024): Promise<Buffer> {
    const client = this.minioConfig.getClient();
    const bucket = this.minioConfig.getBucketName();

    try {
      const stream = await client.getPartialObject(bucket, storageKey, 0, length);
      return await this.streamToBuffer(stream);
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        throw new NotFoundException(`File not found: ${storageKey}`);
      }
      throw error;
    }
  }

  async downloadFile(storageKey: string): Promise<Buffer> {
    const client = this.minioConfig.getClient();
    const bucket = this.minioConfig.getBucketName();

    try {
      const stream = await client.getObject(bucket, storageKey);
      return await this.streamToBuffer(stream);
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        throw new NotFoundException(`File not found: ${storageKey}`);
      }
      throw error;
    }
  }

  async getFileMetadata(storageKey: string): Promise<{
    size: number;
    mimeType: string;
    originalFileName?: string;
  }> {
    const client = this.minioConfig.getClient();
    const bucket = this.minioConfig.getBucketName();

    try {
      const stat = await client.statObject(bucket, storageKey);
      return {
        size: stat.size,
        mimeType: stat.metaData['content-type'] || 'application/octet-stream',
        originalFileName: stat.metaData['x-amz-meta-original-filename'],
      };
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        throw new NotFoundException(`File not found: ${storageKey}`);
      }
      throw error;
    }
  }

  async deleteFile(storageKey: string): Promise<void> {
    const client = this.minioConfig.getClient();
    const bucket = this.minioConfig.getBucketName();

    try {
      await client.removeObject(bucket, storageKey);
    } catch (error: any) {
      if (error.code === 'NoSuchKey') {
        throw new NotFoundException(`File not found: ${storageKey}`);
      }
      throw error;
    }
  }

  private streamToBuffer(stream: Readable): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }
}

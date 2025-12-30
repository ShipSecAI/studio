import { Client } from 'minio';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { IFileStorageService, NotFoundError } from '@shipsec/component-sdk';
import * as schema from './schema';

/**
 * Adapter that implements IFileStorageService using MinIO + PostgreSQL
 */
export class FileStorageAdapter implements IFileStorageService {
  constructor(
    private minioClient: Client,
    private db: NodePgDatabase<typeof schema>,
    private bucketName: string,
  ) {}

  async downloadFile(fileId: string): Promise<{
    buffer: Buffer;
    metadata: {
      id: string;
      fileName: string;
      mimeType: string;
      size: number;
    };
  }> {
    // Get metadata from database
    const [file] = await this.db
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, fileId))
      .limit(1);

    if (!file) {
      throw new NotFoundError(`File not found: ${fileId}`, {
        resourceType: 'file',
        resourceId: fileId,
      });
    }

    // Download from MinIO
    const stream = await this.minioClient.getObject(this.bucketName, file.storageKey);

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);

    return {
      buffer,
      metadata: {
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        size: file.size,
      },
    };
  }

  async getFileMetadata(fileId: string): Promise<{
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    uploadedAt: Date;
  }> {
    const [file] = await this.db
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, fileId))
      .limit(1);

    if (!file) {
      throw new NotFoundError(`File not found: ${fileId}`, {
        resourceType: 'file',
        resourceId: fileId,
      });
    }

    return {
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      uploadedAt: file.uploadedAt,
    };
  }

  /**
   * Helper method to upload files (for testing and internal use)
   */
  async uploadFile(
    fileId: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    // Upload to MinIO using fileId as storage key
    await this.minioClient.putObject(this.bucketName, fileId, buffer, buffer.length, {
      'Content-Type': mimeType,
    });

    // Store metadata in database
    await this.db
      .insert(schema.files)
      .values({
        id: fileId,
        fileName,
        mimeType,
        size: buffer.length,
        storageKey: fileId,
      })
      .onConflictDoUpdate({
        target: schema.files.id,
        set: {
          fileName,
          mimeType,
          size: buffer.length,
          storageKey: fileId,
          uploadedAt: schema.files.uploadedAt,
        },
      });
  }
}

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Client } from 'minio';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { FileStorageAdapter } from '../file-storage.adapter';
import * as schema from '../schema';

describe('FileStorageAdapter (Integration)', () => {
  let minioClient: Client;
  let pool: Pool;
  let db: NodePgDatabase<typeof schema>;
  let adapter: FileStorageAdapter;
  const bucketName = 'test-shipsec-files';

  beforeAll(async () => {
    // Initialize MinIO client
    minioClient = new Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
    });

    // Initialize PostgreSQL connection
    const connectionString = process.env.DATABASE_URL || 
      'postgresql://shipsec:shipsec@localhost:5433/shipsec';
    pool = new Pool({ connectionString });
    db = drizzle(pool, { schema });

    // Ensure test bucket exists
    const bucketExists = await minioClient.bucketExists(bucketName);
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName, 'us-east-1');
    }

    // Create adapter
    adapter = new FileStorageAdapter(minioClient, db, bucketName);

    console.log('✅ Test setup complete: MinIO + PostgreSQL connected');
  });

  afterAll(async () => {
    // Cleanup: Remove test bucket (optional, commented out to preserve data)
    // const objectsList = minioClient.listObjects(bucketName, '', true);
    // for await (const obj of objectsList) {
    //   await minioClient.removeObject(bucketName, obj.name);
    // }
    // await minioClient.removeBucket(bucketName);

    await pool.end();
    console.log('✅ Test teardown complete');
  });

  beforeEach(async () => {
    // Clean up test files from database before each test
    await db.delete(schema.files);
  });

  describe('downloadFile', () => {
    it('should upload and download a text file', async () => {
      const fileId = randomUUID();
      const fileName = 'test.txt';
      const content = 'Hello, World!';
      const storageKey = `test-${fileId}.txt`;

      // Upload file to MinIO
      await minioClient.putObject(
        bucketName,
        storageKey,
        Buffer.from(content),
        content.length,
        { 'Content-Type': 'text/plain' }
      );

      // Insert metadata into database
      await db.insert(schema.files).values({
        id: fileId,
        fileName,
        mimeType: 'text/plain',
        size: content.length,
        storageKey,
      });

      // Download using adapter
      const result = await adapter.downloadFile(fileId);

      expect(result.buffer.toString('utf-8')).toBe(content);
      expect(result.metadata.id).toBe(fileId);
      expect(result.metadata.fileName).toBe(fileName);
      expect(result.metadata.mimeType).toBe('text/plain');
      expect(result.metadata.size).toBe(content.length);

      // Cleanup
      await minioClient.removeObject(bucketName, storageKey);
    });

    it('should upload and download a binary file', async () => {
      const fileId = randomUUID();
      const fileName = 'test.png';
      const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
      const storageKey = `test-${fileId}.png`;

      // Upload binary file to MinIO
      await minioClient.putObject(
        bucketName,
        storageKey,
        binaryData,
        binaryData.length,
        { 'Content-Type': 'image/png' }
      );

      // Insert metadata into database
      await db.insert(schema.files).values({
        id: fileId,
        fileName,
        mimeType: 'image/png',
        size: binaryData.length,
        storageKey,
      });

      // Download using adapter
      const result = await adapter.downloadFile(fileId);

      expect(result.buffer).toEqual(binaryData);
      expect(result.metadata.mimeType).toBe('image/png');
      expect(result.metadata.size).toBe(binaryData.length);

      // Cleanup
      await minioClient.removeObject(bucketName, storageKey);
    });

    it('should throw error when file not found in database', async () => {
      const nonExistentId = randomUUID();

      await expect(adapter.downloadFile(nonExistentId)).rejects.toThrow(
        `File not found: ${nonExistentId}`
      );
    });

    it('should throw error when file exists in DB but not in MinIO', async () => {
      const fileId = randomUUID();
      const storageKey = `missing-${fileId}.txt`;

      // Insert metadata but don't upload to MinIO
      await db.insert(schema.files).values({
        id: fileId,
        fileName: 'missing.txt',
        mimeType: 'text/plain',
        size: 100,
        storageKey,
      });

      // Should fail when trying to download from MinIO
      await expect(adapter.downloadFile(fileId)).rejects.toThrow();
    });

    it('should handle large files', async () => {
      const fileId = randomUUID();
      const fileName = 'large.bin';
      const largeData = Buffer.alloc(1024 * 1024); // 1MB
      largeData.fill('A');
      const storageKey = `test-${fileId}.bin`;

      // Upload large file
      await minioClient.putObject(
        bucketName,
        storageKey,
        largeData,
        largeData.length,
        { 'Content-Type': 'application/octet-stream' }
      );

      // Insert metadata
      await db.insert(schema.files).values({
        id: fileId,
        fileName,
        mimeType: 'application/octet-stream',
        size: largeData.length,
        storageKey,
      });

      // Download and verify size
      const result = await adapter.downloadFile(fileId);

      expect(result.buffer.length).toBe(largeData.length);
      expect(result.metadata.size).toBe(largeData.length);

      // Cleanup
      await minioClient.removeObject(bucketName, storageKey);
    }, 10000); // 10 second timeout for large file
  });

  describe('getFileMetadata', () => {
    it('should retrieve file metadata without downloading', async () => {
      const fileId = randomUUID();
      const fileName = 'metadata-test.txt';
      const storageKey = `test-${fileId}.txt`;

      // Insert metadata
      const insertedAt = new Date();
      await db.insert(schema.files).values({
        id: fileId,
        fileName,
        mimeType: 'text/plain',
        size: 1234,
        storageKey,
      });

      // Get metadata
      const metadata = await adapter.getFileMetadata(fileId);

      expect(metadata.id).toBe(fileId);
      expect(metadata.fileName).toBe(fileName);
      expect(metadata.mimeType).toBe('text/plain');
      expect(metadata.size).toBe(1234);
      expect(metadata.uploadedAt).toBeInstanceOf(Date);
      expect(metadata.uploadedAt.getTime()).toBeGreaterThanOrEqual(insertedAt.getTime() - 1000);
    });

    it('should throw error when file not found', async () => {
      const nonExistentId = randomUUID();

      await expect(adapter.getFileMetadata(nonExistentId)).rejects.toThrow(
        `File not found: ${nonExistentId}`
      );
    });
  });

  describe('IFileStorageService interface compliance', () => {
    it('should implement all required methods', () => {
      expect(typeof adapter.downloadFile).toBe('function');
      expect(typeof adapter.getFileMetadata).toBe('function');
    });

    it('should return objects matching interface contracts', async () => {
      const fileId = randomUUID();
      const content = 'Interface test';
      const storageKey = `test-${fileId}.txt`;

      await minioClient.putObject(bucketName, storageKey, Buffer.from(content));
      await db.insert(schema.files).values({
        id: fileId,
        fileName: 'interface.txt',
        mimeType: 'text/plain',
        size: content.length,
        storageKey,
      });

      const downloadResult = await adapter.downloadFile(fileId);
      
      // Verify downloadFile return type
      expect(downloadResult).toHaveProperty('buffer');
      expect(downloadResult).toHaveProperty('metadata');
      expect(downloadResult.metadata).toHaveProperty('id');
      expect(downloadResult.metadata).toHaveProperty('fileName');
      expect(downloadResult.metadata).toHaveProperty('mimeType');
      expect(downloadResult.metadata).toHaveProperty('size');

      const metadataResult = await adapter.getFileMetadata(fileId);

      // Verify getFileMetadata return type
      expect(metadataResult).toHaveProperty('id');
      expect(metadataResult).toHaveProperty('fileName');
      expect(metadataResult).toHaveProperty('mimeType');
      expect(metadataResult).toHaveProperty('size');
      expect(metadataResult).toHaveProperty('uploadedAt');

      // Cleanup
      await minioClient.removeObject(bucketName, storageKey);
    });
  });
});

import { Injectable } from '@nestjs/common';
import { Client } from 'minio';

@Injectable()
export class MinioConfig {
  private client: Client;
  private readonly bucketName = 'shipsec-files';

  constructor() {
    const endpoint = process.env.MINIO_ENDPOINT ?? 'localhost';
    const port = parseInt(process.env.MINIO_PORT ?? '9000', 10);
    const accessKey = process.env.MINIO_ROOT_USER ?? 'minioadmin';
    const secretKey = process.env.MINIO_ROOT_PASSWORD ?? 'minioadmin';
    const useSSL = process.env.MINIO_USE_SSL === 'true';

    this.client = new Client({
      endPoint: endpoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });

    this.ensureBucket();
  }

  getClient(): Client {
    return this.client;
  }

  getBucketName(): string {
    return this.bucketName;
  }

  private async ensureBucket() {
    try {
      const exists = await this.client.bucketExists(this.bucketName);
      if (!exists) {
        await this.client.makeBucket(this.bucketName, 'us-east-1');
        console.log(`✅ Created MinIO bucket: ${this.bucketName}`);
      }
    } catch (error) {
      console.error(`❌ Failed to ensure MinIO bucket exists:`, error);
    }
  }
}


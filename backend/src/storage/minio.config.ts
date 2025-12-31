import { Injectable } from '@nestjs/common';
import { Client } from 'minio';

@Injectable()
export class MinioConfig {
  private client: Client;
  private readonly bucketName = 'shipsec-files';

  constructor() {
    const endpointEnv = process.env.MINIO_ENDPOINT ?? 'localhost';
    const portEnv = process.env.MINIO_PORT;
    const useSSLEnv = process.env.MINIO_USE_SSL;

    const { endPoint, port, useSSL } = this.normalizeEndpoint(endpointEnv, portEnv, useSSLEnv);
    const accessKey = process.env.MINIO_ROOT_USER ?? 'minioadmin';
    const secretKey = process.env.MINIO_ROOT_PASSWORD ?? 'minioadmin';

    this.client = new Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });

    if (process.env.SKIP_INGEST_SERVICES !== 'true') {
      this.ensureBucket();
    }
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

  private normalizeEndpoint(endpointEnv: string, portEnv?: string, useSSLEnv?: string) {
    let endPoint = endpointEnv;
    let port = this.parsePort(portEnv) ?? 9000;
    let useSSL = useSSLEnv === 'true';

    if (endpointEnv.includes('://')) {
      const url = new URL(endpointEnv);
      endPoint = url.hostname;
      port = this.parsePort(url.port) ?? port ?? (url.protocol === 'https:' ? 443 : 80);
      if (useSSLEnv === undefined) {
        useSSL = url.protocol === 'https:';
      }
    } else if (endpointEnv.includes(':')) {
      const [host, maybePort] = endpointEnv.split(':');
      endPoint = host;
      port = this.parsePort(maybePort) ?? port;
    }

    return { endPoint, port, useSSL };
  }

  private parsePort(value?: string) {
    if (!value) {
      return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}

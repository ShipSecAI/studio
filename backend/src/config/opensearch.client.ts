import { existsSync, readFileSync } from 'node:fs';

import { Client } from '@opensearch-project/opensearch';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class OpenSearchClient implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchClient.name);
  private client: Client | null = null;
  private isEnabled = false;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.initializeClient();
  }

  private initializeClient() {
    const url = this.configService.get<string>('opensearch.url');
    const username = this.configService.get<string>('opensearch.username');
    const password = this.configService.get<string>('opensearch.password');
    const caCertPath = this.configService.get<string>('OPENSEARCH_CA_CERT_PATH') || '';
    const rejectUnauthorized =
      this.configService.get<string>('OPENSEARCH_SSL_REJECT_UNAUTHORIZED') !== 'false';

    if (!url) {
      this.logger.warn(
        '🔍 OpenSearch client not configured - OPENSEARCH_URL not set. Security analytics indexing disabled.',
      );
      return;
    }

    try {
      const ca =
        caCertPath && existsSync(caCertPath) ? readFileSync(caCertPath, 'utf8') : undefined;
      if (caCertPath && !ca) {
        this.logger.warn(
          `OpenSearch CA certificate not found at ${caCertPath}; continuing without custom CA`,
        );
      }

      this.client = new Client({
        node: url,
        auth: username && password ? { username, password } : undefined,
        ssl: {
          ca,
          rejectUnauthorized,
        },
      });

      this.isEnabled = true;
      this.logger.log(`🔍 OpenSearch client initialized - Connected to ${url}`);
    } catch (error) {
      this.logger.error(`Failed to initialize OpenSearch client: ${error}`);
      this.isEnabled = false;
    }
  }

  getClient(): Client | null {
    return this.client;
  }

  isClientEnabled(): boolean {
    return this.isEnabled && this.client !== null;
  }
}

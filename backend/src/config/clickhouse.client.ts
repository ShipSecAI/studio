import { createClient, ClickHouseClient } from '@clickhouse/client';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ClickHouseClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ClickHouseClientService.name);
  private client: ClickHouseClient | null = null;
  private enabled = false;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeClient();

    // Periodic health check every 30s — re-initialize if connection was lost
    this.healthCheckInterval = setInterval(() => this.healthCheck(), 30_000);
  }

  async onModuleDestroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.client) {
      await this.client.close();
    }
  }

  private async initializeClient() {
    const url = this.configService.get<string>('clickhouse.url');
    const database = this.configService.get<string>('clickhouse.database') || 'shipsec';
    const username = this.configService.get<string>('clickhouse.username');
    const password = this.configService.get<string>('clickhouse.password');

    if (!url) {
      this.logger.warn(
        'ClickHouse client not configured - CLICKHOUSE_URL not set. Security analytics disabled.',
      );
      return;
    }

    try {
      // Close existing client if reconnecting
      if (this.client) {
        await this.client.close().catch(() => {});
      }

      this.client = createClient({
        url,
        database,
        ...(username && { username }),
        ...(password && { password }),
        clickhouse_settings: {
          async_insert: 1,
          wait_for_async_insert: 1,
          max_execution_time: 30,
        },
        request_timeout: 30_000,
      });

      // Verify connectivity
      const result = await this.client.query({ query: 'SELECT 1', format: 'JSONEachRow' });
      result.close();

      this.enabled = true;
      this.logger.log(`ClickHouse client initialized - Connected to ${url}/${database}`);
    } catch (error) {
      this.logger.error(`Failed to initialize ClickHouse client: ${error}`);
      this.enabled = false;
    }
  }

  private async healthCheck() {
    const url = this.configService.get<string>('clickhouse.url');
    if (!url) return;

    try {
      if (!this.client || !this.enabled) {
        this.logger.log('ClickHouse health check: attempting reconnection...');
        await this.initializeClient();
        return;
      }

      // Use /ping endpoint — bypasses query scheduler, lighter than SELECT 1
      const pingUrl = url.replace(/\/$/, '') + '/ping';
      const res = await fetch(pingUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      this.logger.warn('ClickHouse health check failed, will reconnect on next check');
      this.enabled = false;
    }
  }

  getClient(): ClickHouseClient | null {
    return this.client;
  }

  isClientEnabled(): boolean {
    return this.enabled && this.client !== null;
  }
}

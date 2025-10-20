import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

const REQUIRED_TABLES = [
  'workflows',
  'workflow_runs',
  'files',
  'log_streams',
  'traces',
];

@Injectable()
export class MigrationGuard implements OnModuleInit {
  private readonly logger = new Logger(MigrationGuard.name);

  constructor(private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    if (process.env.SHIPSEC_SKIP_MIGRATION_CHECK === 'true') {
      this.logger.warn('Skipping migration check because SHIPSEC_SKIP_MIGRATION_CHECK=true.');
      return;
    }

    const client = await this.pool.connect();

    try {
      const { rows } = await client.query<{ table_name: string }>(
        `select table_name
           from information_schema.tables
          where table_schema = 'public'
            and table_name = any($1::text[])`,
        [REQUIRED_TABLES],
      );

      const present = new Set(rows.map((row) => row.table_name));
      const missing = REQUIRED_TABLES.filter((table) => !present.has(table));

      if (missing.length > 0) {
        const message =
          `Database schema incomplete: missing tables [${missing.join(', ')}]. ` +
          'Run `bun run migrate` (alias for `bun --cwd backend x drizzle-kit push`) before starting the backend.';
        this.logger.error(message);
        throw new Error(message);
      }

      this.logger.log('Database schema check passed – required tables are present.');
    } catch (error) {
      this.logger.error(
        'Failed to verify database schema. Run `bun run migrate` to ensure migrations are applied.',
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    } finally {
      client.release();
    }
  }
}

import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

const REQUIRED_TABLES = [
  'workflows',
  'workflow_runs',
  'files',
  'artifacts',
  'workflow_log_streams',
  'workflow_traces',
  'agent_trace_events',
  'organization_settings',
  'subscription_plans',
  'litellm_virtual_keys',
];

const REQUIRED_COLUMNS: Record<string, string[]> = {
  workflows: ['is_system', 'template_id', 'icon', 'icon_color'],
  github_repositories: ['stars_count', 'forks_count'],
};

@Injectable()
export class MigrationGuard implements OnModuleInit {
  private readonly logger = new Logger(MigrationGuard.name);

  constructor(@Inject(Pool) private readonly pool: Pool) {}

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
          'Run `bun run migrate` to apply pending migrations.';
        this.logger.error(message);
        throw new Error(message);
      }

      for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
        const { rows: columnRows } = await client.query<{ column_name: string }>(
          `select column_name
             from information_schema.columns
            where table_schema = 'public'
              and table_name = $1
              and column_name = any($2::text[])`,
          [table, columns],
        );

        const presentColumns = new Set(columnRows.map((row) => row.column_name));
        const missingColumns = columns.filter((column) => !presentColumns.has(column));

        if (missingColumns.length > 0) {
          const message =
            `Database schema drift detected for ${table}: missing columns [${missingColumns.join(', ')}]. ` +
            'Run `bun run migrate` or the reconciliation migration before serving traffic.';
          this.logger.error(message);
          throw new Error(message);
        }
      }

      this.logger.log('Database schema check passed – required tables are present.');
    } catch (error) {
      this.logger.error(
        'Failed to verify database schema. Run `bun run migrate` to apply pending migrations.',
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    } finally {
      client.release();
    }
  }
}

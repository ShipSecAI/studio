import { resolve } from 'path';
import { Pool } from 'pg';
import { loadAllMigrations } from './lib/migrations';

async function main() {
  const connectionString =
    process.env.DATABASE_URL || 'postgresql://shipsec:shipsec@localhost:5433/shipsec';

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const migrationsDir = resolve(__dirname, '../drizzle');
  const migrations = loadAllMigrations(migrationsDir);

  console.log(`🧪 Migration smoke test starting (found ${migrations.length} files)`);

  try {
    await client.query('BEGIN');
    for (const migration of migrations) {
      console.log(`→ Applying ${migration.file}`);
      await client.query(migration.sql);
    }
    await client.query('ROLLBACK');
    console.log('✅ Migration smoke test passed (changes rolled back)');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration smoke test failed');
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ Migration smoke test encountered an unexpected error');
  console.error(error);
  process.exit(1);
});

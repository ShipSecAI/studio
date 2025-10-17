import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { Pool } from 'pg';

async function main() {
  const connectionString =
    process.env.DATABASE_URL || 'postgresql://shipsec:shipsec@localhost:5433/shipsec';

  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const migrationsDir = resolve(__dirname, '../drizzle');
  const files = readdirSync(migrationsDir)
    .filter((file) => /^\d+_.*\.sql$/i.test(file))
    .sort();

  console.log(`🧪 Migration smoke test starting (found ${files.length} files)`);

  try {
    await client.query('BEGIN');
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      console.log(`→ Applying ${file}`);
      await client.query(sql);
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

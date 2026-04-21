import { resolve } from 'path';
import { Pool } from 'pg';
import { loadAllMigrations } from './lib/migrations';

const DEFAULT_DATABASE_URL = 'postgresql://shipsec:shipsec@localhost:5433/shipsec';

async function main() {
  const connectionString = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const drizzleDir = resolve(__dirname, '../drizzle');
  const expected = new Map(
    loadAllMigrations(drizzleDir).map((migration) => [migration.tag, migration.hash]),
  );

  const pool = new Pool({ connectionString });

  try {
    const { rows } = await pool.query<{ hash: string }>(
      'SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id ASC',
    );

    const applied = new Set(rows.map((row) => row.hash));
    const missing = [...expected.entries()]
      .filter(([, hash]) => !applied.has(hash))
      .map(([tag]) => tag);

    if (missing.length > 0) {
      throw new Error(
        `Database is missing repo migrations: [${missing.join(', ')}]. Run \`bun run migration:deploy\` before rollout.`,
      );
    }

    console.log(
      `✅ Migration verify complete (${expected.size} repo migration(s) present in database).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ migration:verify failed');
  console.error(error);
  process.exit(1);
});

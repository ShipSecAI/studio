import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { basename, resolve } from 'path';
import { Pool } from 'pg';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries?: JournalEntry[];
}

function getBaselineMigrationFile(drizzleDir: string): string {
  const files = readdirSync(drizzleDir)
    .filter((file) => /^\d+_.*\.sql$/i.test(file))
    .sort();

  if (files.length === 0) {
    throw new Error(`No migration SQL files found in ${drizzleDir}`);
  }

  // For baseline stamping we use the latest generated migration file.
  return files[files.length - 1];
}

function getCreatedAtFromJournal(drizzleDir: string, sqlFile: string): number {
  const journalPath = resolve(drizzleDir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  const entries = journal.entries ?? [];
  const tag = basename(sqlFile, '.sql');
  const entry = entries.find((item) => item.tag === tag);

  if (entry?.when) {
    return entry.when;
  }

  const latest = entries[entries.length - 1];
  if (!latest?.when) {
    throw new Error(`No usable "when" value found in ${journalPath}`);
  }
  return latest.when;
}

async function main() {
  const force = process.argv.includes('--force');
  const connectionString =
    process.env.DATABASE_URL || 'postgresql://shipsec:shipsec@localhost:5433/shipsec';

  const drizzleDir = resolve(__dirname, '../drizzle');
  const sqlFile = getBaselineMigrationFile(drizzleDir);
  const sqlContent = readFileSync(resolve(drizzleDir, sqlFile), 'utf8');
  const hash = createHash('sha256').update(sqlContent).digest('hex');
  const createdAt = getCreatedAtFromJournal(drizzleDir, sqlFile);

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    const countResult = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations',
    );
    const existingCount = Number(countResult.rows[0]?.count ?? '0');

    if (existingCount > 0 && !force) {
      await client.query('ROLLBACK');
      console.warn(
        `⚠️ drizzle.__drizzle_migrations already has ${existingCount} row(s). ` +
          'Use --force to append baseline stamp idempotently.',
      );
      process.exit(1);
    }

    const insertResult = await client.query(
      `
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        SELECT $1, $2
        WHERE NOT EXISTS (
          SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1
        )
      `,
      [hash, createdAt],
    );

    await client.query('COMMIT');

    if (insertResult.rowCount === 0) {
      console.log(`ℹ️ Baseline already stamped (hash=${hash}).`);
    } else {
      console.log(`✅ Baseline stamped (hash=${hash}, created_at=${createdAt}).`);
    }

    console.log(
      'Verify with: SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC;',
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to stamp baseline migration');
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ Unexpected error while stamping baseline migration');
  console.error(error);
  process.exit(1);
});

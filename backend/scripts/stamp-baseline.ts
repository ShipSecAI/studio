import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { basename, resolve } from 'path';
import { Pool, type PoolClient } from 'pg';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries?: JournalEntry[];
}

function getMigrationFiles(drizzleDir: string): string[] {
  return readdirSync(drizzleDir)
    .filter((file) => /^\d+_.*\.sql$/i.test(file))
    .sort();
}

function getBaselineMigrationFile(drizzleDir: string): string {
  const preferredTag = process.env.DRIZZLE_BASELINE_TAG?.trim();
  const files = getMigrationFiles(drizzleDir);

  if (files.length === 0) {
    throw new Error(`No migration SQL files found in ${drizzleDir}`);
  }

  if (preferredTag) {
    const preferredFile = `${preferredTag}.sql`;
    if (files.includes(preferredFile)) {
      return preferredFile;
    }
    throw new Error(
      `DRIZZLE_BASELINE_TAG=${preferredTag} does not match any migration file in ${drizzleDir}`,
    );
  }

  // Baseline is always the first migration in lexical order.
  return files[0];
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

  const firstEntryWithWhen = entries.find((item) => Boolean(item.when));
  if (firstEntryWithWhen?.when) {
    return firstEntryWithWhen.when;
  }

  throw new Error(`No usable "when" value found in ${journalPath}`);
}

async function hasPublicTables(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
          FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_type = 'BASE TABLE'
      ) AS exists
    `,
  );
  return rows[0]?.exists ?? false;
}

async function hasBaselineHash(client: PoolClient, hash: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
          FROM drizzle.__drizzle_migrations
         WHERE hash = $1
      ) AS exists
    `,
    [hash],
  );

  return rows[0]?.exists ?? false;
}

async function insertBaselineHash(
  client: PoolClient,
  hash: string,
  createdAt: number,
): Promise<void> {
  await client.query(
    `
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES ($1, $2)
    `,
    [hash, createdAt],
  );
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

function getShortHash(hash: string): string {
  return hash.slice(0, 12);
}

async function main() {
  const force = process.argv.includes('--force');
  const connectionString =
    process.env.DATABASE_URL || 'postgresql://shipsec:shipsec@localhost:5433/shipsec';

  const drizzleDir = resolve(__dirname, '../drizzle');
  const baselineFile = getBaselineMigrationFile(drizzleDir);
  const sqlContent = readFileSync(resolve(drizzleDir, baselineFile), 'utf8');
  const hash = createHash('sha256').update(sqlContent).digest('hex');
  const createdAt = getCreatedAtFromJournal(drizzleDir, baselineFile);

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await ensureMigrationsTable(client);

    const publicTablesExist = await hasPublicTables(client);
    const baselineAlreadyStamped = await hasBaselineHash(client, hash);

    if (baselineAlreadyStamped) {
      await client.query('COMMIT');
      console.log(
        `ℹ️ Baseline already stamped (${baselineFile}, hash=${getShortHash(hash)}). Skipping.`,
      );
      return;
    }

    if (!publicTablesExist && !force) {
      await client.query('COMMIT');
      console.log(`ℹ️ Fresh database detected. Skipping baseline stamp for ${baselineFile}.`);
      return;
    }

    await insertBaselineHash(client, hash, createdAt);
    await client.query('COMMIT');
    console.log(`✅ Baseline stamped (${baselineFile}, hash=${getShortHash(hash)}).`);
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

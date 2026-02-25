import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool, type PoolClient } from 'pg';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries?: JournalEntry[];
}

interface Migration {
  tag: string;
  when: number;
  file: string;
  sql: string;
  hash: string;
}

const DEFAULT_DATABASE_URL = 'postgresql://shipsec:shipsec@localhost:5433/shipsec';

function readJournal(drizzleDir: string): JournalEntry[] {
  const journalPath = resolve(drizzleDir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  return [...(journal.entries ?? [])].sort((a, b) => a.idx - b.idx);
}

function loadMigrations(drizzleDir: string): Migration[] {
  const entries = readJournal(drizzleDir);

  if (entries.length === 0) {
    throw new Error(`No migration entries found in ${resolve(drizzleDir, 'meta/_journal.json')}`);
  }

  return entries.map((entry) => {
    const file = `${entry.tag}.sql`;
    const sql = readFileSync(resolve(drizzleDir, file), 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');

    return {
      tag: entry.tag,
      when: entry.when,
      file,
      sql,
      hash,
    };
  });
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

async function getKnownHashes(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ hash: string }>(
    'SELECT hash FROM drizzle.__drizzle_migrations',
  );
  return new Set(rows.map((row) => row.hash));
}

async function hasPublicTables(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
        FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'
    ) AS exists
  `);

  return rows[0]?.exists ?? false;
}

async function stampBaselineIfNeeded(
  client: PoolClient,
  baseline: Migration,
  knownHashes: Set<string>,
): Promise<void> {
  if (knownHashes.has(baseline.hash)) {
    return;
  }

  const publicTablesExist = await hasPublicTables(client);
  if (!publicTablesExist) {
    return;
  }

  await client.query(
    `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
    [baseline.hash, baseline.when],
  );
  knownHashes.add(baseline.hash);

  console.log(`✅ Baseline stamped (${baseline.file}).`);
}

async function applyMigration(
  client: PoolClient,
  migration: Migration,
  knownHashes: Set<string>,
): Promise<void> {
  if (knownHashes.has(migration.hash)) {
    console.log(`↷ Skipping already-applied migration ${migration.file}`);
    return;
  }

  console.log(`→ Applying ${migration.file}`);

  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      [migration.hash, migration.when],
    );
    await client.query('COMMIT');
    knownHashes.add(migration.hash);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const connectionString = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const drizzleDir = resolve(__dirname, '../drizzle');
  const migrations = loadMigrations(drizzleDir);

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);

    const knownHashes = await getKnownHashes(client);

    const [baseline] = migrations;
    if (!baseline) {
      throw new Error('No baseline migration found in journal entries.');
    }

    await stampBaselineIfNeeded(client, baseline, knownHashes);

    for (const migration of migrations) {
      await applyMigration(client, migration, knownHashes);
    }

    console.log(`✅ Migration deploy complete (${migrations.length} migration(s) tracked).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('❌ migration:deploy failed');
  console.error(error);
  process.exit(1);
});

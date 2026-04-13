import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries?: JournalEntry[];
}

const DEFAULT_DATABASE_URL = 'postgresql://shipsec:shipsec@localhost:5433/shipsec';

function readJournalEntries(drizzleDir: string): JournalEntry[] {
  const journalPath = resolve(drizzleDir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  return [...(journal.entries ?? [])].sort((a, b) => a.idx - b.idx);
}

function expectedMigrationHashes(drizzleDir: string): Map<string, string> {
  const entries = readJournalEntries(drizzleDir);

  if (entries.length === 0) {
    throw new Error(`No migration entries found in ${resolve(drizzleDir, 'meta/_journal.json')}`);
  }

  return new Map(
    entries.map((entry) => {
      const file = `${entry.tag}.sql`;
      const sql = readFileSync(resolve(drizzleDir, file), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      return [entry.tag, hash];
    }),
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const drizzleDir = resolve(__dirname, '../drizzle');
  const expected = expectedMigrationHashes(drizzleDir);

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

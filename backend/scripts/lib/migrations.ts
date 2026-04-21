import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries?: JournalEntry[];
}

export interface LoadedMigration extends JournalEntry {
  dir: string;
  file: string;
  sql: string;
  hash: string;
}

export function getConfiguredDrizzleDirs(baseDir: string): string[] {
  const extraDirs = (process.env.SHIPSEC_EXTRA_DRIZZLE_DIRS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(process.cwd(), entry));

  const ordered = [resolve(baseDir), ...extraDirs];
  return [...new Set(ordered)].filter((dir) => existsSync(resolve(dir, 'meta/_journal.json')));
}

export function readJournalEntries(drizzleDir: string): JournalEntry[] {
  const journalPath = resolve(drizzleDir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
  return [...(journal.entries ?? [])].sort((a, b) => a.idx - b.idx);
}

export function loadMigrations(drizzleDir: string): LoadedMigration[] {
  const entries = readJournalEntries(drizzleDir);

  if (entries.length === 0) {
    throw new Error(`No migration entries found in ${resolve(drizzleDir, 'meta/_journal.json')}`);
  }

  return entries.map((entry) => {
    const file = `${entry.tag}.sql`;
    const sql = readFileSync(resolve(drizzleDir, file), 'utf8');
    const hash = createHash('sha256').update(sql).digest('hex');

    return {
      ...entry,
      dir: drizzleDir,
      file,
      sql,
      hash,
    };
  });
}

export function loadAllMigrations(baseDir: string): LoadedMigration[] {
  return getConfiguredDrizzleDirs(baseDir).flatMap((dir) => loadMigrations(dir));
}

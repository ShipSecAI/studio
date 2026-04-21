import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { getConfiguredDrizzleDirs, loadAllMigrations, type JournalEntry } from '../migrations';

function writeDrizzleDir(
  rootDir: string,
  relativeDir: string,
  entries: (JournalEntry & { sql: string })[],
): string {
  const drizzleDir = join(rootDir, relativeDir);
  mkdirSync(join(drizzleDir, 'meta'), { recursive: true });

  writeFileSync(
    join(drizzleDir, 'meta', '_journal.json'),
    JSON.stringify(
      {
        version: '7',
        dialect: 'postgresql',
        entries: entries.map(({ sql: _sql, ...entry }) => ({
          ...entry,
          version: '7',
          breakpoints: true,
        })),
      },
      null,
      2,
    ) + '\n',
  );

  for (const entry of entries) {
    writeFileSync(join(drizzleDir, `${entry.tag}.sql`), entry.sql);
  }

  return drizzleDir;
}

describe('migration loader', () => {
  let tempRoot: string;
  let previousExtraDirs: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'shipsec-migrations-'));
    previousExtraDirs = process.env.SHIPSEC_EXTRA_DRIZZLE_DIRS;
    delete process.env.SHIPSEC_EXTRA_DRIZZLE_DIRS;
  });

  afterEach(() => {
    if (previousExtraDirs === undefined) {
      delete process.env.SHIPSEC_EXTRA_DRIZZLE_DIRS;
    } else {
      process.env.SHIPSEC_EXTRA_DRIZZLE_DIRS = previousExtraDirs;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('includes the base drizzle dir and any existing overlay drizzle dirs', () => {
    const baseDir = writeDrizzleDir(tempRoot, 'backend/drizzle', [
      {
        idx: 0,
        when: 100,
        tag: '0000_public',
        sql: '-- public migration\nselect 1;\n',
      },
    ]);
    const overlayDir = writeDrizzleDir(tempRoot, 'cloud/drizzle', [
      {
        idx: 0,
        when: 200,
        tag: '0000_cloud',
        sql: '-- cloud migration\nselect 2;\n',
      },
    ]);

    process.env.SHIPSEC_EXTRA_DRIZZLE_DIRS = [
      overlayDir,
      join(tempRoot, 'missing', 'drizzle'),
      overlayDir,
    ].join(',');

    const resolved = getConfiguredDrizzleDirs(baseDir);

    expect(resolved).toEqual([resolve(baseDir), resolve(overlayDir)]);
    expect(loadAllMigrations(baseDir).map((migration) => migration.tag)).toEqual([
      '0000_public',
      '0000_cloud',
    ]);
  });

  it('keeps the public journal order first and appends overlay journals in configured order', () => {
    const baseDir = writeDrizzleDir(tempRoot, 'backend/drizzle', [
      {
        idx: 1,
        when: 300,
        tag: '0001_public_b',
        sql: '-- public second\nselect 2;\n',
      },
      {
        idx: 0,
        when: 100,
        tag: '0000_public_a',
        sql: '-- public first\nselect 1;\n',
      },
    ]);

    const overlayDir = writeDrizzleDir(tempRoot, 'cloud/drizzle', [
      {
        idx: 0,
        when: 50,
        tag: '0000_cloud_first',
        sql: '-- cloud same time\nselect 3;\n',
      },
      {
        idx: 1,
        when: 25,
        tag: '0001_cloud_second',
        sql: '-- cloud second\nselect 4;\n',
      },
    ]);

    process.env.SHIPSEC_EXTRA_DRIZZLE_DIRS = overlayDir;

    const ordered = loadAllMigrations(baseDir).map((migration) => ({
      tag: migration.tag,
      when: migration.when,
      file: migration.file,
      dir: migration.dir,
    }));

    expect(ordered.map((migration) => migration.tag)).toEqual([
      '0000_public_a',
      '0001_public_b',
      '0000_cloud_first',
      '0001_cloud_second',
    ]);
  });
});

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateSecurityWikiRun } from './security-wiki.validator';

describe('validateSecurityWikiRun', () => {
  it('accepts scoped wiki files with a matching manifest', () => {
    const wikiPath = mkdtempSync(join(tmpdir(), 'wiki-validator-'));
    mkdirSync(join(wikiPath, 'agent-state/manifests'), { recursive: true });
    mkdirSync(join(wikiPath, 'assets/repos/example'), { recursive: true });
    writeFileSync(
      join(wikiPath, 'agent-state/manifests/run-1.yaml'),
      'run_id: run-1\nagent: code-explorer-agent\nchanged_files: []\n',
    );
    writeFileSync(
      join(wikiPath, 'assets/repos/example/overview.md'),
      '# Overview\nsource: repo/file.ts\n',
    );

    const result = validateSecurityWikiRun({
      wikiPath,
      runId: 'run-1',
      agentName: 'code-explorer-agent',
      changedFiles: ['agent-state/manifests/run-1.yaml', 'assets/repos/example/overview.md'],
      allowedGlobs: ['agent-state/manifests/**', 'assets/repos/**'],
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects files outside allowed paths and obvious secrets', () => {
    const wikiPath = mkdtempSync(join(tmpdir(), 'wiki-validator-'));
    mkdirSync(join(wikiPath, 'agent-state/manifests'), { recursive: true });
    mkdirSync(join(wikiPath, 'org'), { recursive: true });
    writeFileSync(
      join(wikiPath, 'agent-state/manifests/run-1.yaml'),
      'run_id: run-1\nagent: code-explorer-agent\n',
    );
    writeFileSync(
      join(wikiPath, 'org/profile.md'),
      'token sk-abcdefghijklmnopqrstuvwxyzABCDEFGH\n',
    );

    const result = validateSecurityWikiRun({
      wikiPath,
      runId: 'run-1',
      agentName: 'code-explorer-agent',
      changedFiles: ['agent-state/manifests/run-1.yaml', 'org/profile.md'],
      allowedGlobs: ['agent-state/manifests/**', 'assets/repos/**'],
    });

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes('outside allowed paths'))).toBe(true);
    expect(result.errors.some((error) => error.includes('Possible secret'))).toBe(true);
  });
});

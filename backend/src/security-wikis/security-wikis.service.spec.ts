import { describe, expect, it } from 'bun:test';

import {
  extractSecurityWikiRunResult,
  normalizeSecurityWikiCodeSources,
} from './security-wiki.metadata';

describe('security wiki service helpers', () => {
  it('normalizes explicit GitHub code sources while preserving repo identity and cadence', () => {
    const sources = normalizeSecurityWikiCodeSources([
      {
        repoId: 123,
        fullName: 'shipsec/studio-cloud',
        defaultBranch: 'main',
        cadence: 'nightly',
      },
      { repoId: '', fullName: 'ignored/repo' },
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      repoId: '123',
      fullName: 'shipsec/studio-cloud',
      repoOwner: 'shipsec',
      repoName: 'studio-cloud',
      defaultBranch: 'main',
      enabled: true,
      cadence: 'nightly',
    });
    expect(sources[0].addedAt).toBeString();
  });

  it('projects terminal workflow output into security wiki run fields', () => {
    const projection = extractSecurityWikiRunResult({
      outputs: {
        context: { validation: { ok: true } },
        codex: {
          changed_files: ['agent-state/manifests/run-1.yaml', 'assets/repos/app/overview.md'],
          output_commit: 'abc123',
          mergeCommit: 'def456',
          wikiBaseCommit: 'base789',
          branchName: 'wiki/code-wiki-1',
        },
      },
      success: true,
    });

    expect(projection).toEqual({
      changedFiles: ['agent-state/manifests/run-1.yaml', 'assets/repos/app/overview.md'],
      outputCommit: 'abc123',
      mergeCommit: 'def456',
      wikiBaseCommit: 'base789',
      branchName: 'wiki/code-wiki-1',
      validation: { ok: true },
    });
  });
});

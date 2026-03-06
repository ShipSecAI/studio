import { describe, expect, test } from 'bun:test';
import {
  buildGitHubBranchOptions,
  getGitHubInstallationManageUrl,
  parseGitHubInstallationId,
} from '@/lib/github-ui';

describe('parseGitHubInstallationId', () => {
  test('parses org-scoped installation URLs', () => {
    expect(
      parseGitHubInstallationId(
        'https://github.com/organizations/ShipSecAI/settings/installations/108884199',
      ),
    ).toBe(108884199);
  });

  test('parses install callback URLs', () => {
    expect(
      parseGitHubInstallationId('https://studio.example.com/github?installation_id=108884199'),
    ).toBe(108884199);
  });
});

describe('getGitHubInstallationManageUrl', () => {
  test('uses org-scoped settings URL for organization installations', () => {
    expect(
      getGitHubInstallationManageUrl({
        installationId: 108884199,
        accountLogin: 'ShipSecAI',
        accountType: 'Organization',
      }),
    ).toBe('https://github.com/organizations/ShipSecAI/settings/installations/108884199');
  });

  test('uses user settings URL for personal installations', () => {
    expect(
      getGitHubInstallationManageUrl({
        installationId: 42,
        accountLogin: 'alice',
        accountType: 'User',
      }),
    ).toBe('https://github.com/settings/installations/42');
  });
});

describe('buildGitHubBranchOptions', () => {
  test('keeps default and original branches selectable without duplicates', () => {
    expect(
      buildGitHubBranchOptions({
        defaultBranch: 'main',
        originalBranch: 'release/2026-03',
        branches: [
          { name: 'main', isDefault: true },
          { name: 'develop', isDefault: false },
          { name: 'release/2026-03', isDefault: false },
        ],
      }),
    ).toEqual([
      { value: 'main', label: 'main (default)' },
      { value: 'release/2026-03', label: 'release/2026-03 (original)' },
      { value: 'develop', label: 'develop' },
    ]);
  });
});

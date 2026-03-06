import type { GitHubInstallation } from '@/store/githubStore';

export interface GitHubBranchOption {
  value: string;
  label: string;
}

export function parseGitHubInstallationId(input: string): number | null {
  const value = input.trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const id = Number.parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  const pathMatch = value.match(/\/installations\/(\d+)/i);
  if (pathMatch?.[1]) {
    const id = Number.parseInt(pathMatch[1], 10);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  const queryMatch = value.match(/[?&]installation_id=(\d+)/i);
  if (queryMatch?.[1]) {
    const id = Number.parseInt(queryMatch[1], 10);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  return null;
}

export function getGitHubInstallationManageUrl(
  installation: Pick<GitHubInstallation, 'installationId' | 'accountLogin' | 'accountType'>,
): string {
  if (installation.accountType === 'Organization' && installation.accountLogin.trim().length > 0) {
    return `https://github.com/organizations/${encodeURIComponent(installation.accountLogin)}/settings/installations/${installation.installationId}`;
  }

  return `https://github.com/settings/installations/${installation.installationId}`;
}

export function buildGitHubBranchOptions({
  branches,
  defaultBranch,
  originalBranch,
}: {
  branches: { name: string; isDefault: boolean }[];
  defaultBranch?: string | null;
  originalBranch?: string | null;
}): GitHubBranchOption[] {
  const options = new Map<string, GitHubBranchOption>();

  const addOption = (name: string | null | undefined, label?: string) => {
    const trimmed = name?.trim();
    if (!trimmed || options.has(trimmed)) return;
    options.set(trimmed, { value: trimmed, label: label ?? trimmed });
  };

  addOption(defaultBranch, `${defaultBranch} (default)`);
  if (originalBranch && originalBranch !== defaultBranch) {
    addOption(originalBranch, `${originalBranch} (original)`);
  }

  for (const branch of branches) {
    addOption(branch.name, branch.isDefault ? `${branch.name} (default)` : branch.name);
  }

  if (options.size === 0) {
    addOption('main', 'main (default)');
  }

  return Array.from(options.values());
}

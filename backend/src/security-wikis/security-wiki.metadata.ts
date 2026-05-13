export type SecurityWikiCodeSourceCadence = 'manual' | 'nightly' | 'weekly';

export interface SecurityWikiCodeSourceDto {
  repoId: string;
  fullName: string;
  repoOwner?: string;
  repoName?: string;
  defaultBranch?: string | null;
  enabled: boolean;
  cadence: SecurityWikiCodeSourceCadence;
  addedAt: string;
}

export interface SecurityWikiRunResultProjection {
  status?: string;
  changedFiles?: string[];
  outputCommit?: string | null;
  mergeCommit?: string | null;
  wikiBaseCommit?: string | null;
  repoCommit?: string | null;
  branchName?: string | null;
  validation?: Record<string, unknown>;
  error?: string | null;
}

export const GITHUB_BACKED_WIKI_CHECKOUT_CONTRACT = {
  mode: 'pending_managed_checkout',
  requiredFor: ['browse', 'code-ingestion'],
  note: 'GitHub App-backed wiki checkout is a product contract; local-path wiki validation remains supported until the managed checkout runner is available.',
} as const;

export function normalizeSecurityWikiCodeSources(input: unknown): SecurityWikiCodeSourceDto[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    const source = asSecurityWikiRecord(item);
    if (!source) return [];
    const repoId = normalizeString(source.repoId);
    const fullName = normalizeString(source.fullName);
    if (!repoId || !fullName) return [];

    const [ownerFromName, repoFromName] = fullName.split('/');
    return [
      {
        repoId,
        fullName,
        repoOwner: normalizeString(source.repoOwner) ?? ownerFromName,
        repoName: normalizeString(source.repoName) ?? repoFromName ?? fullName,
        defaultBranch: normalizeString(source.defaultBranch) ?? null,
        enabled: source.enabled !== false,
        cadence: normalizeCadence(source.cadence),
        addedAt: normalizeString(source.addedAt) ?? new Date().toISOString(),
      },
    ];
  });
}

export function extractSecurityWikiRunResult(result: unknown): SecurityWikiRunResultProjection {
  const root = asSecurityWikiRecord(result);
  const outputs = asSecurityWikiRecord(root?.outputs);
  const candidates = [root, ...Object.values(outputs ?? {}).map(asSecurityWikiRecord)].filter(
    (value): value is Record<string, unknown> => Boolean(value),
  );
  const projection: SecurityWikiRunResultProjection = {};

  for (const candidate of candidates) {
    const status = pickString(candidate, ['status']);
    if (status !== null) projection.status ??= status;
    projection.outputCommit ??= pickString(candidate, [
      'outputCommit',
      'output_commit',
      'wikiOutputCommit',
      'wiki_output_commit',
    ]);
    projection.mergeCommit ??= pickString(candidate, ['mergeCommit', 'merge_commit']);
    projection.wikiBaseCommit ??= pickString(candidate, ['wikiBaseCommit', 'wiki_base_commit']);
    projection.repoCommit ??= pickString(candidate, ['repoCommit', 'repo_commit']);
    projection.branchName ??= pickString(candidate, ['branchName', 'branch_name']);
    projection.error ??= pickString(candidate, ['error', 'errorMessage', 'message']);

    if (!projection.changedFiles) {
      projection.changedFiles = pickStringArray(candidate, [
        'changedFiles',
        'changed_files',
        'files',
      ]);
    }
    if (!projection.validation) {
      projection.validation =
        asSecurityWikiRecord(candidate.validation) ??
        asSecurityWikiRecord(candidate.validationResult) ??
        undefined;
    }
  }

  if (root?.success === false && !projection.error) {
    projection.error = 'Workflow result reported success=false';
  }

  return projection;
}

export function asSecurityWikiRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCadence(value: unknown): SecurityWikiCodeSourceCadence {
  return value === 'nightly' || value === 'weekly' ? value : 'manual';
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
    if (value === null) return null;
  }
  return undefined;
}

function pickStringArray(record: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
  }
  return undefined;
}

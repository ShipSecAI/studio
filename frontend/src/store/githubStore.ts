import { create } from 'zustand';
import { API_BASE_URL } from '@/services/api';

// Types
export interface GitHubInstallation {
  id: string;
  installationId: number;
  accountType: 'Organization' | 'User';
  accountLogin: string;
  accountId: number;
  accountAvatarUrl: string | null;
  repositorySelection: 'all' | 'selected' | null;
  isActive: boolean;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubRepo {
  id: string;
  installationId: string;
  repoId: number;
  fullName: string;
  name: string;
  owner: string;
  isPrivate: boolean;
  defaultBranch: string | null;
  description: string | null;
  language: string | null;
  htmlUrl: string | null;
  scansEnabled: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TriggerRule {
  id: string;
  name: string;
  description: string | null;
  repositoryPattern: string;
  event: string;
  actions: string[];
  branches: string[];
  workflowId: string;
  postPrComment: boolean;
  createCheckRun: boolean;
  postPrReview: boolean;
  failOn: string;
  enabled: boolean;
  priority: number;
  organizationId: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface ScanFinding {
  id: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  file: string;
  line?: number;
  endLine?: number;
  message: string;
  snippet?: string;
  ruleId?: string;
  category?: string;
}

export interface GitHubScanResult {
  id: string;
  repositoryId: string;
  workflowRunId: string;
  sourceType: 'pr' | 'push' | 'manual' | 'schedule';
  triggerType: string | null;
  triggerSource: string | null;
  triggerLabel: string | null;
  scheduleId: string | null;
  scheduleName: string | null;
  prNumber: number | null;
  branch: string | null;
  commitSha: string | null;
  status: 'pending' | 'running' | 'success' | 'failure' | 'error';
  summary: ScanSummary;
  findingsCount: number;
  findings: ScanFinding[];
  checkRunId: number | null;
  prCommentId: number | null;
  prReviewId: number | null;
  resultsUrl: string | null;
  errorMessage: string | null;
  triggerRuleId: string | null;
  organizationId: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  workflowName: string | null;
  workflowVersion: number | null;
}

interface ScanResultsCacheEntry {
  data: GitHubScanResult[];
  hasMore: boolean;
  fetchedAt: number;
}

export interface CreateTriggerRuleInput {
  name: string;
  description?: string;
  repositoryPattern: string;
  event: 'pull_request' | 'push' | 'release' | 'repository_added';
  actions?: string[];
  branches?: string[];
  workflowId: string;
  postPrComment?: boolean;
  createCheckRun?: boolean;
  postPrReview?: boolean;
  failOn?: string;
  enabled?: boolean;
  priority?: number;
}

// State & Actions
interface GitHubStoreState {
  // Status
  isConfigured: boolean | null;
  installUrl: string | null;

  // Installations
  installations: GitHubInstallation[];
  installationsLoading: boolean;

  // Repositories
  repositories: GitHubRepo[];
  repositoriesLoading: boolean;

  // Trigger Rules
  triggerRules: TriggerRule[];
  triggerRulesLoading: boolean;

  // Scan Results
  scanResults: GitHubScanResult[];
  scanResultsLoading: boolean;
  scanResultsHasMore: boolean;
  scanResultsFirstPageCache: Record<string, ScanResultsCacheEntry>;
  scanResultsRequestId: number;
  scanResultsRequestKey: string | null;

  // Scan detail cache (keyed by scan ID)
  scanDetailCache: Record<string, { data: GitHubScanResult; fetchedAt: number }>;

  // Branches (keyed by repo ID)
  branchesByRepo: Record<string, { name: string; isDefault: boolean }[]>;
  branchesLoading: string | null; // repo ID currently loading

  // General
  error: string | null;
  lastFetched: Record<string, number>;
}

interface GitHubStoreActions {
  // Status
  fetchStatus: () => Promise<void>;

  // Installations
  fetchInstallations: (options?: { force?: boolean }) => Promise<GitHubInstallation[]>;
  setupInstallation: (installationId: number) => Promise<GitHubInstallation>;

  // Repositories
  fetchRepositories: (options?: { force?: boolean }) => Promise<GitHubRepo[]>;
  toggleRepoScans: (id: string, enabled: boolean) => Promise<GitHubRepo>;
  syncRepositories: () => Promise<{ synced: number }>;

  // Trigger Rules
  fetchTriggerRules: (options?: { force?: boolean }) => Promise<TriggerRule[]>;
  createTriggerRule: (input: CreateTriggerRuleInput) => Promise<TriggerRule>;
  updateTriggerRule: (id: string, input: Partial<CreateTriggerRuleInput>) => Promise<TriggerRule>;
  deleteTriggerRule: (id: string) => Promise<void>;

  // Scan Results
  fetchScanResults: (options?: {
    force?: boolean;
    repositoryId?: string;
    status?: string;
    source?: 'pr' | 'push' | 'manual' | 'schedule';
    scheduleId?: string;
    triggerRuleId?: string;
    limit?: number;
    offset?: number;
  }) => Promise<GitHubScanResult[]>;
  getScanResult: (id: string) => Promise<GitHubScanResult>;
  triggerScan: (repoId: string, workflowId: string, branch?: string) => Promise<string>;

  // Branches
  fetchBranches: (
    repoId: string,
    options?: { force?: boolean },
  ) => Promise<{ name: string; isDefault: boolean }[]>;

  // Helpers
  setError: (error: string | null) => void;
  reset: () => void;
}

export type GitHubStore = GitHubStoreState & GitHubStoreActions;

const STALE_MS = 30_000;
const DEFAULT_SCAN_PAGE_SIZE = 25;

function getScanFirstPageCacheKey(options: {
  repositoryId?: string;
  status?: string;
  source?: 'pr' | 'push' | 'manual' | 'schedule';
  scheduleId?: string;
  triggerRuleId?: string;
  limit: number;
}): string {
  return [
    options.repositoryId ?? 'all',
    options.status ?? 'all',
    options.source ?? 'all',
    options.scheduleId ?? 'all',
    options.triggerRuleId ?? 'all',
    options.limit,
  ].join('|');
}

const createInitialState = (): GitHubStoreState => ({
  isConfigured: null,
  installUrl: null,
  installations: [],
  installationsLoading: false,
  repositories: [],
  repositoriesLoading: false,
  triggerRules: [],
  triggerRulesLoading: false,
  scanResults: [],
  scanResultsLoading: false,
  scanResultsHasMore: false,
  scanResultsFirstPageCache: {},
  scanResultsRequestId: 0,
  scanResultsRequestKey: null,
  scanDetailCache: {},
  branchesByRepo: {},
  branchesLoading: null,
  error: null,
  lastFetched: {},
});

async function fetchWithHeaders(url: string, options: RequestInit = {}): Promise<Response> {
  const { getApiAuthHeaders } = await import('@/services/api');
  const headers = await getApiAuthHeaders();

  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

export const useGitHubStore = create<GitHubStore>((set, get) => ({
  ...createInitialState(),

  fetchStatus: async () => {
    try {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/status`);
      if (!response.ok) throw new Error('Failed to fetch GitHub status');
      const data = await response.json();
      set({
        isConfigured: data.configured,
        installUrl: data.installUrl,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch status';
      set({ error: message, isConfigured: false });
    }
  },

  fetchInstallations: async (options) => {
    const { lastFetched, installationsLoading } = get();
    const force = options?.force ?? false;
    const isFresh = lastFetched.installations && Date.now() - lastFetched.installations < STALE_MS;

    if (!force && !installationsLoading && isFresh) {
      return get().installations;
    }

    set({ installationsLoading: true, error: null });

    try {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/installations`);
      if (!response.ok) throw new Error('Failed to fetch installations');
      const installations = await response.json();
      set({
        installations,
        installationsLoading: false,
        lastFetched: { ...get().lastFetched, installations: Date.now() },
      });
      return installations;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch installations';
      set({ installationsLoading: false, error: message });
      throw error;
    }
  },

  setupInstallation: async (installationId: number) => {
    const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/installations/setup`, {
      method: 'POST',
      body: JSON.stringify({ installationId }),
    });
    if (!response.ok) throw new Error('Failed to setup installation');
    const installation = await response.json();

    // Force refresh installations and repositories
    await get().fetchInstallations({ force: true });
    await get().fetchRepositories({ force: true });

    return installation;
  },

  fetchRepositories: async (options) => {
    const { lastFetched, repositoriesLoading } = get();
    const force = options?.force ?? false;
    const isFresh = lastFetched.repositories && Date.now() - lastFetched.repositories < STALE_MS;

    if (!force && !repositoriesLoading && isFresh) {
      return get().repositories;
    }

    set({ repositoriesLoading: true, error: null });

    try {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/repos`);
      if (!response.ok) throw new Error('Failed to fetch repositories');
      const repositories = await response.json();
      set({
        repositories,
        repositoriesLoading: false,
        lastFetched: { ...get().lastFetched, repositories: Date.now() },
      });
      return repositories;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch repositories';
      set({ repositoriesLoading: false, error: message });
      throw error;
    }
  },

  toggleRepoScans: async (id, enabled) => {
    const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/repos/${id}/scans`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) throw new Error('Failed to update repository');
    const repo = await response.json();

    set((state) => ({
      repositories: state.repositories.map((r) => (r.id === id ? repo : r)),
    }));

    return repo;
  },

  syncRepositories: async () => {
    set({ repositoriesLoading: true, error: null });

    try {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/repos/sync`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to sync repositories');
      const result = await response.json();

      // Refetch repositories after sync
      await get().fetchRepositories({ force: true });

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to sync repositories';
      set({ repositoriesLoading: false, error: message });
      throw error;
    }
  },

  fetchTriggerRules: async (options) => {
    const { lastFetched, triggerRulesLoading } = get();
    const force = options?.force ?? false;
    const isFresh = lastFetched.triggerRules && Date.now() - lastFetched.triggerRules < STALE_MS;

    if (!force && !triggerRulesLoading && isFresh) {
      return get().triggerRules;
    }

    set({ triggerRulesLoading: true, error: null });

    try {
      const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/triggers`);
      if (!response.ok) throw new Error('Failed to fetch trigger rules');
      const triggerRules = await response.json();
      set({
        triggerRules,
        triggerRulesLoading: false,
        lastFetched: { ...get().lastFetched, triggerRules: Date.now() },
      });
      return triggerRules;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch trigger rules';
      set({ triggerRulesLoading: false, error: message });
      throw error;
    }
  },

  createTriggerRule: async (input) => {
    const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/triggers`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error('Failed to create trigger rule');
    const rule = await response.json();

    set((state) => ({
      triggerRules: [...state.triggerRules, rule],
    }));

    return rule;
  },

  updateTriggerRule: async (id, input) => {
    const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/triggers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error('Failed to update trigger rule');
    const rule = await response.json();

    set((state) => ({
      triggerRules: state.triggerRules.map((r) => (r.id === id ? rule : r)),
    }));

    return rule;
  },

  deleteTriggerRule: async (id) => {
    const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/triggers/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete trigger rule');

    set((state) => ({
      triggerRules: state.triggerRules.filter((r) => r.id !== id),
    }));
  },

  fetchScanResults: async (options) => {
    const force = options?.force ?? false;
    const limit = options?.limit ?? DEFAULT_SCAN_PAGE_SIZE;
    const offset = Math.max(options?.offset ?? 0, 0);
    const hasFilters =
      Boolean(options?.repositoryId) ||
      Boolean(options?.status) ||
      Boolean(options?.source) ||
      Boolean(options?.scheduleId) ||
      Boolean(options?.triggerRuleId);
    const requestKey = [
      options?.repositoryId ?? 'all',
      options?.status ?? 'all',
      options?.source ?? 'all',
      options?.scheduleId ?? 'all',
      options?.triggerRuleId ?? 'all',
      limit,
      offset,
    ].join('|');
    const isCacheEligible = offset === 0 && !hasFilters;
    const cacheKey = getScanFirstPageCacheKey({
      repositoryId: options?.repositoryId,
      status: options?.status,
      source: options?.source,
      scheduleId: options?.scheduleId,
      triggerRuleId: options?.triggerRuleId,
      limit,
    });

    // Always advance request version so older in-flight responses are ignored,
    // even when this call can be satisfied from cache.
    const requestId = get().scanResultsRequestId + 1;
    set({ scanResultsRequestId: requestId });

    let hasCachedFirstPage = false;
    if (!force && isCacheEligible) {
      const cached = get().scanResultsFirstPageCache[cacheKey];
      if (cached && Date.now() - cached.fetchedAt < STALE_MS) {
        hasCachedFirstPage = true;
        set((state) => {
          if (state.scanResultsRequestId !== requestId) {
            return state;
          }
          return {
            scanResults: cached.data,
            scanResultsHasMore: cached.hasMore,
            scanResultsLoading: false,
            scanResultsRequestKey: requestKey,
          };
        });
      }
    }

    if (!hasCachedFirstPage) {
      set((state) => {
        if (state.scanResultsRequestId !== requestId) {
          return state;
        }
        const queryChanged = state.scanResultsRequestKey !== requestKey;
        return {
          scanResultsLoading: true,
          error: null,
          scanResultsRequestKey: requestKey,
          scanResults: queryChanged ? [] : state.scanResults,
          scanResultsHasMore: queryChanged ? false : state.scanResultsHasMore,
        };
      });
    }

    try {
      const params = new URLSearchParams();
      if (options?.repositoryId) params.set('repositoryId', options.repositoryId);
      if (options?.status) params.set('status', options.status);
      if (options?.source) params.set('source', options.source);
      if (options?.scheduleId) params.set('scheduleId', options.scheduleId);
      if (options?.triggerRuleId) params.set('triggerRuleId', options.triggerRuleId);
      params.set('limit', String(limit + 1));
      if (offset > 0) params.set('offset', String(offset));

      const url = `${API_BASE_URL}/api/v1/github/scans${params.toString() ? `?${params}` : ''}`;
      const response = await fetchWithHeaders(url);
      if (!response.ok) throw new Error('Failed to fetch scan results');
      const rows = (await response.json()) as GitHubScanResult[];
      const hasMore = rows.length > limit;
      const scanResults = hasMore ? rows.slice(0, limit) : rows;

      set((state) => {
        // Ignore stale responses when multiple filter/page requests are in flight.
        if (state.scanResultsRequestId !== requestId) {
          return state;
        }
        return {
          scanResults,
          scanResultsHasMore: hasMore,
          scanResultsLoading: false,
          scanResultsRequestKey: requestKey,
          scanResultsFirstPageCache: isCacheEligible
            ? {
                ...state.scanResultsFirstPageCache,
                [cacheKey]: {
                  data: scanResults,
                  hasMore,
                  fetchedAt: Date.now(),
                },
              }
            : state.scanResultsFirstPageCache,
        };
      });
      return scanResults;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch scan results';
      set((state) => {
        if (state.scanResultsRequestId !== requestId) {
          return state;
        }
        return { scanResultsLoading: false, error: message };
      });
      throw error;
    }
  },

  getScanResult: async (id) => {
    const cached = get().scanDetailCache[id];
    const CACHE_TTL = 30_000;
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.data;
    }

    const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/scans/${id}`);
    if (!response.ok) throw new Error('Failed to fetch scan result');
    const data = await response.json();

    set((state) => ({
      scanDetailCache: {
        ...state.scanDetailCache,
        [id]: { data, fetchedAt: Date.now() },
      },
    }));

    return data;
  },

  triggerScan: async (repoId, workflowId, branch) => {
    const body: { workflowId: string; branch?: string } = { workflowId };
    if (branch) {
      body.branch = branch;
    }

    const response = await fetchWithHeaders(`${API_BASE_URL}/api/v1/github/repos/${repoId}/scan`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = errorData.message || 'Failed to trigger scan';
      throw new Error(message);
    }

    const data = await response.json();
    return data.scanId;
  },

  fetchBranches: async (repoId, options) => {
    const { lastFetched, branchesLoading, branchesByRepo } = get();
    const force = options?.force ?? false;
    const cacheKey = `branches-${repoId}`;
    const isFresh = lastFetched[cacheKey] && Date.now() - lastFetched[cacheKey] < STALE_MS;

    if (!force && !branchesLoading && isFresh && branchesByRepo[repoId]) {
      return branchesByRepo[repoId];
    }

    set({ branchesLoading: repoId });

    try {
      const response = await fetchWithHeaders(
        `${API_BASE_URL}/api/v1/github/repos/${repoId}/branches`,
      );
      if (!response.ok) throw new Error('Failed to fetch branches');
      const branches = await response.json();
      set({
        branchesByRepo: { ...get().branchesByRepo, [repoId]: branches },
        branchesLoading: null,
        lastFetched: { ...get().lastFetched, [cacheKey]: Date.now() },
      });
      return branches;
    } catch (_error) {
      set({ branchesLoading: null });
      return [];
    }
  },

  setError: (error) => set({ error }),

  reset: () => set(createInitialState()),
}));

export const resetGitHubStoreState = () => {
  useGitHubStore.setState(createInitialState());
};

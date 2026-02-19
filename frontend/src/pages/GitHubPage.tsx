import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import {
  Github,
  GitPullRequest,
  GitBranch,
  FolderGit,
  PlayCircle,
  Settings,
  Plus,
  RefreshCw,
  ExternalLink,
  X,
  Loader2,
  PauseCircle,
  Shield,
  Search,
  Package,
  Filter,
  CalendarClock,
  CheckCircle2,
  LinkIcon,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  AlertCircle,
} from 'lucide-react';
import type { GitHubRepo, GitHubScanResult } from '@/store/githubStore';
import { useGitHubStore } from '@/store/githubStore';
import {
  useGitHubStatus,
  useGitHubInstallations,
  useGitHubRepositories,
  useTriggerRules,
  useGitHubScanResults,
  useSetupInstallation,
  useToggleRepoScans,
  useSyncRepositories,
  useDeleteTriggerRule,
  useTriggerScan,
} from '@/hooks/queries/useGithubQueries';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { api } from '@/services/api';
import { ScanDetailPanel } from '@/components/scans/ScanDetailPanel';
import {
  STATUS_COLORS,
  STATUS_ICONS,
  SummaryBadges,
  formatRelativeTime,
  formatExactTime,
  getScanSourceMeta,
} from '@/components/scans/scan-utils';
import { cn } from '@/lib/utils';

interface WorkflowOption {
  id: string;
  name: string;
  description?: string;
}

interface WorkflowCompatibility {
  requiresPrContext: boolean;
  requiredRuntimeInputs: string[];
}

const PR_CONTEXT_RUNTIME_INPUT_IDS = new Set([
  'prnumber',
  'pullrequestnumber',
  'pull_request_number',
  'pr_number',
]);

function normalizeRuntimeInputId(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[\s-]/g, '').toLowerCase() : '';
}

function buildWorkflowCompatibility(runtimeInputs: unknown[]): WorkflowCompatibility {
  const requiredRuntimeInputs = runtimeInputs
    .map((input) => {
      if (!input || typeof input !== 'object') return null;
      const item = input as { id?: unknown; required?: unknown };
      const id = typeof item.id === 'string' ? item.id : null;
      if (!id) return null;
      const required = item.required !== false;
      return required ? id : null;
    })
    .filter((id): id is string => Boolean(id));

  const requiresPrContext = requiredRuntimeInputs.some((id) =>
    PR_CONTEXT_RUNTIME_INPUT_IDS.has(normalizeRuntimeInputId(id)),
  );

  return { requiresPrContext, requiredRuntimeInputs };
}

// STATUS_COLORS, STATUS_ICONS, formatRelativeTime, SummaryBadges imported from scan-utils

function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground mb-4 max-w-md">{description}</p>
      {action}
    </div>
  );
}

// Predefined quick scan workflow templates.
// `templateSlug` matches against system workflow template slugs to resolve to a real workflow UUID.
const QUICK_SCANS = [
  {
    slug: 'secret-detection',
    templateSlug: 'sys-secret-scan',
    name: 'Secret Detection',
    description: 'Scan for exposed secrets, API keys, and credentials',
    icon: Shield,
  },
  {
    slug: 'sast-opengrep',
    templateSlug: 'sys-sast-scan',
    name: 'SAST (OpenGrep)',
    description: 'Static Application Security Testing',
    icon: Search,
  },
  {
    slug: 'dependency-audit',
    templateSlug: 'sys-dependency-scan',
    name: 'Dependency Audit',
    description: 'Check dependencies for known vulnerabilities',
    icon: Package,
  },
];

/** Resolve a quick scan slug to a real workflow UUID by matching system workflow template slugs. */
function resolveQuickScans(
  systemWorkflows: { id: string; slug: string | null }[],
): { slug: string; workflowId: string; name: string; description: string; icon: typeof Shield }[] {
  return QUICK_SCANS.flatMap((scan) => {
    const match = systemWorkflows.find((sw) => sw.slug === scan.templateSlug);
    if (!match) return [];
    return [
      {
        slug: scan.slug,
        workflowId: match.id,
        name: scan.name,
        description: scan.description,
        icon: scan.icon,
      },
    ];
  });
}

interface WorkflowPickerModalProps {
  open: boolean;
  onClose: () => void;
  repository: GitHubRepo | null;
  onSuccess: () => void;
}

function WorkflowPickerModal({ open, onClose, repository, onSuccess }: WorkflowPickerModalProps) {
  const { mutate: triggerScan } = useTriggerScan();
  const { toast } = useToast();
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [workflowCompatibility, setWorkflowCompatibility] = useState<
    Record<string, WorkflowCompatibility>
  >({});
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>('');
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [triggering, setTriggering] = useState<string | null>(null);

  // Ensure system workflows are loaded
  useEffect(() => {
    if (open) fetchSystemWorkflows();
  }, [open, fetchSystemWorkflows]);

  // Fetch workflows when modal opens
  useEffect(() => {
    if (open) {
      setLoadingWorkflows(true);
      setWorkflowCompatibility({});
      setSelectedWorkflow('');
      setSelectedBranch(repository?.defaultBranch ?? 'main');
      api.workflows
        .list()
        .then(async (data) => {
          setWorkflows(
            data.map((w) => ({ id: w.id, name: w.name, description: w.description ?? undefined })),
          );

          const compatibilityEntries = await Promise.all(
            data.map(async (workflow) => {
              try {
                const response = await api.workflows.getRuntimeInputs(workflow.id);
                const compatibility = buildWorkflowCompatibility(response.inputs ?? []);
                return [workflow.id, compatibility] as const;
              } catch {
                return [
                  workflow.id,
                  { requiresPrContext: false, requiredRuntimeInputs: [] } as WorkflowCompatibility,
                ] as const;
              }
            }),
          );
          setWorkflowCompatibility(Object.fromEntries(compatibilityEntries));
        })
        .catch(() => {
          toast({
            title: 'Error',
            description: 'Failed to load workflows',
            variant: 'destructive',
          });
        })
        .finally(() => setLoadingWorkflows(false));
    }
  }, [open, repository, toast]);

  const selectedWorkflowCompatibility = selectedWorkflow
    ? (workflowCompatibility[selectedWorkflow] ?? null)
    : null;
  const selectedWorkflowRequiresPrContext =
    selectedWorkflowCompatibility?.requiresPrContext ?? false;

  const handleTrigger = (workflowId: string) => {
    if (!repository) return;
    const compatibility = workflowCompatibility[workflowId];
    if (compatibility?.requiresPrContext) {
      toast({
        title: 'PR context required',
        description:
          'This workflow expects PR runtime inputs. Use a PR trigger rule instead of a manual repository run.',
        variant: 'destructive',
      });
      return;
    }
    setTriggering(workflowId);
    triggerScan(
      { repoId: repository.id, workflowId, branch: selectedBranch || undefined },
      {
        onSuccess: () => {
          toast({
            title: 'Scan started',
            description: `Security scan started for ${repository.fullName}`,
          });
          onClose();
          onSuccess();
        },
        onError: (error) => {
          toast({
            title: 'Scan failed',
            description: error instanceof Error ? error.message : 'Failed to start scan',
            variant: 'destructive',
          });
        },
        onSettled: () => {
          setTriggering(null);
        },
      },
    );
  };

  if (!repository) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Run Security Scan</DialogTitle>
          <DialogDescription>
            Select a scan type for <strong>{repository.fullName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Branch Selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Branch</label>
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger>
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={repository.defaultBranch ?? 'main'}>
                  {repository.defaultBranch ?? 'main'} (default)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Quick Scans Section */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">Quick Scans</h4>
            <div className="grid gap-2">
              {resolveQuickScans(systemWorkflows).map((scan) => {
                const Icon = scan.icon;
                return (
                  <Button
                    key={scan.slug}
                    variant="outline"
                    className="justify-start h-auto py-3 px-4"
                    onClick={() => handleTrigger(scan.workflowId)}
                    disabled={triggering !== null}
                  >
                    {triggering === scan.workflowId ? (
                      <Loader2 className="h-5 w-5 mr-3 animate-spin" />
                    ) : (
                      <Icon className="h-5 w-5 mr-3 text-muted-foreground" />
                    )}
                    <div className="text-left">
                      <div className="font-medium">{scan.name}</div>
                      <div className="text-xs text-muted-foreground">{scan.description}</div>
                    </div>
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Custom Workflows Section */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">Custom Workflows</h4>
            {loadingWorkflows ? (
              <Skeleton className="h-10 w-full" />
            ) : workflows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No custom workflows available</p>
            ) : (
              <div className="flex gap-2">
                <Select value={selectedWorkflow} onValueChange={setSelectedWorkflow}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a workflow" />
                  </SelectTrigger>
                  <SelectContent>
                    {workflows.map((wf) => (
                      <SelectItem key={wf.id} value={wf.id}>
                        {wf.name}
                        {workflowCompatibility[wf.id]?.requiresPrContext
                          ? ' (Requires PR context)'
                          : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={() => selectedWorkflow && handleTrigger(selectedWorkflow)}
                  disabled={
                    !selectedWorkflow || triggering !== null || selectedWorkflowRequiresPrContext
                  }
                >
                  {triggering === selectedWorkflow ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlayCircle className="h-4 w-4" />
                  )}
                </Button>
              </div>
            )}
            {selectedWorkflowRequiresPrContext && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                This workflow requires PR context (for example `prNumber`) and cannot be triggered
                manually from this modal.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function parseInstallationId(input: string): number | null {
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

function NotConfiguredState({ installUrl }: { installUrl: string | null }) {
  const { toast } = useToast();
  const { mutateAsync: setupInstallation } = useSetupInstallation();
  const qc = useQueryClient();
  const [installationRef, setInstallationRef] = useState('');
  const [linking, setLinking] = useState(false);

  const handleLinkExistingInstallation = async () => {
    const installationId = parseInstallationId(installationRef);
    if (!installationId) {
      toast({
        title: 'Invalid installation reference',
        description: 'Paste a GitHub installation URL or a numeric installation ID.',
        variant: 'destructive',
      });
      return;
    }

    setLinking(true);
    try {
      await setupInstallation(installationId);
      qc.invalidateQueries({ queryKey: queryKeys.github.status() });
      setInstallationRef('');
      toast({
        title: 'GitHub linked',
        description: 'Existing GitHub installation connected and repositories synced.',
      });
    } catch (error) {
      toast({
        title: 'Failed to link installation',
        description:
          error instanceof Error ? error.message : 'Could not link the existing installation.',
        variant: 'destructive',
      });
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-6 mb-6">
        <Github className="h-12 w-12 text-muted-foreground" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Connect GitHub</h2>
      <p className="text-muted-foreground mb-6 max-w-lg">
        Install the ShipSec GitHub App to connect your repositories and enable automated security
        scans on pull requests.
      </p>
      {installUrl ? (
        <div className="w-full max-w-xl space-y-4">
          <Button asChild size="lg">
            <a href={installUrl} target="_blank" rel="noopener noreferrer">
              <Github className="mr-2 h-5 w-5" />
              Install GitHub App
            </a>
          </Button>

          <div className="rounded-lg border bg-card p-4 text-left">
            <p className="text-sm font-medium mb-2">Already installed?</p>
            <p className="text-sm text-muted-foreground mb-3">
              Paste the installation URL or ID from GitHub settings to link it here.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                value={installationRef}
                onChange={(e) => setInstallationRef(e.target.value)}
                placeholder="https://github.com/settings/installations/12345678"
                disabled={linking}
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleLinkExistingInstallation}
                disabled={linking || installationRef.trim().length === 0}
              >
                {linking ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Linking...
                  </>
                ) : (
                  'Link Existing Installation'
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          GitHub App is not configured. Please contact your administrator.
        </p>
      )}
    </div>
  );
}

interface RepositoriesTabProps {
  onRunScan: (repo: GitHubRepo) => void;
}

function RepositoriesTab({ onRunScan }: RepositoriesTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data: repositories = [],
    isLoading: loading,
    isError: reposError,
    error: reposErrorDetail,
    refetch: refetchRepos,
  } = useGitHubRepositories();
  const { mutateAsync: syncRepositories } = useSyncRepositories();
  const { mutateAsync: toggleRepoScans } = useToggleRepoScans();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [toggling, setToggling] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const searchQuery = searchParams.get('repoQ') ?? '';
  const scanFilterParam = searchParams.get('repoScans');
  const visibilityFilterParam = searchParams.get('repoVisibility');
  const ownerFilter = searchParams.get('repoOwner') ?? 'all';
  const languageFilter = searchParams.get('repoLanguage') ?? 'all';
  const sortColumnParam = searchParams.get('repoSort');
  const sortDirectionParam = searchParams.get('repoDir');
  const scanFilter =
    scanFilterParam === 'enabled' || scanFilterParam === 'disabled' ? scanFilterParam : 'all';
  const visibilityFilter =
    visibilityFilterParam === 'private' || visibilityFilterParam === 'public'
      ? visibilityFilterParam
      : 'all';
  const sortColumn: 'repository' | 'branch' | 'language' | 'scans' =
    sortColumnParam === 'branch' ||
    sortColumnParam === 'language' ||
    sortColumnParam === 'scans' ||
    sortColumnParam === 'repository'
      ? sortColumnParam
      : 'repository';
  const sortDirection: 'asc' | 'desc' = sortDirectionParam === 'desc' ? 'desc' : 'asc';

  const updateRepoParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    Object.entries(updates).forEach(([key, value]) => {
      if (!value || value === 'all') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    });
    setSearchParams(next, { replace: true });
  };

  const handleToggle = async (repo: GitHubRepo) => {
    setToggling(repo.id);
    try {
      await toggleRepoScans({ id: repo.id, enabled: !repo.scansEnabled });
      toast({
        title: repo.scansEnabled ? 'Scans disabled' : 'Scans enabled',
        description: `Scans ${repo.scansEnabled ? 'disabled' : 'enabled'} for ${repo.fullName}`,
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to update repository', variant: 'destructive' });
    } finally {
      setToggling(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await syncRepositories();
      toast({
        title: 'Repositories synced',
        description: `Synced ${result.synced} repositories from GitHub.`,
      });
    } catch {
      // Fall back to a force fetch of the last known backend state
      qc.invalidateQueries({ queryKey: queryKeys.github.repositories() });
      toast({
        title: 'Sync failed',
        description: 'Could not sync from GitHub. Showing last known repositories.',
        variant: 'destructive',
      });
    } finally {
      setRefreshing(false);
    }
  };

  const ownerOptions = useMemo(
    () =>
      Array.from(new Set(repositories.map((repo) => repo.owner))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [repositories],
  );
  const languageOptions = useMemo(
    () =>
      Array.from(
        new Set(repositories.map((repo) => repo.language).filter(Boolean) as string[]),
      ).sort((a, b) => a.localeCompare(b)),
    [repositories],
  );

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    scanFilter !== 'all' ||
    visibilityFilter !== 'all' ||
    ownerFilter !== 'all' ||
    languageFilter !== 'all';

  const filteredRepositories = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return repositories.filter((repo) => {
      if (scanFilter === 'enabled' && !repo.scansEnabled) return false;
      if (scanFilter === 'disabled' && repo.scansEnabled) return false;
      if (visibilityFilter === 'private' && !repo.isPrivate) return false;
      if (visibilityFilter === 'public' && repo.isPrivate) return false;
      if (ownerFilter !== 'all' && repo.owner !== ownerFilter) return false;
      if (languageFilter !== 'all' && repo.language !== languageFilter) return false;

      if (!normalizedSearch) return true;
      return (
        repo.fullName.toLowerCase().includes(normalizedSearch) ||
        (repo.description ?? '').toLowerCase().includes(normalizedSearch) ||
        repo.owner.toLowerCase().includes(normalizedSearch) ||
        (repo.language ?? '').toLowerCase().includes(normalizedSearch)
      );
    });
  }, [languageFilter, ownerFilter, repositories, scanFilter, searchQuery, visibilityFilter]);

  const sortedRepositories = useMemo(() => {
    const rows = [...filteredRepositories];
    rows.sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'repository':
          comparison = a.fullName.localeCompare(b.fullName);
          break;
        case 'branch':
          comparison = (a.defaultBranch ?? 'main').localeCompare(b.defaultBranch ?? 'main');
          break;
        case 'language':
          comparison = (a.language ?? '').localeCompare(b.language ?? '');
          break;
        case 'scans':
          comparison = Number(a.scansEnabled) - Number(b.scansEnabled);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return rows;
  }, [filteredRepositories, sortColumn, sortDirection]);

  const handleSort = (column: 'repository' | 'branch' | 'language' | 'scans') => {
    const next = new URLSearchParams(searchParams);
    if (sortColumn === column) {
      next.set('repoDir', sortDirection === 'asc' ? 'desc' : 'asc');
      setSearchParams(next, { replace: true });
      return;
    }
    next.set('repoSort', column);
    next.set('repoDir', column === 'scans' ? 'desc' : 'asc');
    setSearchParams(next, { replace: true });
  };

  const renderSortIcon = (column: 'repository' | 'branch' | 'language' | 'scans') => {
    if (sortColumn !== column)
      return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />;
    return sortDirection === 'asc' ? (
      <ArrowUp className="h-3.5 w-3.5 text-foreground" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-foreground" />
    );
  };

  const clearFilters = () => {
    updateRepoParams({
      repoQ: null,
      repoScans: null,
      repoVisibility: null,
      repoOwner: null,
      repoLanguage: null,
    });
  };

  if (loading && repositories.length === 0) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (reposError && repositories.length === 0) {
    return (
      <div className="text-center py-12 border rounded-lg bg-card border-destructive">
        <AlertCircle className="h-10 w-10 mx-auto mb-3 text-destructive" />
        <h3 className="text-lg font-semibold mb-2">Failed to load repositories</h3>
        <p className="text-muted-foreground mb-4">{reposErrorDetail?.message ?? 'Unknown error'}</p>
        <Button onClick={() => refetchRepos()} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  if (repositories.length === 0) {
    return (
      <EmptyState
        icon={FolderGit}
        title="No repositories connected"
        description="Install the GitHub App and select repositories to get started with security scanning."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {filteredRepositories.length} of {repositories.length}{' '}
          {repositories.length === 1 ? 'repository' : 'repositories'} connected
        </p>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Refresh
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full md:w-72">
            <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={searchQuery}
              onChange={(event) =>
                updateRepoParams({
                  repoQ: event.target.value.trim().length > 0 ? event.target.value : null,
                })
              }
              placeholder="Search repositories..."
              className="h-9 pl-9"
            />
          </div>

          <Select
            value={scanFilter}
            onValueChange={(value: 'all' | 'enabled' | 'disabled') =>
              updateRepoParams({ repoScans: value })
            }
          >
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All scans</SelectItem>
              <SelectItem value="enabled">Enabled scans</SelectItem>
              <SelectItem value="disabled">Disabled scans</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={visibilityFilter}
            onValueChange={(value: 'all' | 'private' | 'public') =>
              updateRepoParams({ repoVisibility: value })
            }
          >
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All visibility</SelectItem>
              <SelectItem value="private">Private</SelectItem>
              <SelectItem value="public">Public</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={ownerFilter}
            onValueChange={(value) => updateRepoParams({ repoOwner: value })}
          >
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {ownerOptions.map((owner) => (
                <SelectItem key={owner} value={owner}>
                  {owner}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={languageFilter}
            onValueChange={(value) => updateRepoParams({ repoLanguage: value })}
          >
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All languages</SelectItem>
              {languageOptions.map((language) => (
                <SelectItem key={language} value={language}>
                  {language}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
              <X className="h-3.5 w-3.5 mr-1" />
              Clear all
            </Button>
          )}
        </div>

        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2">
            {scanFilter !== 'all' && <Badge variant="secondary">Scans: {scanFilter}</Badge>}
            {visibilityFilter !== 'all' && (
              <Badge variant="secondary">Visibility: {visibilityFilter}</Badge>
            )}
            {ownerFilter !== 'all' && <Badge variant="secondary">Owner: {ownerFilter}</Badge>}
            {languageFilter !== 'all' && (
              <Badge variant="secondary">Language: {languageFilter}</Badge>
            )}
          </div>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              className="cursor-pointer select-none hover:bg-muted/50"
              onClick={() => handleSort('repository')}
            >
              <div className="flex items-center gap-1">
                Repository
                {renderSortIcon('repository')}
              </div>
            </TableHead>
            <TableHead
              className="cursor-pointer select-none hover:bg-muted/50"
              onClick={() => handleSort('branch')}
            >
              <div className="flex items-center gap-1">
                Branch
                {renderSortIcon('branch')}
              </div>
            </TableHead>
            <TableHead
              className="cursor-pointer select-none hover:bg-muted/50"
              onClick={() => handleSort('language')}
            >
              <div className="flex items-center gap-1">
                Language
                {renderSortIcon('language')}
              </div>
            </TableHead>
            <TableHead
              className="cursor-pointer select-none hover:bg-muted/50"
              onClick={() => handleSort('scans')}
            >
              <div className="flex items-center gap-1">
                Scans
                {renderSortIcon('scans')}
              </div>
            </TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedRepositories.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5}>
                <EmptyState
                  icon={FolderGit}
                  title="No matching repositories"
                  description="Try adjusting your search or filters."
                  action={
                    hasActiveFilters ? (
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                />
              </TableCell>
            </TableRow>
          ) : (
            sortedRepositories.map((repo) => (
              <TableRow key={repo.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {repo.isPrivate ? (
                      <Badge variant="secondary" className="text-xs">
                        Private
                      </Badge>
                    ) : null}
                    <a
                      href={repo.htmlUrl ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium hover:underline flex items-center gap-1"
                    >
                      {repo.fullName}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {repo.description && (
                    <p className="text-sm text-muted-foreground truncate max-w-md">
                      {repo.description}
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 text-sm">
                    <GitBranch className="h-3 w-3" />
                    {repo.defaultBranch ?? 'main'}
                  </div>
                </TableCell>
                <TableCell>
                  {repo.language ? (
                    <Badge variant="outline">{repo.language}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant={repo.scansEnabled ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => handleToggle(repo)}
                    disabled={toggling === repo.id}
                  >
                    {toggling === repo.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : repo.scansEnabled ? (
                      'Enabled'
                    ) : (
                      'Disabled'
                    )}
                  </Button>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRunScan(repo);
                    }}
                    disabled={!repo.scansEnabled}
                    title={!repo.scansEnabled ? 'Enable scans first to run a scan' : undefined}
                  >
                    <PlayCircle className="h-4 w-4 mr-1" />
                    Run Scan
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function TriggerRulesTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    data: triggerRules = [],
    isLoading: loading,
    isError: triggersError,
    error: triggersErrorDetail,
    refetch: refetchTriggers,
  } = useTriggerRules();
  const { data: repositories = [] } = useGitHubRepositories();
  const { mutateAsync: deleteTriggerRule } = useDeleteTriggerRule();
  const { toast } = useToast();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pendingDeleteRuleId, setPendingDeleteRuleId] = useState<string | null>(null);
  const [recentTriggers, setRecentTriggers] = useState<GitHubScanResult[]>([]);
  const [recentTriggersLoading, setRecentTriggersLoading] = useState(false);
  const [recentTriggersError, setRecentTriggersError] = useState<string | null>(null);
  const query = searchParams.get('trQ') ?? '';
  const statusFilterParam = searchParams.get('trStatus');
  const eventFilterParam = searchParams.get('trEvent');
  const selectedRuleId = searchParams.get('trRule');
  const recentTriggersQuery = searchParams.get('trRunsQ') ?? '';
  const highlightedRunId = searchParams.get('trScan');
  const statusFilter: 'all' | 'active' | 'disabled' =
    statusFilterParam === 'active' || statusFilterParam === 'disabled' ? statusFilterParam : 'all';
  const eventFilter: 'all' | 'pull_request' | 'push' | 'release' | 'repository_added' =
    eventFilterParam === 'pull_request' ||
    eventFilterParam === 'push' ||
    eventFilterParam === 'release' ||
    eventFilterParam === 'repository_added'
      ? eventFilterParam
      : 'all';

  const repoNameById = useMemo(
    () => new Map(repositories.map((repo) => [repo.id, repo.fullName])),
    [repositories],
  );

  const updateTriggerParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams);
      Object.entries(updates).forEach(([key, value]) => {
        if (!value || value === 'all') {
          next.delete(key);
        } else {
          next.set(key, value);
        }
      });
      if (next.toString() !== searchParams.toString()) {
        setSearchParams(next, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );

  const filteredRules = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    return triggerRules.filter((rule) => {
      if (statusFilter === 'active' && !rule.enabled) return false;
      if (statusFilter === 'disabled' && rule.enabled) return false;
      if (eventFilter !== 'all' && rule.event !== eventFilter) return false;

      if (!normalized) return true;
      return (
        rule.name.toLowerCase().includes(normalized) ||
        (rule.description ?? '').toLowerCase().includes(normalized) ||
        rule.repositoryPattern.toLowerCase().includes(normalized)
      );
    });
  }, [eventFilter, query, statusFilter, triggerRules]);

  useEffect(() => {
    if (filteredRules.length === 0) {
      updateTriggerParams({ trRule: null });
      return;
    }

    if (!selectedRuleId || !filteredRules.some((rule) => rule.id === selectedRuleId)) {
      updateTriggerParams({ trRule: filteredRules[0]!.id });
    }
  }, [filteredRules, selectedRuleId, updateTriggerParams]);

  const selectedRule = useMemo(
    () => triggerRules.find((rule) => rule.id === selectedRuleId) ?? null,
    [selectedRuleId, triggerRules],
  );

  useEffect(() => {
    if (!selectedRuleId) {
      setRecentTriggers([]);
      setRecentTriggersError(null);
      updateTriggerParams({ trRunsQ: null });
      return;
    }

    let cancelled = false;
    setRecentTriggersLoading(true);
    setRecentTriggersError(null);
    updateTriggerParams({ trRunsQ: null });

    import('@/services/api')
      .then(({ API_BASE_URL, getApiAuthHeaders }) =>
        getApiAuthHeaders().then((headers) => {
          const params = new URLSearchParams({ triggerRuleId: selectedRuleId, limit: '26' });
          return fetch(`${API_BASE_URL}/api/v1/github/scans?${params}`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
          });
        }),
      )
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load rule trigger history.');
        return res.json() as Promise<GitHubScanResult[]>;
      })
      .then((rows) => {
        if (cancelled) return;
        setRecentTriggers(rows.slice(0, 25));
      })
      .catch((error) => {
        if (cancelled) return;
        setRecentTriggersError(
          error instanceof Error ? error.message : 'Failed to load rule trigger history.',
        );
      })
      .finally(() => {
        if (cancelled) return;
        setRecentTriggersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRuleId, updateTriggerParams]);

  const pendingDeleteRule = useMemo(
    () => triggerRules.find((rule) => rule.id === pendingDeleteRuleId) ?? null,
    [pendingDeleteRuleId, triggerRules],
  );
  const filteredRecentTriggers = useMemo(() => {
    const normalized = recentTriggersQuery.trim().toLowerCase();
    if (!normalized) return recentTriggers;
    return recentTriggers.filter((scan) => {
      const source = getScanSourceMeta(scan);
      const repositoryName = (
        repoNameById.get(scan.repositoryId) ?? scan.repositoryId
      ).toLowerCase();
      return (
        repositoryName.includes(normalized) ||
        (scan.workflowName ?? '').toLowerCase().includes(normalized) ||
        scan.status.toLowerCase().includes(normalized) ||
        source.label.toLowerCase().includes(normalized) ||
        (source.detail ?? '').toLowerCase().includes(normalized)
      );
    });
  }, [recentTriggers, recentTriggersQuery, repoNameById]);

  useEffect(() => {
    if (!highlightedRunId || recentTriggersLoading) return;
    if (!filteredRecentTriggers.some((scan) => scan.id === highlightedRunId)) return;

    const row = document.getElementById(`trigger-run-${highlightedRunId}`);
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [filteredRecentTriggers, highlightedRunId, recentTriggersLoading]);

  const requestDeleteRule = (id: string) => {
    setPendingDeleteRuleId(id);
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await deleteTriggerRule(id);
      toast({ title: 'Rule deleted', description: 'Trigger rule has been deleted.' });
      if (selectedRuleId === id) {
        updateTriggerParams({ trRule: null, trRunsQ: null });
      }
      setPendingDeleteRuleId(null);
    } catch {
      toast({ title: 'Error', description: 'Failed to delete rule', variant: 'destructive' });
    } finally {
      setDeleting(null);
    }
  };

  if (loading && triggerRules.length === 0) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <div className="grid gap-4 xl:grid-cols-[360px,minmax(0,1fr)]">
          <Skeleton className="h-[420px] w-full" />
          <Skeleton className="h-[420px] w-full" />
        </div>
      </div>
    );
  }

  if (triggersError && triggerRules.length === 0) {
    return (
      <div className="text-center py-12 border rounded-lg bg-card border-destructive">
        <AlertCircle className="h-10 w-10 mx-auto mb-3 text-destructive" />
        <h3 className="text-lg font-semibold mb-2">Failed to load trigger rules</h3>
        <p className="text-muted-foreground mb-4">
          {triggersErrorDetail?.message ?? 'Unknown error'}
        </p>
        <Button onClick={() => refetchTriggers()} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  if (triggerRules.length === 0) {
    return (
      <EmptyState
        icon={GitPullRequest}
        title="No trigger rules"
        description="Create trigger rules to automatically run security scans when pull requests are opened, code is pushed, or new repositories are added."
        action={
          <Button onClick={() => navigate('/github/triggers/new')}>
            <Plus className="h-4 w-4 mr-2" />
            Create Trigger Rule
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {triggerRules.length} {triggerRules.length === 1 ? 'rule' : 'rules'} configured
          </p>
          <p className="text-xs text-muted-foreground">
            Select a rule to inspect recent trigger executions.
          </p>
        </div>
        <Button onClick={() => navigate('/github/triggers/new')}>
          <Plus className="h-4 w-4 mr-2" />
          New Rule
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full md:w-72">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) =>
              updateTriggerParams({
                trQ: event.target.value.trim().length > 0 ? event.target.value : null,
              })
            }
            placeholder="Search rules by name, description, repository..."
            className="pl-9 h-9"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value: 'all' | 'active' | 'disabled') =>
            updateTriggerParams({ trStatus: value })
          }
        >
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={eventFilter}
          onValueChange={(
            value: 'all' | 'pull_request' | 'push' | 'release' | 'repository_added',
          ) => updateTriggerParams({ trEvent: value })}
        >
          <SelectTrigger className="h-9 w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            <SelectItem value="pull_request">Pull request</SelectItem>
            <SelectItem value="push">Push</SelectItem>
            <SelectItem value="repository_added">Repository added</SelectItem>
            <SelectItem value="release">Release</SelectItem>
          </SelectContent>
        </Select>
        {(query || statusFilter !== 'all' || eventFilter !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => updateTriggerParams({ trQ: null, trStatus: null, trEvent: null })}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Clear
          </Button>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[360px,minmax(0,1fr)]">
        <Card className="xl:max-h-[calc(100vh-270px)] xl:overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rules</CardTitle>
            <CardDescription>
              {filteredRules.length} matching {filteredRules.length === 1 ? 'rule' : 'rules'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 xl:overflow-y-auto">
            {filteredRules.length === 0 ? (
              <EmptyState
                icon={GitPullRequest}
                title="No matching rules"
                description="Try adjusting your search or filters."
              />
            ) : (
              filteredRules.map((rule) => (
                <div
                  key={rule.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => updateTriggerParams({ trRule: rule.id, trScan: null })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      updateTriggerParams({ trRule: rule.id, trScan: null });
                    }
                  }}
                  className={cn(
                    'rounded-md border p-3 cursor-pointer transition-colors',
                    selectedRuleId === rule.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50 border-border',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{rule.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {rule.description || 'No description'}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/github/triggers/${rule.id}`);
                        }}
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={(event) => {
                          event.stopPropagation();
                          requestDeleteRule(rule.id);
                        }}
                        disabled={deleting === rule.id}
                        title="Delete trigger rule"
                        aria-label={`Delete trigger rule ${rule.name}`}
                      >
                        {deleting === rule.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                      {rule.enabled ? 'Active' : 'Disabled'}
                    </Badge>
                    <Badge variant="outline">{rule.event.replace('_', ' ')}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Repo: <code className="bg-muted px-1 rounded">{rule.repositoryPattern}</code>
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          {selectedRule ? (
            <>
              <CardHeader className="pb-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                      {selectedRule.name}
                      <Badge variant={selectedRule.enabled ? 'default' : 'secondary'}>
                        {selectedRule.enabled ? 'Active' : 'Disabled'}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      {selectedRule.description || 'No description'}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/github/triggers/${selectedRule.id}`)}
                    >
                      <Settings className="h-4 w-4 mr-1.5" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => requestDeleteRule(selectedRule.id)}
                      disabled={deleting === selectedRule.id}
                    >
                      {deleting === selectedRule.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <X className="h-4 w-4 mr-1.5" />
                          Delete
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 md:grid-cols-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Repository:</span>{' '}
                    <code className="bg-muted px-1 rounded">{selectedRule.repositoryPattern}</code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Event:</span>{' '}
                    <Badge variant="outline">{selectedRule.event}</Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Actions:</span>{' '}
                    {selectedRule.actions.length > 0 ? (
                      selectedRule.actions.map((action) => (
                        <Badge key={action} variant="outline" className="ml-1">
                          {action}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-muted-foreground">Any</span>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Branches:</span>{' '}
                    {selectedRule.branches.length > 0 ? (
                      selectedRule.branches.map((branch) => (
                        <code key={branch} className="bg-muted px-1 rounded ml-1">
                          {branch}
                        </code>
                      ))
                    ) : (
                      <span className="text-muted-foreground">All</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h4 className="text-sm font-semibold">Recent Triggers</h4>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative sm:w-72">
                      <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <Input
                        value={recentTriggersQuery}
                        onChange={(event) =>
                          updateTriggerParams({
                            trRunsQ:
                              event.target.value.trim().length > 0 ? event.target.value : null,
                          })
                        }
                        placeholder="Search runs for this rule..."
                        className="h-8 pl-8"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/github/scans?triggerRuleId=${selectedRule.id}`)}
                    >
                      View all in Scans
                    </Button>
                  </div>
                </div>

                {recentTriggersLoading ? (
                  <div className="space-y-2">
                    {[...Array(4)].map((_, index) => (
                      <Skeleton key={index} className="h-10 w-full" />
                    ))}
                  </div>
                ) : recentTriggersError ? (
                  <p className="text-sm text-destructive">{recentTriggersError}</p>
                ) : filteredRecentTriggers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {recentTriggers.length === 0
                      ? 'No runs found for this rule yet.'
                      : 'No runs match your search.'}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Repository</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Findings</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRecentTriggers.map((scan) => {
                        const source = getScanSourceMeta(scan);
                        return (
                          <TableRow
                            key={scan.id}
                            id={`trigger-run-${scan.id}`}
                            className={cn(highlightedRunId === scan.id && 'bg-primary/10')}
                          >
                            <TableCell
                              className="text-muted-foreground"
                              title={formatExactTime(scan.createdAt)}
                            >
                              {formatRelativeTime(scan.createdAt)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div
                                  className={`p-1 rounded-full ${STATUS_COLORS[scan.status]} text-white`}
                                >
                                  {STATUS_ICONS[scan.status]}
                                </div>
                                <span className="capitalize">{scan.status}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              {repoNameById.get(scan.repositoryId) ?? scan.repositoryId}
                            </TableCell>
                            <TableCell>
                              {source.label}
                              {source.detail ? ` ${source.detail}` : ''}
                            </TableCell>
                            <TableCell>
                              <SummaryBadges summary={scan.summary} />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button asChild variant="ghost" size="sm">
                                  <Link to={`/runs/${scan.workflowRunId}`}>
                                    Run
                                    <ExternalLink className="h-3 w-3 ml-1" />
                                  </Link>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => navigate(`/github/scans?scan=${scan.id}`)}
                                >
                                  Scan
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </>
          ) : (
            <CardContent className="py-16">
              <EmptyState
                icon={GitPullRequest}
                title="Select a trigger rule"
                description="Pick a rule from the left to view recent trigger runs."
              />
            </CardContent>
          )}
        </Card>
      </div>

      <Dialog
        open={Boolean(pendingDeleteRule)}
        onOpenChange={(open) => {
          if (!open && !deleting) {
            setPendingDeleteRuleId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete trigger rule?</DialogTitle>
            <DialogDescription>
              {pendingDeleteRule ? (
                <>
                  This will disable automation for <strong>{pendingDeleteRule.name}</strong>. Scan
                  history and run data will be preserved.
                </>
              ) : (
                'This will disable automation for this trigger rule.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingDeleteRuleId(null)}
              disabled={Boolean(deleting)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingDeleteRule && handleDelete(pendingDeleteRule.id)}
              disabled={!pendingDeleteRule || Boolean(deleting)}
            >
              {deleting === pendingDeleteRule?.id ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <X className="h-4 w-4 mr-1.5" />
              )}
              Delete Rule
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Status options for filtering
const SCAN_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'running', label: 'Running' },
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failure' },
  { value: 'error', label: 'Error' },
];

const SCAN_STATUS_LABELS = new Map(
  SCAN_STATUS_OPTIONS.map((option) => [option.value, option.label]),
);
const SCAN_STATUS_VALUES = new Set(SCAN_STATUS_OPTIONS.map((option) => option.value));
const SCAN_SOURCE_OPTIONS = [
  { value: 'all', label: 'All Sources' },
  { value: 'pr', label: 'Pull Request' },
  { value: 'push', label: 'Push' },
  { value: 'manual', label: 'Manual' },
  { value: 'schedule', label: 'Scheduled' },
] as const;
const SCAN_SOURCE_LABELS = new Map(
  SCAN_SOURCE_OPTIONS.filter((option) => option.value !== 'all').map((option) => [
    option.value,
    option.label,
  ]),
);

function parseStatusFilters(statusParam: string): string[] {
  return statusParam
    .split(',')
    .map((status) => status.trim())
    .filter((status) => SCAN_STATUS_VALUES.has(status));
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < breakpoint : false,
  );
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [breakpoint]);
  return isMobile;
}

type SortColumn = 'time' | 'status' | 'repository' | 'source' | 'workflow' | 'findings';
type SortDirection = 'asc' | 'desc';

function SortableHeader({
  column,
  label,
  currentSort,
  currentDir,
  onSort,
  className,
}: {
  column: SortColumn;
  label: string;
  currentSort: SortColumn;
  currentDir: SortDirection;
  onSort: (col: SortColumn) => void;
  className?: string;
}) {
  const isActive = currentSort === column;
  const Icon = isActive ? (currentDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      className={cn('cursor-pointer select-none hover:bg-muted/50', className)}
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-1">
        {label}
        <Icon
          className={cn('h-3.5 w-3.5', isActive ? 'text-foreground' : 'text-muted-foreground/50')}
        />
      </div>
    </TableHead>
  );
}

function ScansTab() {
  const SCAN_PAGE_SIZE = 25;
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: repositories = [] } = useGitHubRepositories();
  const { data: triggerRules = [] } = useTriggerRules();
  const isMobile = useIsMobile();
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);

  // Read URL state for split-view
  const selectedScanId = searchParams.get('scan') || null;
  const highlightedFindingId = searchParams.get('finding') || undefined;

  // Get filter values from URL search params
  const repositoryFilter = searchParams.get('repository') || '';
  const statusFilterParam = searchParams.get('status') || '';
  const sourceFilterParam = searchParams.get('source') || '';
  const sourceFilter =
    sourceFilterParam === 'pr' ||
    sourceFilterParam === 'push' ||
    sourceFilterParam === 'manual' ||
    sourceFilterParam === 'schedule'
      ? sourceFilterParam
      : '';
  const scheduleIdFilter = searchParams.get('scheduleId') || '';
  const triggerRuleIdFilter = searchParams.get('triggerRuleId') || '';
  const scansSortParam = searchParams.get('scansSort');
  const scansDirParam = searchParams.get('scansDir');
  const statusFilters = parseStatusFilters(statusFilterParam);
  const statusFilterValue = statusFilters.join(',');
  const pageParam = Number(searchParams.get('page') || '1');
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const offset = (page - 1) * SCAN_PAGE_SIZE;
  const sortColumn: SortColumn =
    scansSortParam === 'status' ||
    scansSortParam === 'repository' ||
    scansSortParam === 'source' ||
    scansSortParam === 'workflow' ||
    scansSortParam === 'findings' ||
    scansSortParam === 'time'
      ? scansSortParam
      : 'time';
  const sortDirection: SortDirection =
    scansDirParam === 'asc' || scansDirParam === 'desc'
      ? scansDirParam
      : sortColumn === 'time'
        ? 'desc'
        : 'asc';

  const {
    data: scanResultsData,
    isLoading: loading,
    isError: scansError,
    error: scansErrorDetail,
    refetch: refetchScans,
  } = useGitHubScanResults({
    limit: SCAN_PAGE_SIZE,
    offset,
    repositoryId: repositoryFilter || undefined,
    status: statusFilterValue || undefined,
    source: (sourceFilter as 'pr' | 'push' | 'manual' | 'schedule') || undefined,
    scheduleId: scheduleIdFilter || undefined,
    triggerRuleId: triggerRuleIdFilter || undefined,
  });
  const scanResults = scanResultsData?.data ?? [];
  const hasMore = scanResultsData?.hasMore ?? false;

  const getRepoName = (repoId: string) => {
    const repo = repositories.find((r) => r.id === repoId);
    return repo?.fullName ?? 'Unknown';
  };
  const triggerRuleNameById = useMemo(
    () => new Map(triggerRules.map((rule) => [rule.id, rule.name])),
    [triggerRules],
  );

  const handleSort = (column: SortColumn) => {
    const next = new URLSearchParams(searchParams);
    if (sortColumn === column) {
      next.set('scansDir', sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      next.set('scansSort', column);
      next.set('scansDir', column === 'time' ? 'desc' : 'asc');
    }
    setSearchParams(next, { replace: true });
  };

  const sortedScans = useMemo(() => {
    const STATUS_RANK: Record<string, number> = {
      error: 0,
      failure: 1,
      running: 2,
      pending: 3,
      success: 4,
    };
    const compare = (a: GitHubScanResult, b: GitHubScanResult): number => {
      let cmp = 0;
      switch (sortColumn) {
        case 'time':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'status':
          cmp = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
          break;
        case 'repository':
          cmp = getRepoName(a.repositoryId).localeCompare(getRepoName(b.repositoryId));
          break;
        case 'source':
          cmp = getScanSourceMeta(a).kind.localeCompare(getScanSourceMeta(b).kind);
          break;
        case 'workflow':
          cmp = (a.workflowName ?? '').localeCompare(b.workflowName ?? '');
          break;
        case 'findings':
          cmp = a.findingsCount - b.findingsCount;
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    };
    return [...scanResults].sort(compare);
  }, [scanResults, sortColumn, sortDirection, repositories]);

  // URL param handlers
  const handleSelectScan = (scanId: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('scan', scanId);
    newParams.delete('detail');
    newParams.delete('finding');
    setSearchParams(newParams, { replace: true });
  };

  const handleCloseScan = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('scan');
    newParams.delete('finding');
    setSearchParams(newParams, { replace: true });
  };

  const handleFindingSelect = (findingId: string | null) => {
    const newParams = new URLSearchParams(searchParams);
    if (findingId) {
      newParams.set('finding', findingId);
    } else {
      newParams.delete('finding');
    }
    setSearchParams(newParams, { replace: true });
  };

  const handleRepositoryChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value && value !== 'all') {
      newParams.set('repository', value);
    } else {
      newParams.delete('repository');
    }
    newParams.delete('page');
    setSearchParams(newParams);
  };

  const handleStatusToggle = (value: string) => {
    const currentParams = new URLSearchParams(
      typeof window !== 'undefined' ? window.location.search : searchParams.toString(),
    );
    const currentStatuses = parseStatusFilters(currentParams.get('status') || '');
    const nextStatuses = currentStatuses.includes(value)
      ? currentStatuses.filter((status) => status !== value)
      : [...currentStatuses, value];
    const normalized = SCAN_STATUS_OPTIONS.map((option) => option.value).filter((status) =>
      nextStatuses.includes(status),
    );

    if (normalized.length > 0) {
      currentParams.set('status', normalized.join(','));
    } else {
      currentParams.delete('status');
    }
    currentParams.delete('page');
    setSearchParams(currentParams);
  };

  const handleSourceChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value && value !== 'all') {
      newParams.set('source', value);
    } else {
      newParams.delete('source');
      newParams.delete('scheduleId');
    }
    if (value !== 'schedule') {
      newParams.delete('scheduleId');
    }
    newParams.delete('page');
    setSearchParams(newParams);
  };

  const handleTriggerRuleChange = (value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value && value !== 'all') {
      newParams.set('triggerRuleId', value);
    } else {
      newParams.delete('triggerRuleId');
    }
    newParams.delete('page');
    setSearchParams(newParams);
  };

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: queryKeys.github.scans() });
  };

  const handleCopyViewLink = useCallback(async () => {
    const query = searchParams.toString();
    const relativeUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
    const absoluteUrl = `${window.location.origin}${relativeUrl}`;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absoluteUrl);
        toast({
          title: 'View link copied',
          description: 'Share this link to open the same filtered scans view.',
        });
        return;
      }
      throw new Error('Clipboard API unavailable');
    } catch {
      toast({
        title: 'Unable to copy link automatically',
        description: 'Copy the URL from the browser address bar.',
        variant: 'destructive',
      });
    }
  }, [searchParams, toast]);

  const handlePageChange = (nextPage: number) => {
    const newParams = new URLSearchParams(searchParams);
    if (nextPage <= 1) {
      newParams.delete('page');
    } else {
      newParams.set('page', String(nextPage));
    }
    setSearchParams(newParams);
  };

  const hasActiveFilters =
    repositoryFilter ||
    statusFilters.length > 0 ||
    sourceFilter ||
    scheduleIdFilter ||
    triggerRuleIdFilter;
  const activeFilterLabelParts: string[] = [];
  if (repositoryFilter) {
    activeFilterLabelParts.push(getRepoName(repositoryFilter));
  }
  if (statusFilters.length > 0) {
    const statusLabels = statusFilters.map((status) => SCAN_STATUS_LABELS.get(status) ?? status);
    activeFilterLabelParts.push(statusLabels.join(', '));
  }
  if (sourceFilter) {
    activeFilterLabelParts.push(`Source: ${SCAN_SOURCE_LABELS.get(sourceFilter) ?? sourceFilter}`);
  }
  if (scheduleIdFilter) {
    activeFilterLabelParts.push(`Schedule: ${scheduleIdFilter}`);
  }
  if (triggerRuleIdFilter) {
    activeFilterLabelParts.push(
      `Rule: ${triggerRuleNameById.get(triggerRuleIdFilter) ?? triggerRuleIdFilter}`,
    );
  }
  const activeFilterLabel = activeFilterLabelParts.join(' | ');
  const statusFilterTriggerLabel =
    statusFilters.length === 0
      ? 'All Statuses'
      : statusFilters.length === 1
        ? (SCAN_STATUS_LABELS.get(statusFilters[0]) ?? statusFilters[0])
        : `${statusFilters.length} statuses`;
  const isPanelOpen = !!selectedScanId;
  const showList = !isPanelOpen || !isMobile;
  const showPanel = isPanelOpen;
  const liveScans = sortedScans.filter(
    (scan) => scan.status === 'running' || scan.status === 'pending',
  );
  const historyScans =
    liveScans.length > 0
      ? sortedScans.filter((scan) => scan.status !== 'running' && scan.status !== 'pending')
      : sortedScans;

  const handleStopRun = async (scan: GitHubScanResult) => {
    if (stoppingRunId) return;
    setStoppingRunId(scan.workflowRunId);
    try {
      await api.executions.cancel(scan.workflowRunId);
      toast({
        title: 'Run stop requested',
        description: `Run ${scan.workflowRunId} was requested to stop.`,
      });
      handleRefresh();
    } catch (error) {
      toast({
        title: 'Failed to stop run',
        description: error instanceof Error ? error.message : 'Unable to stop run',
        variant: 'destructive',
      });
    } finally {
      setStoppingRunId(null);
    }
  };

  if (loading && scanResults.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-40" />
        </div>
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (scansError && scanResults.length === 0) {
    return (
      <div className="text-center py-12 border rounded-lg bg-card border-destructive">
        <AlertCircle className="h-10 w-10 mx-auto mb-3 text-destructive" />
        <h3 className="text-lg font-semibold mb-2">Failed to load scan results</h3>
        <p className="text-muted-foreground mb-4">{scansErrorDetail?.message ?? 'Unknown error'}</p>
        <Button onClick={() => refetchScans()} variant="outline">
          <RefreshCw className="h-4 w-4 mr-2" />
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn('flex', isPanelOpen && 'border rounded-lg overflow-hidden')}
      style={{
        height: isPanelOpen ? 'calc(100vh - 300px)' : 'auto',
        minHeight: isPanelOpen ? '400px' : undefined,
      }}
    >
      {/* ── Scan List (Left Side) ────────────────────────────── */}
      {showList && (
        <div
          className={cn(
            'flex flex-col overflow-hidden transition-all duration-200',
            isPanelOpen ? 'w-[420px] flex-shrink-0 border-r' : 'w-full',
          )}
        >
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-3 p-3 border-b flex-shrink-0">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Filters:</span>
            </div>

            <Select value={repositoryFilter || 'all'} onValueChange={handleRepositoryChange}>
              <SelectTrigger className={cn(isPanelOpen ? 'w-[140px]' : 'w-[200px]', 'h-8 text-xs')}>
                <SelectValue placeholder="All Repos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Repositories</SelectItem>
                {repositories.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    isPanelOpen ? 'w-[140px]' : 'w-[200px]',
                    'h-8 text-xs font-normal justify-between',
                  )}
                >
                  <span className="truncate">{statusFilterTriggerLabel}</span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[220px]">
                {SCAN_STATUS_OPTIONS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={statusFilters.includes(option.value)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => handleStatusToggle(option.value)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Select value={sourceFilter || 'all'} onValueChange={handleSourceChange}>
              <SelectTrigger className={cn(isPanelOpen ? 'w-[140px]' : 'w-[180px]', 'h-8 text-xs')}>
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent>
                {SCAN_SOURCE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={triggerRuleIdFilter || 'all'} onValueChange={handleTriggerRuleChange}>
              <SelectTrigger className={cn(isPanelOpen ? 'w-[170px]' : 'w-[220px]', 'h-8 text-xs')}>
                <SelectValue placeholder="All Rules" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Rules</SelectItem>
                {triggerRules.map((rule) => (
                  <SelectItem key={rule.id} value={rule.id}>
                    {rule.name}
                  </SelectItem>
                ))}
                {triggerRuleIdFilter && !triggerRuleNameById.has(triggerRuleIdFilter) && (
                  <SelectItem value={triggerRuleIdFilter}>
                    Rule {triggerRuleIdFilter} (deleted)
                  </SelectItem>
                )}
              </SelectContent>
            </Select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const newParams = new URLSearchParams();
                  const tab = searchParams.get('tab');
                  if (tab) newParams.set('tab', tab);
                  if (selectedScanId) newParams.set('scan', selectedScanId);
                  setSearchParams(newParams);
                }}
                className="text-muted-foreground h-8 text-xs px-2"
              >
                <X className="h-3 w-3 mr-1" />
                Clear
              </Button>
            )}

            <div className="flex-1 flex justify-end">
              <Button variant="outline" size="sm" onClick={handleRefresh} className="h-8 text-xs">
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
                Refresh
              </Button>
            </div>
          </div>

          {/* Results count */}
          <div className="px-3 py-2 flex-shrink-0 flex items-center gap-1.5">
            <p className="text-xs text-muted-foreground">
              {scanResults.length} {scanResults.length === 1 ? 'scan' : 'scans'}
              {hasActiveFilters ? ` (${activeFilterLabel})` : ''}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-foreground"
              onClick={handleCopyViewLink}
              title="Copy link to current view"
              aria-label="Copy link to current view"
            >
              <LinkIcon className="h-3 w-3" />
            </Button>
          </div>

          {/* Scan list */}
          <div className="flex-1 overflow-y-auto">
            {scanResults.length === 0 ? (
              <EmptyState
                icon={PlayCircle}
                title={hasActiveFilters ? 'No matching scans' : 'No scans yet'}
                description={
                  hasActiveFilters
                    ? 'Try adjusting your filters or clear them to see all scans.'
                    : 'Run a manual scan or set up trigger rules to start seeing scan results here.'
                }
                action={
                  hasActiveFilters ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        const newParams = new URLSearchParams();
                        const tab = searchParams.get('tab');
                        if (tab) newParams.set('tab', tab);
                        setSearchParams(newParams);
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                {liveScans.length > 0 && (
                  <div className="border-b bg-muted/20">
                    <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Live scans ({liveScans.length})
                    </div>
                    <div className="divide-y">
                      {liveScans.map((scan) => {
                        const source = getScanSourceMeta(scan);
                        return (
                          <div key={`live-${scan.id}`} className="px-3 py-3">
                            <div className="flex items-center gap-2 mb-1">
                              <div
                                className={`p-0.5 rounded-full ${STATUS_COLORS[scan.status]} text-white`}
                              >
                                {STATUS_ICONS[scan.status]}
                              </div>
                              <span className="text-sm font-medium truncate">
                                {getRepoName(scan.repositoryId)}
                              </span>
                              <Badge variant="outline" className="h-5 text-[10px] capitalize">
                                {source.label}
                                {source.detail ? ` ${source.detail}` : ''}
                              </Badge>
                              <span
                                className="text-xs text-muted-foreground ml-auto flex-shrink-0"
                                title={formatExactTime(scan.createdAt)}
                              >
                                {formatRelativeTime(scan.createdAt)}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground truncate">
                              {scan.workflowName ?? 'Workflow run'}
                            </div>
                            <div className="mt-2 flex gap-2">
                              <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                                <Link to={`/runs/${scan.workflowRunId}`}>Open Run</Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                disabled={stoppingRunId === scan.workflowRunId}
                                onClick={() => handleStopRun(scan)}
                              >
                                {stoppingRunId === scan.workflowRunId ? (
                                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                ) : (
                                  <PauseCircle className="h-3.5 w-3.5 mr-1" />
                                )}
                                Stop
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {isPanelOpen ? (
                  /* Compact card list when panel is open */
                  <div className="divide-y">
                    {historyScans.map((scan) => {
                      const source = getScanSourceMeta(scan);
                      return (
                        <button
                          key={scan.id}
                          onClick={() => handleSelectScan(scan.id)}
                          className={cn(
                            'w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors',
                            selectedScanId === scan.id && 'bg-accent',
                          )}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div
                              className={`p-0.5 rounded-full ${STATUS_COLORS[scan.status]} text-white`}
                            >
                              {STATUS_ICONS[scan.status]}
                            </div>
                            <span className="text-sm font-medium truncate">
                              {getRepoName(scan.repositoryId)}
                            </span>
                            <span
                              className="text-xs text-muted-foreground ml-auto flex-shrink-0"
                              title={formatExactTime(scan.createdAt)}
                            >
                              {formatRelativeTime(scan.createdAt)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              {source.kind === 'pr' ? (
                                <>
                                  <GitPullRequest className="h-3 w-3" />
                                  <span>
                                    {source.label + (source.detail ? ` ${source.detail}` : '')}
                                  </span>
                                </>
                              ) : source.kind === 'push' ? (
                                <>
                                  <GitBranch className="h-3 w-3" />
                                  <span className="truncate max-w-[100px]">
                                    {source.detail ?? source.label}
                                  </span>
                                </>
                              ) : source.kind === 'schedule' ? (
                                <>
                                  <CalendarClock className="h-3 w-3" />
                                  <span className="truncate max-w-[120px]">
                                    {source.detail ?? source.label}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <PlayCircle className="h-3 w-3" />
                                  <span>{source.label}</span>
                                </>
                              )}
                            </div>
                            <div className="ml-auto">
                              <SummaryBadges summary={scan.summary} />
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  /* Full table when no panel */
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableHeader
                          column="time"
                          label="Time"
                          currentSort={sortColumn}
                          currentDir={sortDirection}
                          onSort={handleSort}
                        />
                        <SortableHeader
                          column="status"
                          label="Status"
                          currentSort={sortColumn}
                          currentDir={sortDirection}
                          onSort={handleSort}
                        />
                        <SortableHeader
                          column="repository"
                          label="Repository"
                          currentSort={sortColumn}
                          currentDir={sortDirection}
                          onSort={handleSort}
                        />
                        <SortableHeader
                          column="source"
                          label="Source"
                          currentSort={sortColumn}
                          currentDir={sortDirection}
                          onSort={handleSort}
                        />
                        <SortableHeader
                          column="workflow"
                          label="Workflow"
                          currentSort={sortColumn}
                          currentDir={sortDirection}
                          onSort={handleSort}
                        />
                        <SortableHeader
                          column="findings"
                          label="Findings"
                          currentSort={sortColumn}
                          currentDir={sortDirection}
                          onSort={handleSort}
                        />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyScans.map((scan, idx) => {
                        const source = getScanSourceMeta(scan);
                        const sourceFilterParams = new URLSearchParams({
                          source: 'schedule',
                        });
                        if (source.scheduleId) {
                          sourceFilterParams.set('scheduleId', source.scheduleId);
                        }
                        const scheduleScanLink = `/github/scans?${sourceFilterParams.toString()}`;
                        return (
                          <TableRow
                            key={scan.id}
                            className={cn(
                              'cursor-pointer hover:bg-muted/60',
                              idx % 2 === 1 && 'bg-muted/40',
                            )}
                            onClick={() => handleSelectScan(scan.id)}
                          >
                            <TableCell
                              className="text-muted-foreground"
                              title={formatExactTime(scan.createdAt)}
                            >
                              {formatRelativeTime(scan.createdAt)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div
                                  className={`p-1 rounded-full ${STATUS_COLORS[scan.status]} text-white`}
                                >
                                  {STATUS_ICONS[scan.status]}
                                </div>
                                <span className="capitalize">{scan.status}</span>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">
                              {getRepoName(scan.repositoryId)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                {source.kind === 'pr' ? (
                                  <>
                                    <GitPullRequest className="h-4 w-4" />
                                    {source.label}
                                    {source.detail ? ` ${source.detail}` : ''}
                                  </>
                                ) : source.kind === 'push' ? (
                                  <>
                                    <GitBranch className="h-4 w-4" />
                                    {source.detail ?? source.label}
                                  </>
                                ) : source.kind === 'schedule' ? (
                                  <Link
                                    to={scheduleScanLink}
                                    className="inline-flex items-center gap-1 hover:underline"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <CalendarClock className="h-4 w-4" />
                                    {source.detail ?? source.label}
                                  </Link>
                                ) : (
                                  <>
                                    <PlayCircle className="h-4 w-4" />
                                    {source.label}
                                  </>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              {scan.workflowName ? (
                                <div className="flex items-center gap-1.5">
                                  <Link
                                    to={`/runs/${scan.workflowRunId}`}
                                    className="hover:underline text-sm flex items-center gap-1"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {scan.workflowName}
                                    <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                  </Link>
                                  {scan.workflowVersion != null && (
                                    <span className="text-xs text-muted-foreground">
                                      v{scan.workflowVersion}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <SummaryBadges summary={scan.summary} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </>
            )}
          </div>

          <div className="border-t px-3 py-2 flex items-center justify-between gap-2 flex-shrink-0">
            <p className="text-xs text-muted-foreground">Page {page}</p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={page <= 1 || loading}
                onClick={() => handlePageChange(page - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={!hasMore || loading}
                onClick={() => handlePageChange(page + 1)}
              >
                Next
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detail Panel (Right Side) ────────────────────────── */}
      {showPanel && (
        <div className="flex-1 min-w-0 overflow-hidden bg-background">
          <ScanDetailPanel
            scanId={selectedScanId!}
            highlightedFindingId={highlightedFindingId}
            onClose={handleCloseScan}
            onFindingSelect={handleFindingSelect}
            isMobile={isMobile}
          />
        </div>
      )}
    </div>
  );
}

function ConnectionOverview({
  installations,
  repositories,
  installUrl,
  onSync,
}: {
  installations: import('@/store/githubStore').GitHubInstallation[];
  repositories: GitHubRepo[];
  installUrl: string | null;
  onSync: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [installationRef, setInstallationRef] = useState('');
  const [linking, setLinking] = useState(false);
  const { mutateAsync: syncRepositories } = useSyncRepositories();
  const { mutateAsync: setupInstallation } = useSetupInstallation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const handleLinkExistingInstallation = async () => {
    const installationId = parseInstallationId(installationRef);
    if (!installationId) {
      toast({
        title: 'Invalid installation reference',
        description: 'Paste a GitHub installation URL or a numeric installation ID.',
        variant: 'destructive',
      });
      return;
    }

    setLinking(true);
    try {
      await setupInstallation(installationId);
      qc.invalidateQueries({ queryKey: queryKeys.github.status() });
      setInstallationRef('');
      toast({
        title: 'GitHub linked',
        description: 'Existing GitHub installation connected and repositories synced.',
      });
      onSync();
    } catch (error) {
      toast({
        title: 'Failed to link installation',
        description:
          error instanceof Error ? error.message : 'Could not link the existing installation.',
        variant: 'destructive',
      });
    } finally {
      setLinking(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncRepositories();
      toast({
        title: 'Repositories synced',
        description: `Synced ${result.synced} repositories from GitHub.`,
      });
      onSync();
    } catch {
      toast({ title: 'Error', description: 'Failed to sync repositories', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {installations.map((inst) => {
        const instRepos = repositories.filter((r) => r.installationId === inst.id);
        const lastSynced = instRepos.reduce(
          (latest, r) => {
            if (!r.lastSyncedAt) return latest;
            if (!latest) return r.lastSyncedAt;
            return new Date(r.lastSyncedAt) > new Date(latest) ? r.lastSyncedAt : latest;
          },
          null as string | null,
        );

        return (
          <Card key={inst.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {inst.accountAvatarUrl ? (
                    <img
                      src={inst.accountAvatarUrl}
                      alt={inst.accountLogin}
                      className="h-10 w-10 rounded-full"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <Github className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <CardTitle className="text-base">{inst.accountLogin}</CardTitle>
                    <CardDescription className="text-xs">
                      {inst.accountType === 'Organization' ? 'Organization' : 'Personal account'}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant={inst.isActive ? 'default' : 'secondary'} className="text-xs">
                  {inst.isActive ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Connected
                    </>
                  ) : (
                    'Inactive'
                  )}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Repositories</span>
                  <p className="font-medium">{instRepos.length}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Access</span>
                  <p className="font-medium capitalize">
                    {inst.repositorySelection === 'all' ? 'All repos' : 'Selected repos'}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Connected</span>
                  <p className="font-medium">{formatRelativeTime(inst.createdAt)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Last synced</span>
                  <p className="font-medium">
                    {lastSynced ? formatRelativeTime(lastSynced) : 'Never'}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleSync}
                  disabled={syncing}
                >
                  {syncing ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Sync
                </Button>
                <Button variant="outline" size="sm" className="flex-1" asChild>
                  <a
                    href={`https://github.com/settings/installations/${inst.installationId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Settings className="h-3.5 w-3.5 mr-1.5" />
                    Manage
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Add another connection card */}
      {installUrl && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center h-full min-h-[200px] py-6">
            <div className="rounded-full bg-muted p-3 mb-3">
              <Plus className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground mb-3">Connect another account</p>
            <Button variant="outline" size="sm" asChild>
              <a href={installUrl} target="_blank" rel="noopener noreferrer">
                <LinkIcon className="h-3.5 w-3.5 mr-1.5" />
                Install GitHub App
              </a>
            </Button>
            <div className="w-full mt-4 pt-4 border-t text-left">
              <p className="text-xs font-medium mb-1.5">Already installed?</p>
              <div className="flex gap-2">
                <Input
                  value={installationRef}
                  onChange={(e) => setInstallationRef(e.target.value)}
                  placeholder="https://github.com/settings/installations/12345678"
                  disabled={linking}
                  className="text-xs h-8"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleLinkExistingInstallation}
                  disabled={linking || installationRef.trim().length === 0}
                >
                  {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Link'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function GitHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    data: statusData,
    isError: statusError,
    error: statusErrorDetail,
    refetch: refetchStatus,
  } = useGitHubStatus();
  const isConfigured = statusData?.configured ?? null;
  const installUrl = statusData?.installUrl ?? null;
  const { data: installations = [] } = useGitHubInstallations();
  const { data: repositories = [] } = useGitHubRepositories();
  const { mutateAsync: setupInstallation } = useSetupInstallation();
  const qc = useQueryClient();
  const { toast } = useToast();

  // Modal state for workflow picker
  const [selectedRepoForScan, setSelectedRepoForScan] = useState<GitHubRepo | null>(null);
  const location = useLocation();
  const activeTab = location.pathname.startsWith('/github/scans')
    ? 'scans'
    : location.pathname.startsWith('/github/triggers')
      ? 'triggers'
      : 'repos';
  const [settingUp, setSettingUp] = useState(false);

  const setActiveTab = (tab: string) => {
    const pathMap: Record<string, string> = {
      repos: '/github/repositories',
      scans: '/github/scans',
      triggers: '/github/triggers',
    };
    navigate(pathMap[tab] ?? '/github/repositories');
  };

  // Handle GitHub App installation callback
  useEffect(() => {
    const installationId = searchParams.get('installation_id');
    const setupAction = searchParams.get('setup_action');

    if (installationId && setupAction === 'install') {
      setSettingUp(true);

      // Clean installation URL params
      setSearchParams(new URLSearchParams(), { replace: true });

      const id = parseInt(installationId, 10);
      if (!isNaN(id)) {
        setupInstallation(id)
          .then(() => {
            toast({
              title: 'GitHub App installed',
              description:
                'Your GitHub account has been connected and repositories synced successfully.',
            });
            // Refresh status to ensure the page re-renders as configured
            qc.invalidateQueries({ queryKey: queryKeys.github.status() });
          })
          .catch(() => {
            // Fallback: try refreshing data even if setup endpoint fails
            toast({
              title: 'GitHub App connected',
              description: 'Syncing your repositories. This may take a moment.',
            });
            qc.invalidateQueries({ queryKey: queryKeys.github.installations() });
            qc.invalidateQueries({ queryKey: queryKeys.github.repositories() });
            qc.invalidateQueries({ queryKey: queryKeys.github.status() });
          })
          .finally(() => {
            setSettingUp(false);
          });
      } else {
        setSettingUp(false);
      }
    }
  }, []);

  const handleRunScan = useCallback((repo: GitHubRepo) => {
    setSelectedRepoForScan(repo);
  }, []);

  const handleScanSuccess = () => {
    // Switch to Scans tab and refresh scan results
    setActiveTab('scans');
    qc.invalidateQueries({ queryKey: queryKeys.github.scans() });
  };

  // Setting up after callback redirect
  if (settingUp) {
    return (
      <div className="container py-6 space-y-6">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <h2 className="text-lg font-semibold mb-2">Setting up GitHub connection...</h2>
          <p className="text-muted-foreground">
            Syncing your repositories from GitHub. This will only take a moment.
          </p>
        </div>
      </div>
    );
  }

  // Error fetching GitHub status
  if (statusError) {
    return (
      <div className="container py-6 space-y-6">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="rounded-full bg-destructive/10 p-4 mb-4">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Failed to load GitHub status</h3>
          <p className="text-muted-foreground mb-4 max-w-md">
            {statusErrorDetail?.message ?? 'Could not connect to the server. Please try again.'}
          </p>
          <Button onClick={() => refetchStatus()} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    );
  }

  // Still loading initial state
  if (isConfigured === null) {
    return (
      <div className="container py-6 space-y-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Not configured or no installations
  if (!isConfigured || installations.length === 0) {
    return (
      <div className="container py-6 space-y-6">
        <NotConfiguredState installUrl={installUrl} />
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="repos">
            <FolderGit className="h-4 w-4 mr-2" />
            Repositories
          </TabsTrigger>
          <TabsTrigger value="scans">
            <PlayCircle className="h-4 w-4 mr-2" />
            Scans
          </TabsTrigger>
          <TabsTrigger value="triggers">
            <GitPullRequest className="h-4 w-4 mr-2" />
            Trigger Rules
          </TabsTrigger>
        </TabsList>

        <TabsContent value="repos" className="mt-6">
          <div className="space-y-6">
            <ConnectionOverview
              installations={installations}
              repositories={repositories}
              installUrl={installUrl}
              onSync={() => qc.invalidateQueries({ queryKey: queryKeys.github.repositories() })}
            />
            <RepositoriesTab onRunScan={handleRunScan} />
          </div>
        </TabsContent>

        <TabsContent value="scans" className="mt-6">
          <ScansTab />
        </TabsContent>

        <TabsContent value="triggers" className="mt-6">
          <TriggerRulesTab />
        </TabsContent>
      </Tabs>

      {/* Workflow Picker Modal */}
      <WorkflowPickerModal
        open={selectedRepoForScan !== null}
        onClose={() => setSelectedRepoForScan(null)}
        repository={selectedRepoForScan}
        onSuccess={handleScanSuccess}
      />
    </div>
  );
}

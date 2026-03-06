import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  Github,
  GitPullRequest,
  GitBranch,
  GitCommit,
  PlayCircle,
  CalendarClock,
  ExternalLink,
  X,
  Timer,
  Clock,
  ShieldAlert,
  ShieldX,
  Shield,
  ShieldCheck,
  AlertCircle,
  Loader2,
  ChevronDown,
  Download,
  FileJson,
  FileSpreadsheet,
  RotateCcw,
  ArrowLeft,
  BarChart3,
  Search,
  Package,
} from 'lucide-react';
import type { GitHubScanResult, GitHubRepo, TriggerRule } from '@/store/githubStore';
import { useGitHubStore } from '@/store/githubStore';
import {
  useTriggerScan,
  useGitHubBranches,
  useGitHubScanResult,
  useGitHubRepositories,
  useTriggerRules,
} from '@/hooks/queries/useGithubQueries';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import {
  STATUS_COLORS,
  STATUS_ICONS,
  SEVERITY_CONFIG,
  SEVERITY_ORDER,
  formatRelativeTime,
  formatDuration,
  exportToJson,
  exportToCsv,
  groupFindingsBySeverity,
  getScanFailureGuidance,
  getScanSourceMeta,
} from './scan-utils';
import { FindingsGroup } from './FindingsGroup';
import { SeverityDonutChart } from './SeverityDonutChart';
import { buildGitHubBranchOptions } from '@/lib/github-ui';

// ── Types ─────────────────────────────────────────────────────────

interface ScanDetailPanelProps {
  scanId: string;
  highlightedFindingId?: string;
  onClose: () => void;
  onFindingSelect: (findingId: string | null) => void;
  isMobile?: boolean;
}

// ── Rerun Scan Modal ──────────────────────────────────────────────

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

const QUICK_SCANS = [
  {
    slug: 'secret-detection',
    templateSlug: 'sys-secret-scan',
    name: 'Secret Detection',
    description: 'Scan for exposed secrets',
    icon: ShieldAlert,
  },
  {
    slug: 'sast-opengrep',
    templateSlug: 'sys-sast-scan',
    name: 'SAST (OpenGrep)',
    description: 'Static application security testing',
    icon: Search,
  },
  {
    slug: 'dependency-audit',
    templateSlug: 'sys-dependency-scan',
    name: 'Dependency Audit',
    description: 'Check for vulnerable dependencies',
    icon: Package,
  },
];

function resolveQuickScans(systemWorkflows: { id: string; slug: string | null }[]): {
  slug: string;
  workflowId: string;
  name: string;
  description: string;
  icon: typeof ShieldAlert;
}[] {
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

function RerunScanModal({
  open,
  onClose,
  repository,
  defaultBranch,
  triggerRule,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  repository: GitHubRepo | null;
  defaultBranch: string;
  triggerRule: TriggerRule | null;
  onSuccess: () => void;
}) {
  const { mutateAsync: triggerScan } = useTriggerScan();
  const { toast } = useToast();
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);
  const { data: branches = [] } = useGitHubBranches(repository?.id ?? '');
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([]);
  const [workflowCompatibility, setWorkflowCompatibility] = useState<
    Record<string, WorkflowCompatibility>
  >({});
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [triggering, setTriggering] = useState<string | null>(null);

  useEffect(() => {
    if (open) fetchSystemWorkflows();
  }, [open, fetchSystemWorkflows]);

  useEffect(() => {
    if (open) {
      setLoadingWorkflows(true);
      setWorkflowCompatibility({});
      setSelectedBranch(defaultBranch || repository?.defaultBranch || 'main');
      api.workflows
        .list()
        .then(async (data) => {
          const opts = data.map((w) => ({
            id: w.id,
            name: w.name,
            description: w.description ?? undefined,
          }));
          setWorkflows(opts);
          setSelectedWorkflow(triggerRule?.workflowId ?? '');

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
        .catch(() =>
          toast({
            title: 'Error',
            description: 'Failed to load workflows',
            variant: 'destructive',
          }),
        )
        .finally(() => setLoadingWorkflows(false));
    }
  }, [open, repository, defaultBranch, triggerRule, toast]);

  const selectedWorkflowCompatibility = selectedWorkflow
    ? (workflowCompatibility[selectedWorkflow] ?? null)
    : null;
  const selectedWorkflowRequiresPrContext =
    selectedWorkflowCompatibility?.requiresPrContext ?? false;
  const branchOptions = buildGitHubBranchOptions({
    branches,
    defaultBranch: repository?.defaultBranch ?? 'main',
    originalBranch: defaultBranch,
  });

  const handleTrigger = async (workflowId: string) => {
    if (!repository) return;
    const compatibility = workflowCompatibility[workflowId];
    if (compatibility?.requiresPrContext) {
      toast({
        title: 'PR context required',
        description:
          'This workflow expects PR runtime inputs. Use a PR trigger rule instead of a manual rerun.',
        variant: 'destructive',
      });
      return;
    }
    setTriggering(workflowId);
    try {
      const result = await triggerScan({
        repoId: repository.id,
        workflowId,
        branch: selectedBranch || undefined,
      });
      toast({
        title: 'Scan started',
        description: (
          <span>
            Security scan started for {repository.fullName}.{' '}
            <Link to={`/runs/${result.runId}`} className="font-medium text-primary hover:underline">
              Open Run &rarr;
            </Link>
          </span>
        ),
      });
      onClose();
      onSuccess();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start scan',
        variant: 'destructive',
      });
    } finally {
      setTriggering(null);
    }
  };

  if (!repository) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Re-run Security Scan</DialogTitle>
          <DialogDescription>
            Start a new scan for <strong>{repository.fullName}</strong>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Branch</label>
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger>
                <SelectValue placeholder="Select branch" />
              </SelectTrigger>
              <SelectContent>
                {branchOptions.map((branch) => (
                  <SelectItem key={branch.value} value={branch.value}>
                    {branch.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                This workflow requires PR context (for example `prNumber`) and cannot be rerun
                manually from this dialog.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Summary Cards ─────────────────────────────────────────────────

function SummaryCards({ scan }: { scan: GitHubScanResult }) {
  const { summary } = scan;
  const cards = [
    {
      label: 'Critical',
      count: summary?.critical ?? 0,
      icon: <ShieldAlert className="h-5 w-5" />,
      colorClass: 'text-red-700 dark:text-red-400',
      bgColorClass: 'bg-red-50 dark:bg-red-950/30',
    },
    {
      label: 'High',
      count: summary?.high ?? 0,
      icon: <ShieldX className="h-5 w-5" />,
      colorClass: 'text-orange-700 dark:text-orange-400',
      bgColorClass: 'bg-orange-50 dark:bg-orange-950/30',
    },
    {
      label: 'Medium',
      count: summary?.medium ?? 0,
      icon: <Shield className="h-5 w-5" />,
      colorClass: 'text-yellow-700 dark:text-yellow-400',
      bgColorClass: 'bg-yellow-50 dark:bg-yellow-950/30',
    },
    {
      label: 'Low',
      count: summary?.low ?? 0,
      icon: <ShieldCheck className="h-5 w-5" />,
      colorClass: 'text-blue-700 dark:text-blue-400',
      bgColorClass: 'bg-blue-50 dark:bg-blue-950/30',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map((card) => (
        <Card key={card.label} className={`${card.bgColorClass} border-none`}>
          <CardContent className="p-2.5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className={`text-xs font-medium ${card.colorClass}`}>{card.label}</p>
                <p className={`text-xl font-bold leading-none ${card.colorClass}`}>{card.count}</p>
              </div>
              <div className={`${card.colorClass} opacity-80`}>{card.icon}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── Error Alert ───────────────────────────────────────────────────

function ErrorAlert({ message, suggestion }: { message: string; suggestion: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-red-800 dark:text-red-300">Scan Failed</h4>
          <p className="text-sm text-red-700 dark:text-red-400">{message}</p>
          <p className="text-xs text-red-700/90 dark:text-red-300/90">
            Suggested fix: {suggestion}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Loading Skeleton ──────────────────────────────────────────────

function PanelSkeleton() {
  return (
    <div className="p-6 space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-5 w-16" />
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[180px] w-[180px] rounded-full mx-auto" />
    </div>
  );
}

// ── Main Panel Component ──────────────────────────────────────────

export function ScanDetailPanel({
  scanId,
  highlightedFindingId,
  onClose,
  onFindingSelect,
  isMobile,
}: ScanDetailPanelProps) {
  const { data: scan, isLoading: loading, error: scanError } = useGitHubScanResult(scanId);
  const { data: repositories = [] } = useGitHubRepositories();
  const { data: triggerRules = [] } = useTriggerRules();

  const error =
    scanError instanceof Error ? scanError.message : scanError ? 'Failed to load scan' : null;
  const [showRerunModal, setShowRerunModal] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to highlighted finding
  useEffect(() => {
    if (!highlightedFindingId || loading) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`finding-${highlightedFindingId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [highlightedFindingId, loading]);

  // Keyboard: Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (loading) return <PanelSkeleton />;

  if (error || !scan) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Scan Not Found</h3>
        <p className="text-muted-foreground mb-4">{error || 'Could not load scan details.'}</p>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  const repository = repositories.find((r) => r.id === scan.repositoryId) ?? null;
  const repoFullName = repository?.fullName ?? 'Unknown Repository';
  const repoHtmlUrl = repository?.htmlUrl;
  const duration = formatDuration(scan.startedAt, scan.completedAt);
  const commitUrl =
    repoHtmlUrl && scan.commitSha ? `${repoHtmlUrl}/commit/${scan.commitSha}` : null;
  const prUrl =
    repoHtmlUrl && scan.prNumber != null ? `${repoHtmlUrl}/pull/${scan.prNumber}` : null;
  const branchUrl =
    repoHtmlUrl && scan.branch ? `${repoHtmlUrl}/tree/${encodeURIComponent(scan.branch)}` : null;
  const triggerRule = scan.triggerRuleId
    ? (triggerRules.find((r) => r.id === scan.triggerRuleId) ?? null)
    : null;
  const findings = scan.findings ?? [];
  const groupedFindings = groupFindingsBySeverity(findings);
  const showErrorAlert =
    (scan.status === 'failure' || scan.status === 'error') && scan.errorMessage;
  const sourceMeta = getScanSourceMeta(scan);
  const scheduleScanParams = new URLSearchParams({ source: 'schedule' });
  if (sourceMeta.scheduleId) {
    scheduleScanParams.set('scheduleId', sourceMeta.scheduleId);
  }
  const scheduleScanLink = `/github/scans?${scheduleScanParams.toString()}`;
  const failureGuidance = getScanFailureGuidance(scan);
  const exactCreatedAtLocal = new Date(scan.createdAt).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });

  const donutData = [
    {
      label: 'Critical',
      value: scan.summary?.critical ?? 0,
      color: SEVERITY_CONFIG.critical.color,
    },
    { label: 'High', value: scan.summary?.high ?? 0, color: SEVERITY_CONFIG.high.color },
    { label: 'Medium', value: scan.summary?.medium ?? 0, color: SEVERITY_CONFIG.medium.color },
    { label: 'Low', value: scan.summary?.low ?? 0, color: SEVERITY_CONFIG.low.color },
    { label: 'Info', value: scan.summary?.info ?? 0, color: SEVERITY_CONFIG.info.color },
  ];

  const handleExportJson = () => exportToJson(scan, repoFullName);
  const handleExportCsv = () => exportToCsv(scan, repoFullName);
  const handleRerunSuccess = () => {
    // Scan results will be auto-refreshed by TanStack Query invalidation from useTriggerScan
  };

  return (
    <div ref={scrollContainerRef} className="h-full flex flex-col overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex-shrink-0 border-b px-5 py-4 space-y-3">
        {/* Top row: repo/status + actions/close */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {isMobile && (
              <Button variant="ghost" size="sm" onClick={onClose} className="flex-shrink-0 -ml-2">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Github className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            {repoHtmlUrl ? (
              <a
                href={repoHtmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold truncate hover:underline inline-flex items-center gap-1"
              >
                {repoFullName}
                <ExternalLink className="h-3 w-3 flex-shrink-0" />
              </a>
            ) : (
              <span className="font-semibold truncate">{repoFullName}</span>
            )}
            <Badge
              variant="outline"
              className={`${STATUS_COLORS[scan.status]} text-white border-none inline-flex items-center gap-1 flex-shrink-0`}
            >
              {STATUS_ICONS[scan.status]}
              <span className="capitalize text-xs">{scan.status}</span>
            </Badge>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!isMobile && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                      <Download className="h-3.5 w-3.5" />
                      Export
                      <ChevronDown className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleExportJson} className="gap-2 cursor-pointer">
                      <FileJson className="h-4 w-4" /> JSON
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportCsv} className="gap-2 cursor-pointer">
                      <FileSpreadsheet className="h-4 w-4" /> CSV
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setShowRerunModal(true)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Re-run
                </Button>
                <Button variant="ghost" size="sm" onClick={onClose} className="flex-shrink-0 -mr-2">
                  <X className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Meta row: source, commit, duration, time */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            {sourceMeta.kind === 'pr' ? (
              <>
                <GitPullRequest className="h-3.5 w-3.5" />
                {prUrl ? (
                  <a
                    href={prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {sourceMeta.label + (sourceMeta.detail ? ` ${sourceMeta.detail}` : '')}
                  </a>
                ) : (
                  <span>
                    {sourceMeta.label + (sourceMeta.detail ? ` ${sourceMeta.detail}` : '')}
                  </span>
                )}
              </>
            ) : sourceMeta.kind === 'push' ? (
              <>
                <GitBranch className="h-3.5 w-3.5" />
                {branchUrl ? (
                  <a
                    href={branchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:underline"
                  >
                    {sourceMeta.detail ?? sourceMeta.label}
                  </a>
                ) : (
                  <span>{sourceMeta.detail ?? sourceMeta.label}</span>
                )}
              </>
            ) : sourceMeta.kind === 'schedule' ? (
              <>
                <CalendarClock className="h-3.5 w-3.5" />
                <Link to={scheduleScanLink} className="hover:underline">
                  {sourceMeta.detail ?? sourceMeta.label}
                </Link>
              </>
            ) : (
              <>
                <PlayCircle className="h-3.5 w-3.5" />
                <span>{sourceMeta.label}</span>
              </>
            )}
          </div>
          {scan.commitSha && (
            <div className="flex items-center gap-1">
              <GitCommit className="h-3.5 w-3.5" />
              {commitUrl ? (
                <a
                  href={commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono hover:underline"
                >
                  {scan.commitSha.slice(0, 7)}
                </a>
              ) : (
                <span className="font-mono">{scan.commitSha.slice(0, 7)}</span>
              )}
            </div>
          )}
          {duration && (
            <div className="flex items-center gap-1">
              <Timer className="h-3.5 w-3.5" />
              <span>{duration}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            <span title={exactCreatedAtLocal}>{formatRelativeTime(scan.createdAt)}</span>
          </div>
        </div>

        {isMobile && (
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Download className="h-3.5 w-3.5" />
                  Export
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={handleExportJson} className="gap-2 cursor-pointer">
                  <FileJson className="h-4 w-4" /> JSON
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportCsv} className="gap-2 cursor-pointer">
                  <FileSpreadsheet className="h-4 w-4" /> CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowRerunModal(true)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Re-run
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 border-b px-5 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-3.5 w-3.5" />
            Overview
            {findings.length > 0 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
                {findings.length}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-4">
            {showErrorAlert && (
              <ErrorAlert
                message={failureGuidance.reason}
                suggestion={failureGuidance.suggestion}
              />
            )}

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
              <SummaryCards scan={scan} />
              <Card className="border bg-muted/20">
                <CardContent className="p-3 flex items-center justify-center">
                  <SeverityDonutChart
                    data={donutData}
                    size={132}
                    strokeWidth={20}
                    showLegend={false}
                  />
                </CardContent>
              </Card>
            </div>

            {findings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="rounded-full bg-green-100 dark:bg-green-950/30 p-3 mb-3">
                  <ShieldCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="text-lg font-medium mb-1">No Findings</h3>
                <p className="text-sm text-muted-foreground">
                  {scan.status === 'success'
                    ? 'No security issues were detected in this scan.'
                    : scan.status === 'running' || scan.status === 'pending'
                      ? 'Scan is still in progress. Findings will appear here when complete.'
                      : 'No findings available for this scan.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {SEVERITY_ORDER.map((severity) => {
                  const severityFindings = groupedFindings[severity];
                  const hasHighlightedFinding = highlightedFindingId
                    ? severityFindings.some((f) => f.id === highlightedFindingId)
                    : false;
                  return (
                    <FindingsGroup
                      key={severity}
                      severity={severity}
                      findings={severityFindings}
                      repository={repository}
                      commitSha={scan.commitSha}
                      highlightedFindingId={highlightedFindingId}
                      defaultExpanded={highlightedFindingId ? hasHighlightedFinding : undefined}
                      onFindingClick={onFindingSelect}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Rerun Modal ──────────────────────────────────────── */}
      <RerunScanModal
        open={showRerunModal}
        onClose={() => setShowRerunModal(false)}
        repository={repository}
        defaultBranch={scan.branch || ''}
        triggerRule={triggerRule}
        onSuccess={handleRerunSuccess}
      />
    </div>
  );
}

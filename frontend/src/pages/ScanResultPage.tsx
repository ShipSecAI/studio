import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
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
  ArrowLeft,
  ExternalLink,
  Loader2,
  Timer,
  ShieldAlert,
  ShieldX,
  Shield,
  ShieldCheck,
  ChevronDown,
  RotateCcw,
  Search,
  Package,
  Download,
  FileJson,
  FileSpreadsheet,
  AlertCircle,
} from 'lucide-react';
import type { GitHubScanResult, GitHubRepo, TriggerRule } from '@/store/githubStore';
import { useGitHubStore } from '@/store/githubStore';
import {
  useTriggerScan,
  useGitHubScanResult,
  useGitHubRepositories,
  useTriggerRules,
} from '@/hooks/queries/useGithubQueries';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import {
  STATUS_COLORS,
  STATUS_ICONS,
  SEVERITY_ORDER,
  formatRelativeTime,
  formatDuration,
  exportToJson,
  exportToCsv,
  groupFindingsBySeverity,
  getScanFailureGuidance,
  getScanSourceMeta,
} from '@/components/scans/scan-utils';
import { FindingsGroup } from '@/components/scans/FindingsGroup';

// Quick scan workflow options
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
    description: 'Scan for exposed secrets and credentials',
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

// WorkflowPickerModal for re-running scans
interface RerunScanModalProps {
  open: boolean;
  onClose: () => void;
  repository: GitHubRepo | null;
  defaultBranch: string;
  triggerRule: TriggerRule | null;
  onSuccess: () => void;
}

function RerunScanModal({
  open,
  onClose,
  repository,
  defaultBranch,
  triggerRule,
  onSuccess,
}: RerunScanModalProps) {
  const { mutateAsync: triggerScan } = useTriggerScan();
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
          const workflowOptions = data.map((w) => ({
            id: w.id,
            name: w.name,
            description: w.description ?? undefined,
          }));
          setWorkflows(workflowOptions);
          if (triggerRule?.workflowId) {
            setSelectedWorkflow(triggerRule.workflowId);
          } else {
            setSelectedWorkflow('');
          }

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
  }, [open, repository, defaultBranch, triggerRule, toast]);

  const selectedWorkflowCompatibility = selectedWorkflow
    ? (workflowCompatibility[selectedWorkflow] ?? null)
    : null;
  const selectedWorkflowRequiresPrContext =
    selectedWorkflowCompatibility?.requiresPrContext ?? false;

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
                <SelectItem value={repository.defaultBranch || 'main'}>
                  {repository.defaultBranch || 'main'} (default)
                </SelectItem>
                {defaultBranch && defaultBranch !== repository.defaultBranch && (
                  <SelectItem value={defaultBranch}>{defaultBranch} (original)</SelectItem>
                )}
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
            <h4 className="text-sm font-medium text-muted-foreground">
              Custom Workflows
              {triggerRule?.workflowId && (
                <span className="ml-2 text-xs text-primary">(original workflow pre-selected)</span>
              )}
            </h4>
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

function ScanDetailHeader({
  scan,
  repository,
  onRerunScan,
  onExportJson,
  onExportCsv,
}: {
  scan: GitHubScanResult;
  repository: GitHubRepo | null;
  onRerunScan: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
}) {
  const repoFullName = repository?.fullName ?? 'Unknown Repository';
  const repoHtmlUrl = repository?.htmlUrl;
  const duration = formatDuration(scan.startedAt, scan.completedAt);
  const sourceMeta = getScanSourceMeta(scan);
  const commitUrl =
    repoHtmlUrl && scan.commitSha ? `${repoHtmlUrl}/commit/${scan.commitSha}` : null;

  return (
    <div className="border-b pb-6">
      <div className="mb-4">
        <Link
          to="/github/scans"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Scans
        </Link>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Github className="h-6 w-6 text-muted-foreground" />
            {repoHtmlUrl ? (
              <a
                href={repoHtmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xl font-semibold hover:underline inline-flex items-center gap-1"
              >
                {repoFullName}
                <ExternalLink className="h-4 w-4" />
              </a>
            ) : (
              <span className="text-xl font-semibold">{repoFullName}</span>
            )}
            <Badge
              variant="outline"
              className={`${STATUS_COLORS[scan.status]} text-white border-none inline-flex items-center gap-1`}
            >
              {STATUS_ICONS[scan.status]}
              <span className="capitalize">{scan.status}</span>
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              {sourceMeta.kind === 'pr' ? (
                <>
                  <GitPullRequest className="h-4 w-4" />
                  <span>
                    {sourceMeta.label + (sourceMeta.detail ? ` ${sourceMeta.detail}` : '')}
                  </span>
                </>
              ) : sourceMeta.kind === 'push' ? (
                <>
                  <GitBranch className="h-4 w-4" />
                  <span>{sourceMeta.detail ?? sourceMeta.label}</span>
                </>
              ) : sourceMeta.kind === 'schedule' ? (
                <>
                  <CalendarClock className="h-4 w-4" />
                  <span>{sourceMeta.detail ?? sourceMeta.label}</span>
                </>
              ) : (
                <>
                  <PlayCircle className="h-4 w-4" />
                  <span>{sourceMeta.label}</span>
                </>
              )}
            </div>
            {scan.commitSha && (
              <div className="flex items-center gap-1">
                <GitCommit className="h-4 w-4" />
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
                <Timer className="h-4 w-4" />
                <span>{duration}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Timer className="h-4 w-4" />
              <span>{formatRelativeTime(scan.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                Export
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onExportJson} className="gap-2 cursor-pointer">
                <FileJson className="h-4 w-4" /> Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onExportCsv} className="gap-2 cursor-pointer">
                <FileSpreadsheet className="h-4 w-4" /> Export as CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={onRerunScan} variant="outline" className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Re-run Scan
          </Button>
        </div>
      </div>
    </div>
  );
}

function SummaryCards({ scan }: { scan: GitHubScanResult }) {
  const { summary } = scan;
  const cards = [
    {
      label: 'Critical',
      count: summary?.critical ?? 0,
      icon: <ShieldAlert className="h-8 w-8" />,
      colorClass: 'text-red-700 dark:text-red-400',
      bgColorClass: 'bg-red-50 dark:bg-red-950/30',
    },
    {
      label: 'High',
      count: summary?.high ?? 0,
      icon: <ShieldX className="h-8 w-8" />,
      colorClass: 'text-orange-700 dark:text-orange-400',
      bgColorClass: 'bg-orange-50 dark:bg-orange-950/30',
    },
    {
      label: 'Medium',
      count: summary?.medium ?? 0,
      icon: <Shield className="h-8 w-8" />,
      colorClass: 'text-yellow-700 dark:text-yellow-400',
      bgColorClass: 'bg-yellow-50 dark:bg-yellow-950/30',
    },
    {
      label: 'Low',
      count: summary?.low ?? 0,
      icon: <ShieldCheck className="h-8 w-8" />,
      colorClass: 'text-blue-700 dark:text-blue-400',
      bgColorClass: 'bg-blue-50 dark:bg-blue-950/30',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label} className={`${card.bgColorClass} border-none`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <p className={`text-sm font-medium ${card.colorClass}`}>{card.label}</p>
                <p className={`text-3xl font-bold ${card.colorClass}`}>{card.count}</p>
              </div>
              <div className={`${card.colorClass} opacity-80`}>{card.icon}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

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

function FindingsList({
  scan,
  repository,
}: {
  scan: GitHubScanResult;
  repository: GitHubRepo | null;
}) {
  const findings = scan.findings ?? [];

  if (findings.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center text-center">
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
        </CardContent>
      </Card>
    );
  }

  const groupedFindings = groupFindingsBySeverity(findings);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Findings ({findings.length})</h2>
      <div className="space-y-4">
        {SEVERITY_ORDER.map((severity) => (
          <FindingsGroup
            key={severity}
            severity={severity}
            findings={groupedFindings[severity]}
            repository={repository}
            commitSha={scan.commitSha}
          />
        ))}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="container py-6 space-y-6">
      <Skeleton className="h-4 w-24" />
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-6 w-20" />
        </div>
        <div className="flex gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export function ScanResultPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: scan, isLoading: loading, error: scanQueryError } = useGitHubScanResult(id ?? '');
  const { data: repositories = [] } = useGitHubRepositories();
  const { data: triggerRules = [] } = useTriggerRules();
  const error =
    scanQueryError instanceof Error
      ? scanQueryError.message
      : scanQueryError
        ? 'Failed to load scan result'
        : null;
  const [showRerunModal, setShowRerunModal] = useState(false);

  const handleRerunSuccess = () => {
    navigate('/github/scans');
  };

  const handleExportJson = () => {
    if (!scan) return;
    exportToJson(scan, repository?.fullName ?? 'unknown-repo');
  };

  const handleExportCsv = () => {
    if (!scan) return;
    exportToCsv(scan, repository?.fullName ?? 'unknown-repo');
  };

  if (loading) return <LoadingSkeleton />;

  if (error || !scan) {
    return (
      <div className="container py-6">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <AlertCircle className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Scan Not Found</h3>
          <p className="text-muted-foreground mb-4">
            {error || 'The scan result could not be loaded.'}
          </p>
          <Button asChild variant="outline">
            <Link to="/github/scans">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Scans
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const repository = repositories.find((r) => r.id === scan.repositoryId) ?? null;
  const triggerRule = scan.triggerRuleId
    ? (triggerRules.find((r) => r.id === scan.triggerRuleId) ?? null)
    : null;
  const showErrorAlert =
    (scan.status === 'failure' || scan.status === 'error') && scan.errorMessage;
  const failureGuidance = getScanFailureGuidance(scan);

  return (
    <div className="container py-6 space-y-6">
      <ScanDetailHeader
        scan={scan}
        repository={repository}
        onRerunScan={() => setShowRerunModal(true)}
        onExportJson={handleExportJson}
        onExportCsv={handleExportCsv}
      />
      {showErrorAlert && (
        <ErrorAlert message={failureGuidance.reason} suggestion={failureGuidance.suggestion} />
      )}
      <SummaryCards scan={scan} />
      <FindingsList scan={scan} repository={repository} />
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

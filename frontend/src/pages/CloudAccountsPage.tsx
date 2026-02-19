import { useMemo, useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useIntegrationConnections,
  useValidateAwsConnection,
  useDisconnectIntegration,
} from '@/hooks/queries/useIntegrationQueries';
import { useWorkflowsSummary } from '@/hooks/queries/useWorkflowQueries';
import { useToast } from '@/components/ui/use-toast';
import {
  Cloud,
  Plus,
  Shield,
  ScanSearch,
  PlayCircle,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  Container,
  MoreVertical,
  RefreshCw,
  Unlink,
  Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AwsSetupForm } from '@/components/integrations/AwsSetupForm';
import { api } from '@/services/api';
import type { WorkflowSummary } from '@/services/api';

// ── Types ────────────────────────────────────────────────────────────────────

interface AwsConnection {
  id: string;
  displayName?: string;
  provider: string;
  config?: Record<string, unknown>;
  status?: string;
  lastValidatedAt?: string;
  createdAt?: string;
}

// ── Freshness Badge ──────────────────────────────────────────────────────────

function FreshnessBadge({ lastValidatedAt }: { lastValidatedAt?: string }) {
  if (!lastValidatedAt) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
        <Clock className="h-3 w-3" /> Never
      </span>
    );
  }

  const diffMs = Date.now() - new Date(lastValidatedAt).getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 1) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
        <CheckCircle2 className="h-3 w-3" /> &lt;24h
      </span>
    );
  }
  if (diffDays <= 7) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
        <Clock className="h-3 w-3" /> {Math.floor(diffDays)}d ago
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">
      <AlertTriangle className="h-3 w-3" /> &gt;7d
    </span>
  );
}

// ── KPI Stats Row ────────────────────────────────────────────────────────────

function KpiRow({ connections }: { connections: AwsConnection[] }) {
  const validCount = connections.filter(
    (c) => c.status === 'valid' || c.status === 'active',
  ).length;
  const freshCount = connections.filter((c) => {
    if (!c.lastValidatedAt) return false;
    return Date.now() - new Date(c.lastValidatedAt).getTime() < 24 * 60 * 60 * 1000;
  }).length;

  const stats = [
    {
      label: 'Connected',
      value: `${validCount}/${connections.length}`,
      sub: 'accounts',
      color: 'text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Validated <24h',
      value: `${freshCount}`,
      sub: 'accounts',
      color: 'text-green-600 dark:text-green-400',
    },
    {
      label: 'Total Accounts',
      value: `${connections.length}`,
      sub: 'AWS',
      color: 'text-purple-600 dark:text-purple-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="border rounded-lg p-4 bg-card">
          <p className="text-xs text-muted-foreground">{stat.label}</p>
          <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
          <p className="text-xs text-muted-foreground">{stat.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────

function CloudEmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Cloud className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">Connect Your AWS Account</h3>
      <p className="text-muted-foreground mb-6 max-w-md">
        Enable cloud security scanning, misconfiguration detection, and compliance auditing for your
        AWS infrastructure.
      </p>
      <ul className="text-sm text-muted-foreground mb-6 space-y-1 text-left">
        <li className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-green-500" /> Misconfiguration scanning (Prowler)
        </li>
        <li className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-green-500" /> Container image scanning (Trivy)
        </li>
        <li className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-green-500" /> Compliance reporting (CIS, HIPAA, GDPR)
        </li>
      </ul>
      <Button onClick={onConnect}>
        <Plus className="mr-2 h-4 w-4" />
        Connect AWS Account
      </Button>
    </div>
  );
}

// ── Loading State ────────────────────────────────────────────────────────────

function CloudLoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-48 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ── Cloud Scan Picker Modal ──────────────────────────────────────────────────

const CLOUD_QUICK_SCANS = [
  {
    slug: 'cloud-security-scan',
    name: 'Misconfiguration Scan',
    description: 'Prowler — CIS, GDPR, HIPAA benchmarks',
    icon: Shield,
    matchPattern: /cloud security|prowler/i,
  },
  {
    slug: 'container-image-scan',
    name: 'Container Image Scan',
    description: 'Trivy — ECR image vulnerability scan',
    icon: Container,
    matchPattern: /container image|trivy/i,
  },
];

interface CloudScanPickerModalProps {
  open: boolean;
  onClose: () => void;
  connection: AwsConnection | null;
}

function CloudScanPickerModal({ open, onClose, connection }: CloudScanPickerModalProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: workflows = [] } = useWorkflowsSummary();
  const [triggering, setTriggering] = useState<string | null>(null);
  const [expandedScan, setExpandedScan] = useState<string | null>(null);
  const [imageRef, setImageRef] = useState('');
  const imageRefInputRef = useRef<HTMLInputElement>(null);

  const resolvedScans = useMemo(() => {
    return CLOUD_QUICK_SCANS.flatMap((scan) => {
      const match = workflows.find((w: WorkflowSummary) => scan.matchPattern.test(w.name));
      if (!match) return [];
      return [{ ...scan, workflowId: match.id }];
    });
  }, [workflows]);

  const quickScanIds = useMemo(
    () => new Set(resolvedScans.map((s) => s.workflowId)),
    [resolvedScans],
  );

  const otherWorkflows = useMemo(
    () => workflows.filter((w: WorkflowSummary) => !quickScanIds.has(w.id)),
    [workflows, quickScanIds],
  );

  const handleQuickScan = async (workflowId: string, extraInputs?: Record<string, unknown>) => {
    if (!connection) return;
    setTriggering(workflowId);
    try {
      const inputs: Record<string, unknown> = { connectionId: connection.id, ...extraInputs };
      const { executionId } = await api.executions.start(workflowId, { inputs });
      toast({ title: 'Scan started', description: `Execution ${executionId.slice(0, 8)}...` });
      onClose();
      setExpandedScan(null);
      setImageRef('');
      if (executionId) {
        navigate(`/runs/${executionId}`);
      }
    } catch (err) {
      toast({
        title: 'Failed to start scan',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setTriggering(null);
    }
  };

  const handleCustomWorkflow = async (workflowId: string) => {
    if (!connection) return;
    setTriggering(workflowId);
    try {
      // Only pass connectionId — custom workflows may or may not use it
      const { executionId } = await api.executions.start(workflowId, {
        inputs: { connectionId: connection.id },
      });
      toast({ title: 'Workflow started', description: `Execution ${executionId.slice(0, 8)}...` });
      onClose();
      if (executionId) {
        navigate(`/runs/${executionId}`);
      }
    } catch (err) {
      toast({
        title: 'Failed to start workflow',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setTriggering(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Run Cloud Scan{connection ? ` — "${connection.displayName || 'AWS Account'}"` : ''}
          </DialogTitle>
          <DialogDescription>Select a scan type to run against this AWS account.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {resolvedScans.map((scan) => {
            const Icon = scan.icon;
            const isTriggering = triggering === scan.workflowId;
            const needsImageRef = scan.slug === 'container-image-scan';
            const isExpanded = expandedScan === scan.slug;

            return (
              <div key={scan.slug} className="rounded-lg border transition-colors">
                <button
                  onClick={() => {
                    if (needsImageRef) {
                      setExpandedScan(isExpanded ? null : scan.slug);
                      setTimeout(() => imageRefInputRef.current?.focus(), 50);
                    } else {
                      handleQuickScan(scan.workflowId);
                    }
                  }}
                  disabled={!!triggering}
                  className="flex items-start gap-3 w-full p-3 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                    {isTriggering ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{scan.name}</p>
                    <p className="text-xs text-muted-foreground">{scan.description}</p>
                  </div>
                </button>
                {needsImageRef && isExpanded && (
                  <div className="px-3 pb-3 space-y-2">
                    <Input
                      ref={imageRefInputRef}
                      placeholder="e.g. nginx:latest, 123456.dkr.ecr.us-east-1.amazonaws.com/app:v1"
                      value={imageRef}
                      onChange={(e) => setImageRef(e.target.value)}
                      className="h-8 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && imageRef.trim()) {
                          handleQuickScan(scan.workflowId, { imageRef: imageRef.trim() });
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={!imageRef.trim() || !!triggering}
                      onClick={() =>
                        handleQuickScan(scan.workflowId, { imageRef: imageRef.trim() })
                      }
                    >
                      {isTriggering ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <PlayCircle className="h-4 w-4 mr-2" />
                      )}
                      Scan Image
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          {resolvedScans.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No cloud scan workflows found. Create one from Templates first.
            </p>
          )}

          {otherWorkflows.length > 0 && (
            <div className="border-t pt-3">
              <Select
                onValueChange={(workflowId) => handleCustomWorkflow(workflowId)}
                disabled={!!triggering}
              >
                <SelectTrigger className="w-full">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Workflow className="h-4 w-4" />
                    <SelectValue placeholder="Or select a custom workflow..." />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {otherWorkflows.map((w: WorkflowSummary) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Account Card ─────────────────────────────────────────────────────────────

function AccountCard({
  connection,
  onScan,
  onValidate,
  onDisconnect,
}: {
  connection: AwsConnection;
  onScan: () => void;
  onValidate: () => void;
  onDisconnect: () => void;
}) {
  const region = (connection.config as Record<string, string>)?.region;
  const accountId = (connection.config as Record<string, string>)?.accountId;

  return (
    <div className="border rounded-lg p-4 space-y-3 bg-card text-card-foreground">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <img src="/icons/aws.png" alt="AWS" className="h-6 w-6 object-contain" />
          <div>
            <p className="font-medium">{connection.displayName || 'AWS Account'}</p>
            {accountId && <p className="text-xs text-muted-foreground font-mono">{accountId}</p>}
            {region && <p className="text-xs text-muted-foreground">{region}</p>}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onValidate}>
              <RefreshCw className="mr-2 h-4 w-4" /> Validate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDisconnect} className="text-red-600 dark:text-red-400">
              <Unlink className="mr-2 h-4 w-4" /> Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            connection.status === 'valid' || connection.status === 'active'
              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
          }`}
        >
          {connection.status === 'valid' || connection.status === 'active'
            ? connection.status.charAt(0).toUpperCase() + connection.status.slice(1)
            : connection.status || 'Unknown'}
        </span>
        <FreshnessBadge lastValidatedAt={connection.lastValidatedAt} />
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="default" onClick={onScan} className="gap-1.5">
          <PlayCircle className="h-3.5 w-3.5" /> Scan
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link
            to={`/dashboards/security?view=cloud-security&account=${encodeURIComponent(connection.displayName || '')}`}
            className="gap-1.5"
          >
            <ExternalLink className="h-3.5 w-3.5" /> View Findings
          </Link>
        </Button>
      </div>
    </div>
  );
}

// ── Accounts Tab ─────────────────────────────────────────────────────────────

function AccountsTab({
  connections,
  onConnect,
  onScan,
}: {
  connections: AwsConnection[];
  onConnect: () => void;
  onScan: (conn: AwsConnection) => void;
}) {
  const { toast } = useToast();
  const validateMutation = useValidateAwsConnection();
  const disconnectMutation = useDisconnectIntegration();

  if (connections.length === 0) {
    return <CloudEmptyState onConnect={onConnect} />;
  }

  const handleValidate = (conn: AwsConnection) => {
    validateMutation.mutate(
      { id: conn.id },
      {
        onSuccess: () => toast({ title: `Validated "${conn.displayName}"` }),
        onError: (err) =>
          toast({
            title: 'Validation failed',
            description: err instanceof Error ? err.message : 'Unknown error',
            variant: 'destructive',
          }),
      },
    );
  };

  const handleDisconnect = (conn: AwsConnection) => {
    disconnectMutation.mutate(
      { id: conn.id },
      {
        onSuccess: () => toast({ title: `Disconnected "${conn.displayName}"` }),
        onError: (err) =>
          toast({
            title: 'Disconnect failed',
            description: err instanceof Error ? err.message : 'Unknown error',
            variant: 'destructive',
          }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <KpiRow connections={connections} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {connections.map((conn) => (
          <AccountCard
            key={conn.id}
            connection={conn}
            onScan={() => onScan(conn)}
            onValidate={() => handleValidate(conn)}
            onDisconnect={() => handleDisconnect(conn)}
          />
        ))}
        <button
          onClick={onConnect}
          className="border border-dashed rounded-lg p-4 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-muted/50 transition-colors min-h-[180px]"
        >
          <Plus className="h-6 w-6" />
          <span className="text-sm font-medium">Connect Account</span>
        </button>
      </div>
    </div>
  );
}

// ── Scans Tab ────────────────────────────────────────────────────────────────

interface CloudScanRun {
  runId: string;
  workflowName: string;
  status: string;
  startedAt: string;
}

function ScansTab({ connections }: { connections: AwsConnection[] }) {
  const { data: workflows = [] } = useWorkflowsSummary();
  const [runs, setRuns] = useState<CloudScanRun[]>([]);
  const [loading, setLoading] = useState(true);

  // Cloud template slugs to match
  const cloudWorkflows = useMemo(() => {
    return workflows.filter(
      (w: WorkflowSummary) =>
        /cloud security|prowler/i.test(w.name) || /container image|trivy/i.test(w.name),
    );
  }, [workflows]);

  useEffect(() => {
    if (cloudWorkflows.length === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all(
      cloudWorkflows.map(async (wf: WorkflowSummary) => {
        try {
          const result = await api.executions.listRuns({ workflowId: wf.id, limit: 20 });
          const runList = Array.isArray(result)
            ? result
            : (result as { runs?: unknown[] })?.runs || [];
          return runList.map((r: any) => ({
            runId: r.runId || r.id || '',
            workflowName: wf.name,
            status: r.status || 'unknown',
            startedAt: r.startedAt || r.createdAt || '',
          }));
        } catch {
          return [];
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const all = results
        .flat()
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
      setRuns(all);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [cloudWorkflows]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <ScanSearch className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Cloud Scans Yet</h3>
        <p className="text-muted-foreground max-w-md">
          {connections.length > 0
            ? 'Run your first cloud scan from the Accounts tab to see scan history here.'
            : 'Connect an AWS account first, then run a cloud scan.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.slice(0, 50).map((run) => (
        <Link
          key={run.runId}
          to={`/runs/${run.runId}`}
          className="flex items-center justify-between border rounded-lg p-3 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <StatusDot status={run.status} />
            <div>
              <p className="text-sm font-medium">{run.workflowName}</p>
              <p className="text-xs text-muted-foreground">
                {run.startedAt ? new Date(run.startedAt).toLocaleString() : 'Unknown time'}
              </p>
            </div>
          </div>
          <span className="text-xs text-muted-foreground capitalize">{run.status}</span>
        </Link>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'completed' || status === 'COMPLETED'
      ? 'bg-green-500'
      : status === 'running' || status === 'RUNNING'
        ? 'bg-blue-500 animate-pulse'
        : status === 'failed' || status === 'FAILED'
          ? 'bg-red-500'
          : 'bg-gray-400';
  return <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${color}`} />;
}

// ── Connect Account Dialog ───────────────────────────────────────────────────

function ConnectAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect AWS Account</DialogTitle>
          <DialogDescription>
            Set up IAM role assumption to connect your AWS account securely.
          </DialogDescription>
        </DialogHeader>
        <AwsSetupForm onCreated={() => onOpenChange(false)} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function CloudAccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'accounts';
  const { data: orgConnections = [], isLoading } = useIntegrationConnections();
  const awsConnections = useMemo(
    () =>
      orgConnections.filter((c: { provider: string }) => c.provider === 'aws') as AwsConnection[],
    [orgConnections],
  );

  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [scanTarget, setScanTarget] = useState<AwsConnection | null>(null);

  // Auto-open scan picker when navigated with scanConnectionId param
  const scanConnectionId = searchParams.get('scanConnectionId');
  useEffect(() => {
    if (scanConnectionId && awsConnections.length > 0 && !scanTarget) {
      const match = awsConnections.find((c) => c.id === scanConnectionId);
      if (match) {
        setScanTarget(match);
        // Clean up the URL param
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            next.delete('scanConnectionId');
            return next;
          },
          { replace: true },
        );
      }
    }
  }, [scanConnectionId, awsConnections, scanTarget, setSearchParams]);

  const handleTabChange = (value: string) => {
    if (value === 'accounts') {
      setSearchParams({});
    } else {
      setSearchParams({ tab: value });
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="container py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cloud Accounts</h1>
            <p className="text-muted-foreground">
              Manage your AWS accounts and run cloud security scans
            </p>
          </div>
          {awsConnections.length > 0 && (
            <Button onClick={() => setShowConnectDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Connect Account
            </Button>
          )}
        </div>

        {isLoading ? (
          <CloudLoadingSkeleton />
        ) : (
          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="accounts">Accounts</TabsTrigger>
              <TabsTrigger value="scans">Scans</TabsTrigger>
            </TabsList>
            <TabsContent value="accounts" className="mt-4">
              <AccountsTab
                connections={awsConnections}
                onConnect={() => setShowConnectDialog(true)}
                onScan={(conn) => setScanTarget(conn)}
              />
            </TabsContent>
            <TabsContent value="scans" className="mt-4">
              <ScansTab connections={awsConnections} />
            </TabsContent>
          </Tabs>
        )}
      </div>

      <ConnectAccountDialog open={showConnectDialog} onOpenChange={setShowConnectDialog} />
      <CloudScanPickerModal
        open={!!scanTarget}
        onClose={() => setScanTarget(null)}
        connection={scanTarget}
      />
    </div>
  );
}

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useIntegrationCatalog,
  useIntegrationConnections,
  useValidateAwsConnection,
  useDisconnectIntegration,
} from '@/hooks/queries/useIntegrationQueries';
import { useWorkflowsSummary } from '@/hooks/queries/useWorkflowQueries';
import { useGitHubStore } from '@/store/githubStore';
import { useToast } from '@/components/ui/use-toast';
import {
  Plus,
  Shield,
  ScanSearch,
  PlayCircle,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Container,
  MoreVertical,
  RefreshCw,
  Unlink,
  Workflow,
  AlertCircle,
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
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AwsSetupForm } from '@/components/integrations/AwsSetupForm';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';
import type { WorkflowSummary } from '@/services/api';
import { useCloudScans, type CloudScansFilters } from '@/hooks/queries/useCloudScanQueries';
import { getStatusBadgeClassFromStatus } from '@/utils/statusBadgeStyles';
import { formatRelativeTime, formatExactTime, formatDuration } from '@/components/scans/scan-utils';
import type { ExecutionStatus } from '@/schemas/execution';

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

// ── Empty State ──────────────────────────────────────────────────────────────

function CloudEmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <img src="/icons/aws.svg" alt="AWS" className="h-8 w-8" />
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
    templateSlug: 'sys-cloud-security-scan',
    name: 'Misconfiguration Scan',
    description: 'Prowler — CIS, GDPR, HIPAA benchmarks',
    icon: Shield,
  },
  {
    slug: 'container-image-scan',
    templateSlug: 'sys-container-image-scan',
    name: 'Container Image Scan',
    description: 'Trivy — ECR image vulnerability scan',
    icon: Container,
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
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [expandedScan, setExpandedScan] = useState<string | null>(null);
  const [imageRef, setImageRef] = useState('');
  const imageRefInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) fetchSystemWorkflows();
  }, [open, fetchSystemWorkflows]);

  const resolvedScans = useMemo(() => {
    return CLOUD_QUICK_SCANS.flatMap((scan) => {
      const match = systemWorkflows.find((sw) => sw.slug === scan.templateSlug);
      if (!match) return [];
      return [{ ...scan, workflowId: match.id }];
    });
  }, [systemWorkflows]);

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
  const isActive = connection.status === 'valid' || connection.status === 'active';
  const connectedAt = connection.createdAt ? formatRelativeTime(connection.createdAt) : 'Unknown';
  const lastValidated = connection.lastValidatedAt
    ? formatRelativeTime(connection.lastValidatedAt)
    : 'Never';

  return (
    <Card
      className={cn(
        'overflow-hidden transition-shadow hover:shadow-md',
        'border-orange-200 dark:border-orange-800',
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0 bg-[#232F3E] p-1.5">
              <img src="/icons/aws-dark.svg" alt="AWS" className="h-full w-full object-contain" />
            </div>
            <div>
              <CardTitle className="text-base">{connection.displayName || 'AWS Account'}</CardTitle>
              <CardDescription className="text-xs">
                {accountId ? `Account ${accountId}` : 'AWS'}
                {region ? ` · ${region}` : ''}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isActive ? 'default' : 'secondary'} className="text-xs">
              {isActive ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Connected
                </>
              ) : (
                connection.status || 'Unknown'
              )}
            </Badge>
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
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          {accountId && (
            <div>
              <span className="text-muted-foreground">Account ID</span>
              <p className="font-medium font-mono text-xs">{accountId}</p>
            </div>
          )}
          {region && (
            <div>
              <span className="text-muted-foreground">Region</span>
              <p className="font-medium">{region}</p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Connected</span>
            <p className="font-medium">{connectedAt}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Last validated</span>
            <p className="font-medium">{lastValidated}</p>
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={onScan}>
            <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
            Scan
          </Button>
          <Button variant="outline" size="sm" className="flex-1" asChild>
            <Link
              to={`/dashboards/security?view=cloud-security&account=${encodeURIComponent(connection.displayName || '')}`}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              View Findings
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
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
  const { data: catalog = [] } = useIntegrationCatalog();

  const awsEntry = useMemo(() => catalog.find((c) => c.id === 'aws'), [catalog]);
  const sections = awsEntry?.setupInstructions?.sections;
  const hasSetupSections = sections && sections.length > 0;

  const healthyCount = useMemo(
    () => connections.filter((c) => c.status === 'valid' || c.status === 'active').length,
    [connections],
  );

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
    <div className="space-y-8">
      {/* Connections Section */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          Connections
          <span className="text-sm font-normal text-muted-foreground ml-2">
            ({connections.length})
          </span>
        </h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {connections.map((conn) => (
            <AccountCard
              key={conn.id}
              connection={conn}
              onScan={() => onScan(conn)}
              onValidate={() => handleValidate(conn)}
              onDisconnect={() => handleDisconnect(conn)}
            />
          ))}
          <Card
            className="overflow-hidden border-2 border-dashed hover:border-primary/50 hover:bg-muted/30 transition-colors cursor-pointer"
            onClick={onConnect}
          >
            <CardContent className="p-4 h-full flex flex-col items-center justify-center gap-2 min-h-[160px]">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Plus className="h-5 w-5 text-primary" />
              </div>
              <span className="text-sm font-medium text-muted-foreground">Add Connection</span>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Two-column bottom: Setup Instructions + Info Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left column: Setup Instructions */}
        {hasSetupSections && (
          <div className="lg:col-span-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Setup</CardTitle>
                <CardDescription>Choose a scenario that matches your environment.</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue={sections[0]?.scenario} className="w-full">
                  <TabsList className="w-full h-auto flex-wrap">
                    {sections.map((section: { scenario: string; title: string }) => (
                      <TabsTrigger
                        key={section.scenario}
                        value={section.scenario}
                        className="flex-1 text-xs"
                      >
                        {section.title}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {sections.map((section: { scenario: string; steps: string[] }) => (
                    <TabsContent key={section.scenario} value={section.scenario} className="mt-4">
                      <ol className="space-y-3">
                        {section.steps.map((step: string, stepIdx: number) => (
                          <li
                            key={stepIdx}
                            className="flex gap-3 text-sm text-muted-foreground leading-relaxed"
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                              {stepIdx + 1}
                            </span>
                            <span className="pt-0.5">{renderStepText(step)}</span>
                          </li>
                        ))}
                      </ol>
                    </TabsContent>
                  ))}
                </Tabs>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Right column: Info Sidebar */}
        <div className={hasSetupSections ? 'lg:col-span-2' : 'lg:col-span-5'}>
          <div className="space-y-4">
            {/* Documentation link */}
            {awsEntry?.docsUrl && (
              <Card>
                <CardContent className="p-4">
                  <a
                    href={awsEntry.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 text-sm font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="h-4 w-4 flex-shrink-0" />
                    View Amazon Web Services Documentation
                  </a>
                </CardContent>
              </Card>
            )}

            {/* Connection stats */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <h3 className="text-sm font-semibold">Connection Summary</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md bg-muted/50 p-3 text-center">
                    <p className="text-2xl font-bold">{connections.length}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                  <div className="rounded-md bg-muted/50 p-3 text-center">
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {healthyCount}
                    </p>
                    <p className="text-xs text-muted-foreground">Healthy</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Auth methods */}
            {awsEntry?.authMethods && awsEntry.authMethods.length > 0 && (
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Supported Auth Methods</h3>
                  <div className="flex flex-wrap gap-2">
                    {awsEntry.authMethods.map((method: { type: string; label: string }) => (
                      <Badge key={method.type} variant="secondary" className="gap-1.5">
                        <Shield className="h-3 w-3" />
                        {method.label}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Scans Tab ────────────────────────────────────────────────────────────────

const ALL_STATUSES_VALUE = '__all__';

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: ALL_STATUSES_VALUE, label: 'All statuses' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'TIMED_OUT', label: 'Timed Out' },
];

const LIVE_STATUSES: ReadonlySet<string> = new Set(['QUEUED', 'RUNNING', 'AWAITING_INPUT']);

function ScansTab({ connections }: { connections: AwsConnection[] }) {
  const navigate = useNavigate();
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const systemWorkflowsLoading = useGitHubStore((s) => s.systemWorkflowsLoading);
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUSES_VALUE);

  // Fetch systemWorkflows on mount so cloud workflow IDs are available
  useEffect(() => {
    fetchSystemWorkflows();
  }, [fetchSystemWorkflows]);

  const activeStatus =
    statusFilter === ALL_STATUSES_VALUE ? undefined : (statusFilter as ExecutionStatus);

  const filters: CloudScansFilters = useMemo(() => ({ status: activeStatus }), [activeStatus]);

  const { data, isLoading, isError, error, isFetching, dataUpdatedAt, refetch } =
    useCloudScans(filters);

  const runs = data?.runs ?? [];
  const liveCount = data?.liveCount ?? 0;
  const successRate = data?.successRate ?? 0;
  const totalFetched = data?.totalFetched ?? 0;

  // Determine which cloud workflow IDs we have
  const hasCloudWorkflows = useMemo(
    () =>
      systemWorkflows.some(
        (sw) =>
          sw.slug && new Set(['sys-cloud-security-scan', 'sys-container-image-scan']).has(sw.slug),
      ),
    [systemWorkflows],
  );

  // ── Empty state hierarchy ──────────────────────────────────────────────────

  // 1. No AWS connections
  if (connections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <img src="/icons/aws.svg" alt="AWS" className="h-8 w-8" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Connect an AWS Account First</h3>
        <p className="text-muted-foreground max-w-md">
          Connect an AWS account from the Accounts tab to start running cloud scans.
        </p>
      </div>
    );
  }

  // 2. Loading system workflows
  if (systemWorkflowsLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  // 3. No cloud workflows found
  if (!hasCloudWorkflows) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Workflow className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No Cloud Scan Workflows</h3>
        <p className="text-muted-foreground max-w-md mb-4">
          No cloud scan workflows found. Create one from Templates first.
        </p>
        <Button variant="outline" asChild>
          <Link to="/workflows">Browse Templates</Link>
        </Button>
      </div>
    );
  }

  // 4. First query loading
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  // 5. Error state
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-4 mb-4">
          <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Failed to Load Scans</h3>
        <p className="text-muted-foreground max-w-md mb-4">
          {error instanceof Error ? error.message : 'An unexpected error occurred.'}
        </p>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  // Separate live runs from completed
  const liveRuns = runs.filter((r) => LIVE_STATUSES.has(r.status));
  const tableRuns = runs;

  const updatedAgo = dataUpdatedAt
    ? formatRelativeTime(new Date(dataUpdatedAt).toISOString())
    : null;

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="flex items-center gap-3 flex-wrap">
        {liveCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-blue-500/10 text-blue-700 border border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-700/50">
            <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            {liveCount} live
          </span>
        )}
        {runs.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-muted text-muted-foreground border">
            {successRate}% success rate
          </span>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
          <SelectTrigger className="w-[160px] h-9">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2 ml-auto">
          {updatedAgo && (
            <span className="text-xs text-muted-foreground">Updated {updatedAgo}</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 w-8 p-0"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Live runs section */}
      {liveRuns.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Live Scans</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {liveRuns.map((run) => {
              const elapsed = run.startTime
                ? formatDuration(run.startTime, new Date().toISOString())
                : null;
              return (
                <div
                  key={run.id}
                  className="rounded-lg border border-blue-200 dark:border-blue-700/50 bg-blue-500/5 p-3 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
                    <span className="text-sm font-medium truncate">{run.workflowName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Started {formatRelativeTime(run.startTime)}
                      {elapsed ? ` \u00b7 Elapsed ${elapsed}` : ''}
                    </span>
                    <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                      <Link to={`/runs/${run.id}`}>Open Run</Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. No runs match filter */}
      {runs.length === 0 && activeStatus && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <ScanSearch className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No Runs Match Your Filter</h3>
          <p className="text-muted-foreground max-w-md mb-4">
            No cloud scan runs with status &ldquo;
            {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? statusFilter}&rdquo;
            were found.
          </p>
          <Button variant="outline" onClick={() => setStatusFilter(ALL_STATUSES_VALUE)}>
            Reset Filter
          </Button>
        </div>
      )}

      {/* 7. No runs, no filter */}
      {runs.length === 0 && !activeStatus && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <ScanSearch className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No Cloud Scans Yet</h3>
          <p className="text-muted-foreground max-w-md">
            Run your first cloud scan from the Accounts tab to see scan history here.
          </p>
        </div>
      )}

      {/* 8. Runs table */}
      {runs.length > 0 && (
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Scan Type</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableRuns.map((run) => {
                const duration = LIVE_STATUSES.has(run.status)
                  ? null
                  : formatDuration(run.startTime, run.endTime ?? null);
                return (
                  <TableRow
                    key={run.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/runs/${run.id}`)}
                  >
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={getStatusBadgeClassFromStatus(run.status)}
                      >
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{run.workflowName}</span>
                        {run.workflowVersion != null && (
                          <span className="text-xs text-muted-foreground">
                            v{run.workflowVersion}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm">{formatRelativeTime(run.startTime)}</span>
                        </TooltipTrigger>
                        <TooltipContent>{formatExactTime(run.startTime)}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-sm">
                      {duration ?? <span className="text-muted-foreground">&mdash;</span>}
                    </TableCell>
                    <TableCell className="text-sm">{run.triggerLabel ?? run.triggerType}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/runs/${run.id}`}
                        className="text-sm text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Open Run
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TooltipProvider>
      )}

      {/* Pagination / count */}
      {runs.length > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
          <span>
            Showing {runs.length} cloud scan run{runs.length !== 1 ? 's' : ''}
          </span>
          {totalFetched >= (filters.limit ?? 100) && (
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
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
        {isLoading ? (
          <CloudLoadingSkeleton />
        ) : (
          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="accounts">
                <Shield className="h-4 w-4 mr-2" />
                Accounts
              </TabsTrigger>
              <TabsTrigger value="scans">
                <ScanSearch className="h-4 w-4 mr-2" />
                Scans
              </TabsTrigger>
            </TabsList>
            <TabsContent value="accounts" className="mt-6">
              <AccountsTab
                connections={awsConnections}
                onConnect={() => setShowConnectDialog(true)}
                onScan={(conn) => setScanTarget(conn)}
              />
            </TabsContent>
            <TabsContent value="scans" className="mt-6">
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

// ── Setup Instructions Section ────────────────────────────────────────────────

function renderStepText(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-muted px-1.5 py-0.5 text-[0.8em] font-mono break-all">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

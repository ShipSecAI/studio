import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
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
  Filter,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  CalendarClock,
  Zap,
  Webhook,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
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
import {
  useCloudScans,
  useCloudScansSummaries,
  type CloudScansFilters,
  type SeveritySummary,
} from '@/hooks/queries/useCloudScanQueries';
import {
  formatRelativeTime,
  formatExactTime,
  formatDuration,
  getExecutionStatusDisplay,
} from '@/components/scans/scan-utils';
import { CloudScanDetailPanel } from '@/components/scans/CloudScanDetailPanel';
import type { ExecutionStatus } from '@/schemas/execution';
import { useIsMobile } from '@/hooks/useIsMobile';
import { CloudScanScheduleDialog } from '@/components/security/CloudScanScheduleDialog';

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
  onSchedule,
  onValidate,
  onDisconnect,
}: {
  connection: AwsConnection;
  onScan: () => void;
  onSchedule: () => void;
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
          <div className="flex flex-1">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 rounded-r-none border-r-0"
              onClick={onScan}
              aria-label="Scan"
            >
              <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
              Scan
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="px-1.5 rounded-l-none"
                  aria-label="More scan options"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={onSchedule}>
                  <CalendarClock className="mr-2 h-4 w-4" />
                  Schedule scan
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
  onSchedule,
}: {
  connections: AwsConnection[];
  onConnect: () => void;
  onScan: (conn: AwsConnection) => void;
  onSchedule: (conn: AwsConnection) => void;
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
              onSchedule={() => onSchedule(conn)}
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
const SCAN_PAGE_SIZE = 25;

type CloudSortColumn = 'time' | 'status' | 'scanType' | 'source' | 'duration' | 'findings';
type SortDirection = 'asc' | 'desc';

function getTriggerIcon(triggerType: string | undefined) {
  switch (triggerType) {
    case 'manual':
      return React.createElement(PlayCircle, { className: 'h-3.5 w-3.5' });
    case 'schedule':
      return React.createElement(CalendarClock, { className: 'h-3.5 w-3.5' });
    case 'api':
      return React.createElement(Zap, { className: 'h-3.5 w-3.5' });
    case 'webhook':
      return React.createElement(Webhook, { className: 'h-3.5 w-3.5' });
    default:
      return React.createElement(PlayCircle, { className: 'h-3.5 w-3.5' });
  }
}

function getTriggerLabel(triggerType: string | undefined) {
  switch (triggerType) {
    case 'manual':
      return 'Manual';
    case 'schedule':
      return 'Schedule';
    case 'api':
      return 'API';
    case 'webhook':
      return 'Webhook';
    default:
      return triggerType ?? 'Manual';
  }
}

function CloudSortableHeader({
  column,
  label,
  currentSort,
  currentDir,
  onSort,
  className,
}: {
  column: CloudSortColumn;
  label: string;
  currentSort: CloudSortColumn;
  currentDir: SortDirection;
  onSort: (col: CloudSortColumn) => void;
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

function FindingsBadges({ summary }: { summary?: SeveritySummary }) {
  if (!summary) {
    return <span className="text-muted-foreground text-xs">&mdash;</span>;
  }
  const items = [
    { label: 'C', count: summary.critical, color: 'bg-red-600' },
    { label: 'H', count: summary.high, color: 'bg-orange-500' },
    { label: 'M', count: summary.medium, color: 'bg-yellow-500' },
    { label: 'L', count: summary.low, color: 'bg-blue-500' },
  ].filter((item) => item.count > 0);

  if (items.length === 0) {
    return <span className="text-muted-foreground text-xs">No findings</span>;
  }

  return (
    <div className="flex gap-1">
      {items.map((item) => (
        <Badge
          key={item.label}
          variant="outline"
          className={`${item.color} text-white border-none text-xs px-1.5`}
        >
          {item.label}:{item.count}
        </Badge>
      ))}
    </div>
  );
}

export function ScansTab({ connections }: { connections: AwsConnection[] }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const systemWorkflowsLoading = useGitHubStore((s) => s.systemWorkflowsLoading);
  const selectedRunId = searchParams.get('scan');
  const isPanelOpen = Boolean(selectedRunId);
  const showList = !isPanelOpen || !isMobile;
  const showPanel = isPanelOpen;

  // URL-driven state
  const statusFilter = searchParams.get('status') || ALL_STATUSES_VALUE;
  const sortColumn = (searchParams.get('scansSort') as CloudSortColumn) || 'time';
  const sortDirection = (searchParams.get('scansDir') as SortDirection) || 'desc';
  const currentPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

  // Fetch systemWorkflows on mount so cloud workflow IDs are available
  useEffect(() => {
    fetchSystemWorkflows();
  }, [fetchSystemWorkflows]);

  const activeStatus =
    statusFilter === ALL_STATUSES_VALUE ? undefined : (statusFilter as ExecutionStatus);

  const filters: CloudScansFilters = useMemo(() => ({ status: activeStatus }), [activeStatus]);

  const { data, isLoading, isError, error, isFetching, refetch } = useCloudScans(filters);

  const allRuns = data?.runs ?? [];

  // Fetch findings summaries for visible runs
  const allRunIds = useMemo(() => allRuns.map((r) => r.id), [allRuns]);
  const { data: summariesData } = useCloudScansSummaries(allRunIds);

  // Sorting
  const sortedRuns = useMemo(() => {
    const sorted = [...allRuns];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortColumn) {
        case 'time':
          cmp = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
        case 'scanType':
          cmp = (a.workflowName ?? '').localeCompare(b.workflowName ?? '');
          break;
        case 'source':
          cmp = (a.triggerType ?? '').localeCompare(b.triggerType ?? '');
          break;
        case 'duration':
          cmp = (a.duration ?? 0) - (b.duration ?? 0);
          break;
        case 'findings': {
          const sumA = summariesData
            ? Object.values(summariesData[a.id] ?? {}).reduce((s, n) => s + n, 0)
            : 0;
          const sumB = summariesData
            ? Object.values(summariesData[b.id] ?? {}).reduce((s, n) => s + n, 0)
            : 0;
          cmp = sumA - sumB;
          if (cmp === 0) {
            cmp = new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
          }
          break;
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [allRuns, sortColumn, sortDirection, summariesData]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedRuns.length / SCAN_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageRuns = sortedRuns.slice((safePage - 1) * SCAN_PAGE_SIZE, safePage * SCAN_PAGE_SIZE);
  const liveRuns = allRuns.filter((r) => LIVE_STATUSES.has(r.status));

  // Determine which cloud workflow IDs we have
  const hasCloudWorkflows = useMemo(
    () =>
      systemWorkflows.some(
        (sw) =>
          sw.slug && new Set(['sys-cloud-security-scan', 'sys-container-image-scan']).has(sw.slug),
      ),
    [systemWorkflows],
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleStatusChange = (v: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === ALL_STATUSES_VALUE) next.delete('status');
        else next.set('status', v);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  const handleSort = (col: CloudSortColumn) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (sortColumn === col) {
          next.set('scansDir', sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
          next.set('scansSort', col);
          next.set('scansDir', 'desc');
        }
        return next;
      },
      { replace: true },
    );
  };

  const handleSelectRun = (runId: string) => {
    setParam('scan', runId);
  };

  const handleClosePanel = () => {
    setParam('scan', null);
  };

  const handlePageChange = (page: number) => {
    setParam('page', page > 1 ? String(page) : null);
  };

  // ── Empty state hierarchy ──────────────────────────────────────────────────

  // 1. No AWS connections
  if (connections.length === 0 && !isPanelOpen) {
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
  if (systemWorkflowsLoading && !isPanelOpen) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  // 3. No cloud workflows found
  if (!hasCloudWorkflows && !isPanelOpen) {
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
  if (isLoading && !isPanelOpen) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
    );
  }

  // 5. Error state
  if (isError && !isPanelOpen) {
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

  return (
    <div
      className={cn('flex', isPanelOpen && 'border rounded-lg overflow-hidden')}
      style={{
        height: isPanelOpen ? 'calc(100vh - 300px)' : 'auto',
        minHeight: isPanelOpen ? '420px' : undefined,
      }}
    >
      {showList && (
        <div
          className={cn(
            'flex flex-col overflow-hidden',
            isPanelOpen ? 'w-[460px] flex-shrink-0 border-r' : 'w-full',
          )}
        >
          <div className={cn('space-y-4 flex-1', isPanelOpen ? 'p-4 overflow-y-auto' : '')}>
            {/* Filter bar */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Filters:</span>
              </div>
              <Select value={statusFilter} onValueChange={handleStatusChange}>
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
              {activeStatus && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => handleStatusChange(ALL_STATUSES_VALUE)}
                >
                  Clear
                </Button>
              )}
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="h-8 w-8 p-0"
                >
                  <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
                </Button>
              </div>
            </div>

            {/* Results count */}
            {!isLoading && !isError && allRuns.length > 0 && (
              <div className="text-sm text-muted-foreground">
                {sortedRuns.length} cloud scan{sortedRuns.length !== 1 ? 's' : ''}
              </div>
            )}

            {/* Live runs section */}
            {liveRuns.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  Live Scans ({liveRuns.length})
                </h4>
                <div
                  className={cn(
                    'grid grid-cols-1 gap-3',
                    !isPanelOpen && 'md:grid-cols-2 lg:grid-cols-3',
                  )}
                >
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
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm font-medium truncate">
                                {run.workflowName}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">{run.workflowName}</TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">
                            Started {formatRelativeTime(run.startTime)}
                            {elapsed ? ` \u00b7 Elapsed ${elapsed}` : ''}
                          </span>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleSelectRun(run.id)}
                            >
                              View
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                              <Link to={`/runs/${run.id}`}>Open Run</Link>
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {isLoading && (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-14 rounded-lg" />
                ))}
              </div>
            )}

            {isError && (
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
            )}

            {/* 6. No runs match filter */}
            {!isLoading && !isError && allRuns.length === 0 && activeStatus && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="rounded-full bg-muted p-4 mb-4">
                  <ScanSearch className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No Runs Match Your Filter</h3>
                <p className="text-muted-foreground max-w-md mb-4">
                  No cloud scan runs with status &ldquo;
                  {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? statusFilter}
                  &rdquo; were found.
                </p>
                <Button variant="outline" onClick={() => handleStatusChange(ALL_STATUSES_VALUE)}>
                  Reset Filter
                </Button>
              </div>
            )}

            {/* 7. No runs, no filter */}
            {!isLoading && !isError && allRuns.length === 0 && !activeStatus && (
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

            {/* 8. Compact list (panel open) */}
            {!isLoading && !isError && allRuns.length > 0 && isPanelOpen && (
              <div className="space-y-1">
                {pageRuns.map((run) => {
                  const statusDisplay = getExecutionStatusDisplay(run.status);
                  const runSummary = summariesData?.[run.id];
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => handleSelectRun(run.id)}
                      className={cn(
                        'w-full rounded-lg border p-3 text-left hover:bg-muted/40 transition-colors',
                        selectedRunId === run.id && 'bg-accent border-primary/30',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={statusDisplay.color}>{statusDisplay.icon}</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm font-medium truncate">
                                  {run.workflowName}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">{run.workflowName}</TooltipContent>
                            </Tooltip>
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2">
                            <span>{formatRelativeTime(run.startTime)}</span>
                            {!LIVE_STATUSES.has(run.status) && run.endTime && (
                              <>
                                <span className="text-muted-foreground/50">&middot;</span>
                                <span>{formatDuration(run.startTime, run.endTime)}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <FindingsBadges summary={runSummary} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 8. Full table (no panel) */}
            {!isLoading && !isError && allRuns.length > 0 && !isPanelOpen && (
              <TooltipProvider>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <CloudSortableHeader
                        column="time"
                        label="Time"
                        currentSort={sortColumn}
                        currentDir={sortDirection}
                        onSort={handleSort}
                      />
                      <CloudSortableHeader
                        column="status"
                        label="Status"
                        currentSort={sortColumn}
                        currentDir={sortDirection}
                        onSort={handleSort}
                      />
                      <CloudSortableHeader
                        column="scanType"
                        label="Scan Type"
                        currentSort={sortColumn}
                        currentDir={sortDirection}
                        onSort={handleSort}
                      />
                      <CloudSortableHeader
                        column="source"
                        label="Source"
                        currentSort={sortColumn}
                        currentDir={sortDirection}
                        onSort={handleSort}
                      />
                      <CloudSortableHeader
                        column="duration"
                        label="Duration"
                        currentSort={sortColumn}
                        currentDir={sortDirection}
                        onSort={handleSort}
                      />
                      <CloudSortableHeader
                        column="findings"
                        label="Findings"
                        currentSort={sortColumn}
                        currentDir={sortDirection}
                        onSort={handleSort}
                      />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRuns.map((run) => {
                      const duration = LIVE_STATUSES.has(run.status)
                        ? null
                        : formatDuration(run.startTime, run.endTime ?? null);
                      const statusDisplay = getExecutionStatusDisplay(run.status);
                      const runSummary = summariesData?.[run.id];
                      return (
                        <TableRow
                          key={run.id}
                          className="cursor-pointer"
                          onClick={() => handleSelectRun(run.id)}
                        >
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-sm">{formatRelativeTime(run.startTime)}</span>
                              </TooltipTrigger>
                              <TooltipContent>{formatExactTime(run.startTime)}</TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <div className={cn('flex items-center gap-1.5', statusDisplay.color)}>
                              {statusDisplay.icon}
                              <span className="text-sm">{statusDisplay.label}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{run.workflowName}</span>
                              {run.workflowVersion != null && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  v{run.workflowVersion}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              {getTriggerIcon(run.triggerType)}
                              <span>{getTriggerLabel(run.triggerType)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {duration ?? <span className="text-muted-foreground">&mdash;</span>}
                          </TableCell>
                          <TableCell>
                            <FindingsBadges summary={runSummary} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TooltipProvider>
            )}

            {/* Pagination */}
            {!isLoading && !isError && sortedRuns.length > SCAN_PAGE_SIZE && (
              <div className="flex items-center justify-between text-sm text-muted-foreground pt-2">
                <span>
                  Page {safePage} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => handlePageChange(safePage - 1)}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => handlePageChange(safePage + 1)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showPanel && selectedRunId && (
        <div className="flex-1 min-w-0 overflow-hidden bg-background">
          <CloudScanDetailPanel runId={selectedRunId} onClose={handleClosePanel} />
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
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = location.pathname.startsWith('/cloud/scans') ? 'scans' : 'accounts';

  const setActiveTab = (tab: string) => {
    const pathMap: Record<string, string> = {
      accounts: '/cloud/accounts',
      scans: '/cloud/scans',
    };
    navigate(pathMap[tab] ?? '/cloud/accounts');
  };

  const { data: orgConnections = [], isLoading } = useIntegrationConnections();
  const awsConnections = useMemo(
    () =>
      orgConnections.filter((c: { provider: string }) => c.provider === 'aws') as AwsConnection[],
    [orgConnections],
  );

  const [showConnectDialog, setShowConnectDialog] = useState(false);
  const [scanTarget, setScanTarget] = useState<AwsConnection | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<AwsConnection | null>(null);

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

  return (
    <div className="flex-1 overflow-auto">
      <div className="container py-6 space-y-6">
        {isLoading ? (
          <CloudLoadingSkeleton />
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
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
                onSchedule={(conn) => setScheduleTarget(conn)}
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
      <CloudScanScheduleDialog
        open={!!scheduleTarget}
        onClose={() => setScheduleTarget(null)}
        connection={scheduleTarget}
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

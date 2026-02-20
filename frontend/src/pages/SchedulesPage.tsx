import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Cloud,
  Code,
  History,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Edit3,
  Plus,
  Settings,
  Trash2,
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import {
  useSchedules,
  usePauseSchedule,
  useResumeSchedule,
  useRunSchedule,
  useDeleteSchedule,
} from '@/hooks/queries/useScheduleQueries';
import { useWorkflowsSummary } from '@/hooks/queries/useWorkflowQueries';
import { useQueryClient } from '@tanstack/react-query';
import {
  ScheduleEditorDrawer,
  type WorkflowOption,
} from '@/components/schedules/ScheduleEditorDrawer';
import type { WorkflowSchedule } from '@shipsec/shared';
import { useGitHubStore } from '@/store/githubStore';
import { CloudScanScheduleDialog } from '@/components/security/CloudScanScheduleDialog';
import { CodeScanScheduleDialog } from '@/components/security/CodeScanScheduleDialog';
import { CODE_SCHEDULE_SCANS } from '@/components/security/constants';

const CLOUD_SCAN_TYPES = [
  {
    slug: 'cloud-security-scan',
    templateSlug: 'sys-cloud-security-scan',
    name: 'Misconfiguration Scan',
    description: 'Prowler — CIS, GDPR, HIPAA benchmarks',
  },
  {
    slug: 'container-image-scan',
    templateSlug: 'sys-container-image-scan',
    name: 'Container Image Scan',
    description: 'Trivy — ECR image vulnerability scan',
  },
];

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'error', label: 'Error' },
];

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  paused: 'secondary',
  error: 'destructive',
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    timeZoneName: 'short',
  }).format(date);
};

const getWorkflowName = (workflowId: string, workflows: WorkflowOption[]): string => {
  const match = workflows.find((workflow) => workflow.id === workflowId);
  return match?.name ?? 'Unknown workflow';
};

export function SchedulesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [actionState, setActionState] = useState<Record<string, 'run' | 'toggle'>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');
  const [activeSchedule, setActiveSchedule] = useState<WorkflowSchedule | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [cloudScheduleOpen, setCloudScheduleOpen] = useState(false);
  const [cloudScanSlug, setCloudScanSlug] = useState<string | undefined>();
  const [codeScheduleOpen, setCodeScheduleOpen] = useState(false);
  const [codeScanId, setCodeScanId] = useState<string | undefined>();

  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);

  useEffect(() => {
    if (chooserOpen) fetchSystemWorkflows();
  }, [chooserOpen, fetchSystemWorkflows]);

  const resolvedCloudScans = useMemo(() => {
    return CLOUD_SCAN_TYPES.flatMap((scan) => {
      const match = systemWorkflows.find((sw) => sw.slug === scan.templateSlug);
      if (!match) return [];
      return [scan];
    });
  }, [systemWorkflows]);

  const resolvedCodeScans = useMemo(() => {
    return CODE_SCHEDULE_SCANS.flatMap((scan) => {
      const match = systemWorkflows.find((sw) => sw.slug === scan.templateSlug);
      if (!match) return [];
      return [scan];
    });
  }, [systemWorkflows]);

  // Local filter state (search is client-side, workflowId & status go to the query)
  const initialWorkflowId = searchParams.get('workflowId') || null;
  const [filters, setFilters] = useState<{
    search: string;
    status: string;
    workflowId: string | null;
  }>({ search: '', status: 'all', workflowId: initialWorkflowId });

  const {
    data: schedules = [],
    isLoading,
    error: schedulesError,
  } = useSchedules({
    workflowId: filters.workflowId,
    status: filters.status as any,
  });
  const error = schedulesError?.message ?? null;

  const { data: workflowsRaw = [], isLoading: workflowsLoading } = useWorkflowsSummary();
  const workflowOptions: WorkflowOption[] = useMemo(
    () => workflowsRaw.map((w: any) => ({ id: w.id, name: w.name ?? 'Untitled workflow' })),
    [workflowsRaw],
  );

  const pauseScheduleMutation = usePauseSchedule();
  const resumeScheduleMutation = useResumeSchedule();
  const runScheduleMutation = useRunSchedule();
  const deleteScheduleMutation = useDeleteSchedule();

  const filteredSchedules = useMemo(() => {
    const query = filters.search.trim().toLowerCase();

    return schedules.filter((schedule) => {
      const workflowName = getWorkflowName(schedule.workflowId, workflowOptions);
      const matchesSearch =
        query.length === 0 ||
        schedule.name.toLowerCase().includes(query) ||
        workflowName.toLowerCase().includes(query);

      return matchesSearch;
    });
  }, [filters.search, schedules, workflowOptions]);

  const markAction = (id: string, action: 'run' | 'toggle') => {
    setActionState((state) => ({ ...state, [id]: action }));
  };

  const clearAction = (id: string) => {
    setActionState((state) => {
      const { [id]: _removed, ...rest } = state;
      return rest;
    });
  };

  const handleWorkflowFilterChange = (value: string) => {
    const workflowId = value === 'all' ? null : value;
    setFilters((prev) => ({ ...prev, workflowId }));
    const nextParams = new URLSearchParams(searchParams);
    if (workflowId) {
      nextParams.set('workflowId', workflowId);
    } else {
      nextParams.delete('workflowId');
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleStatusFilterChange = (value: string) => {
    setFilters((prev) => ({ ...prev, status: value as typeof filters.status }));
  };

  const openCreateDrawer = () => {
    setEditorMode('create');
    setActiveSchedule(null);
    setEditorOpen(true);
  };

  const openEditDrawer = (schedule: WorkflowSchedule) => {
    setEditorMode('edit');
    setActiveSchedule(schedule);
    setEditorOpen(true);
  };

  const handleScheduleSaved = (savedSchedule: WorkflowSchedule, mode: 'create' | 'edit') => {
    queryClient.invalidateQueries({ queryKey: ['schedules'] });
    toast({
      title: mode === 'create' ? 'Schedule created' : 'Schedule updated',
      description:
        mode === 'create'
          ? `"${savedSchedule.name}" is now active.`
          : `"${savedSchedule.name}" has been updated.`,
    });
  };

  const handlePauseResume = async (schedule: WorkflowSchedule) => {
    markAction(schedule.id, 'toggle');
    try {
      if (schedule.status === 'active') {
        await pauseScheduleMutation.mutateAsync(schedule.id);
        toast({
          title: 'Schedule paused',
          description: `"${schedule.name}" has been paused.`,
        });
      } else {
        await resumeScheduleMutation.mutateAsync(schedule.id);
        toast({
          title: 'Schedule resumed',
          description: `"${schedule.name}" is active again.`,
        });
      }
    } catch (err) {
      toast({
        title: 'Schedule update failed',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      clearAction(schedule.id);
    }
  };

  const handleRunNow = async (schedule: WorkflowSchedule) => {
    markAction(schedule.id, 'run');
    try {
      await runScheduleMutation.mutateAsync(schedule.id);
      toast({
        title: 'Run requested',
        description: `Scheduled cadence "${schedule.name}" is executing now.`,
      });
    } catch (err) {
      toast({
        title: 'Failed to trigger schedule',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      clearAction(schedule.id);
    }
  };

  const handleRefresh = async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: ['schedules'] });
      toast({
        title: 'Schedules refreshed',
        description: 'Latest schedule statuses have been loaded.',
      });
    } catch (err) {
      toast({
        title: 'Refresh failed',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    }
  };

  const handleEdit = (schedule: WorkflowSchedule) => {
    openEditDrawer(schedule);
  };

  const handleDelete = async (schedule: WorkflowSchedule) => {
    if (
      !confirm(`Are you sure you want to delete "${schedule.name}"? This action cannot be undone.`)
    ) {
      return;
    }
    markAction(schedule.id, 'run');
    try {
      await deleteScheduleMutation.mutateAsync(schedule.id);
      toast({
        title: 'Schedule deleted',
        description: `"${schedule.name}" has been deleted.`,
      });
    } catch (err) {
      toast({
        title: 'Failed to delete schedule',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      clearAction(schedule.id);
    }
  };

  const isActionBusy = (id: string) => Boolean(actionState[id]);
  const renderStatusBadge = (status: string) => {
    const variant = STATUS_VARIANTS[status] || 'outline';
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    return <Badge variant={variant}>{label}</Badge>;
  };

  const hasData = filteredSchedules.length > 0;

  return (
    <TooltipProvider>
      <div className="flex-1 bg-background">
        <div className="container mx-auto px-3 md:px-4 py-4 md:py-8 space-y-4 md:space-y-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex-1 space-y-2">
              <label className="text-xs uppercase text-muted-foreground flex items-center gap-2">
                <Search className="h-3.5 w-3.5" />
                Search schedules or workflows
              </label>
              <Input
                placeholder="Filter by schedule or workflow"
                value={filters.search}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, search: event.target.value }))
                }
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button variant="default" className="gap-2" onClick={() => setChooserOpen(true)}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New schedule</span>
              </Button>
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center justify-between">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={handleRefresh}>
                Try again
              </Button>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs uppercase text-muted-foreground">Status</label>
              <Select value={filters.status} onValueChange={handleStatusFilterChange}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase text-muted-foreground">Workflow</label>
              <Select
                value={filters.workflowId ?? 'all'}
                onValueChange={handleWorkflowFilterChange}
                disabled={workflowsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All workflows" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All workflows</SelectItem>
                  {workflowOptions.map((workflow) => (
                    <SelectItem key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="overflow-hidden">
              <Table className="table-fixed w-full">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[30%]">Name</TableHead>
                    <TableHead className="w-[15%] hidden md:table-cell">Workflow</TableHead>
                    <TableHead className="w-[14%] hidden lg:table-cell">Cadence</TableHead>
                    <TableHead className="w-[11%] hidden sm:table-cell">Next run</TableHead>
                    <TableHead className="w-[11%] hidden lg:table-cell">Last run</TableHead>
                    <TableHead className="w-[7%]">Status</TableHead>
                    <TableHead className="text-right w-[12%]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && !hasData
                    ? Array.from({ length: 4 }).map((_, index) => (
                        <TableRow key={`skeleton-${index}`}>
                          {Array.from({ length: 7 }).map((_, cell) => (
                            <TableCell key={`cell-${cell}`}>
                              <Skeleton className="h-5 w-full" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    : null}
                  {!isLoading && hasData
                    ? filteredSchedules.map((schedule) => {
                        const workflowName = getWorkflowName(schedule.workflowId, workflowOptions);
                        const cadenceLabel = schedule.humanLabel
                          ? `${schedule.humanLabel} (${schedule.cronExpression})`
                          : schedule.cronExpression;

                        const isPaused = schedule.status !== 'active';

                        return (
                          <TableRow key={schedule.id}>
                            <TableCell className="font-medium">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex flex-col min-w-0">
                                    <span className="truncate">{schedule.name}</span>
                                    {schedule.description && (
                                      <span className="text-xs text-muted-foreground truncate">
                                        {schedule.description}
                                      </span>
                                    )}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-xs">
                                  <p className="font-medium">{schedule.name}</p>
                                  {schedule.description && (
                                    <p className="text-xs text-muted-foreground">
                                      {schedule.description}
                                    </p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex flex-col min-w-0">
                                    <span className="font-medium truncate">{workflowName}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-xs">
                                  <p className="font-medium">{workflowName}</p>
                                  <p className="text-xs text-muted-foreground font-mono">
                                    {schedule.workflowId}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-sm truncate">{cadenceLabel}</span>
                                    <span className="text-xs text-muted-foreground truncate">
                                      {schedule.timezone}
                                    </span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="bottom">
                                  <p>{cadenceLabel}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {schedule.timezone}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                            <TableCell className="text-sm hidden sm:table-cell">
                              <span className="truncate block">
                                {formatDateTime(schedule.nextRunAt)}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm hidden lg:table-cell">
                              <span className="truncate block">
                                {formatDateTime(schedule.lastRunAt)}
                              </span>
                            </TableCell>
                            <TableCell>{renderStatusBadge(schedule.status)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => handleRunNow(schedule)}
                                      disabled={isActionBusy(schedule.id)}
                                    >
                                      <PlayCircle className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Run now</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="secondary"
                                      size="icon"
                                      className="h-7 w-7"
                                      onClick={() => handlePauseResume(schedule)}
                                      disabled={isActionBusy(schedule.id)}
                                    >
                                      {isPaused ? (
                                        <PlayCircle className="h-3.5 w-3.5" />
                                      ) : (
                                        <PauseCircle className="h-3.5 w-3.5" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{isPaused ? 'Resume' : 'Pause'}</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      aria-label="View runs"
                                      asChild
                                    >
                                      <Link
                                        to={`/activity?trigger=schedule&search=${encodeURIComponent(schedule.name)}`}
                                      >
                                        <History className="h-3.5 w-3.5" />
                                      </Link>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>View runs</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      aria-label="Edit schedule"
                                      onClick={() => handleEdit(schedule)}
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7"
                                      aria-label="Delete schedule"
                                      onClick={() => handleDelete(schedule)}
                                      disabled={isActionBusy(schedule.id)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Delete</TooltipContent>
                                </Tooltip>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    : null}
                  {!isLoading && !hasData && (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <div className="flex flex-col items-center justify-center py-10 text-center space-y-2">
                          <p className="font-medium">No schedules found</p>
                          <p className="text-sm text-muted-foreground max-w-lg">
                            Create your first cadence with the “New schedule” button or tweak the
                            filters above.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </div>
      <ScheduleEditorDrawer
        open={editorOpen}
        mode={editorMode}
        schedule={activeSchedule ?? undefined}
        defaultWorkflowId={
          editorMode === 'create' ? filters.workflowId : activeSchedule?.workflowId
        }
        workflowOptions={workflowOptions}
        onClose={() => setEditorOpen(false)}
        onBack={
          editorMode === 'create'
            ? () => {
                setEditorOpen(false);
                setChooserOpen(true);
              }
            : undefined
        }
        onSaved={handleScheduleSaved}
      />
      {/* Scan type chooser dialog */}
      <Dialog open={chooserOpen} onOpenChange={(isOpen) => !isOpen && setChooserOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Schedule</DialogTitle>
            <DialogDescription>What would you like to schedule?</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {resolvedCloudScans.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Cloud className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase text-muted-foreground tracking-wide">
                    Cloud Security
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {resolvedCloudScans.map((scan) => (
                    <button
                      key={scan.slug}
                      type="button"
                      onClick={() => {
                        setChooserOpen(false);
                        setCloudScanSlug(scan.slug);
                        setCloudScheduleOpen(true);
                      }}
                      className="rounded-lg border border-border p-3 text-left text-sm hover:border-primary/50 transition-colors"
                    >
                      <div className="font-medium">{scan.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{scan.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {resolvedCodeScans.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Code className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase text-muted-foreground tracking-wide">
                    Code Security
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {resolvedCodeScans.map((scan) => (
                    <button
                      key={scan.id}
                      type="button"
                      onClick={() => {
                        setChooserOpen(false);
                        setCodeScanId(scan.id);
                        setCodeScheduleOpen(true);
                      }}
                      className="rounded-lg border border-border p-3 text-left text-sm hover:border-primary/50 transition-colors"
                    >
                      <div className="font-medium">{scan.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{scan.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t pt-3">
              <button
                type="button"
                onClick={() => {
                  setChooserOpen(false);
                  openCreateDrawer();
                }}
                className="w-full flex items-start gap-3 rounded-lg border border-border p-3 text-left text-sm hover:border-primary/50 transition-colors"
              >
                <Settings className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">Custom Workflow</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Advanced: schedule any workflow with full control over inputs & overrides
                  </div>
                </div>
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CloudScanScheduleDialog
        open={cloudScheduleOpen}
        onClose={() => {
          setCloudScheduleOpen(false);
          setCloudScanSlug(undefined);
        }}
        onBack={() => {
          setCloudScheduleOpen(false);
          setCloudScanSlug(undefined);
          setChooserOpen(true);
        }}
        connection={null}
        preSelectedScanSlug={cloudScanSlug}
      />
      <CodeScanScheduleDialog
        open={codeScheduleOpen}
        onClose={() => {
          setCodeScheduleOpen(false);
          setCodeScanId(undefined);
        }}
        onBack={() => {
          setCodeScheduleOpen(false);
          setCodeScanId(undefined);
          setChooserOpen(true);
        }}
        preSelectedScanId={codeScanId}
      />
    </TooltipProvider>
  );
}

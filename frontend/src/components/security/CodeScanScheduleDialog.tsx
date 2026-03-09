import { useEffect, useMemo, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, ArrowLeft, FolderGit, Loader2, Search } from 'lucide-react';
import { useGitHubStore, type GitHubRepo } from '@/store/githubStore';
import { useGitHubRepositories } from '@/hooks/queries/useGithubQueries';
import { useWorkflow } from '@/hooks/queries/useWorkflowQueries';
import { useCreateSchedule, useSchedules } from '@/hooks/queries/useScheduleQueries';
import { useToast } from '@/components/ui/use-toast';
import { CadencePicker } from '@/components/schedules/CadencePicker';
import { CODE_SCHEDULE_SCANS } from './constants';

const CLONE_COMPONENT_ID = 'github.repo.clone';

function getLocalTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
}

interface CodeScanScheduleDialogProps {
  open: boolean;
  onClose: () => void;
  onBack?: () => void;
  repository?: GitHubRepo;
  preSelectedScanId?: string;
  onScheduled?: () => void;
}

export function CodeScanScheduleDialog({
  open,
  onClose,
  onBack,
  repository: preSelectedRepo,
  preSelectedScanId,
  onScheduled,
}: CodeScanScheduleDialogProps) {
  const { toast } = useToast();
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);
  const { data: repositories = [], isLoading: repositoriesLoading } = useGitHubRepositories();
  const createSchedule = useCreateSchedule();
  const { data: existingSchedules = [] } = useSchedules();

  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(preSelectedRepo ?? null);
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedScan, setSelectedScan] = useState<string | null>(null);
  const [branch, setBranch] = useState('');
  const [cronExpression, setCronExpression] = useState('0 2 * * *');
  const [humanLabel, setHumanLabel] = useState('Daily at 2 AM');
  const [scheduleName, setScheduleName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);

  useEffect(() => {
    if (open) fetchSystemWorkflows();
  }, [open, fetchSystemWorkflows]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      const repo = preSelectedRepo ?? null;
      setSelectedRepo(repo);
      setRepoSearch('');
      setSelectedScan(preSelectedScanId ?? null);
      setBranch(repo?.defaultBranch ?? 'main');
      setCronExpression('0 2 * * *');
      setHumanLabel('Daily at 2 AM');
      setScheduleName('');
      setNameEdited(false);
    }
  }, [open, preSelectedRepo, preSelectedScanId]);

  // Update branch when repo changes
  useEffect(() => {
    if (selectedRepo) {
      setBranch(selectedRepo.defaultBranch ?? 'main');
    }
  }, [selectedRepo]);

  const filteredRepos = useMemo(() => {
    if (!repoSearch.trim()) return repositories;
    const q = repoSearch.toLowerCase();
    return repositories.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repositories, repoSearch]);

  const resolvedScans = useMemo(() => {
    return CODE_SCHEDULE_SCANS.flatMap((scan) => {
      const match = systemWorkflows.find((sw) => sw.slug === scan.templateSlug);
      if (!match) return [];
      return [{ ...scan, workflowId: match.id }];
    });
  }, [systemWorkflows]);

  const selectedScanDef = resolvedScans.find((s) => s.id === selectedScan);

  // Fetch the workflow to discover the clone node
  const { data: workflowDetail } = useWorkflow(selectedScanDef?.workflowId);

  const cloneNodeId = useMemo(() => {
    if (!workflowDetail?.graph?.nodes) return null;
    const cloneNode = workflowDetail.graph.nodes.find(
      (node: any) => node.type === CLONE_COMPONENT_ID,
    );
    return cloneNode?.id ?? null;
  }, [workflowDetail]);

  // Auto-generate schedule name
  useEffect(() => {
    if (nameEdited) return;
    const target = selectedRepo?.fullName || 'Repository';
    const scanName = selectedScanDef?.name || 'Scan';
    const cadence = humanLabel.split(' at ')[0] || 'Custom';
    setScheduleName(`${target} — ${scanName} (${cadence})`);
  }, [selectedRepo, selectedScanDef, humanLabel, nameEdited]);

  // Duplicate detection
  const hasDuplicate = useMemo(() => {
    if (!selectedScanDef || !selectedRepo) return false;
    return existingSchedules.some(
      (s: any) =>
        s.status !== 'paused' &&
        s.workflowId === selectedScanDef.workflowId &&
        s.inputPayload?.runtimeInputs?.repositoryId === selectedRepo.id,
    );
  }, [existingSchedules, selectedScanDef, selectedRepo]);

  const isValid =
    !!selectedRepo &&
    !!selectedScanDef &&
    !!branch.trim() &&
    !!cronExpression.trim() &&
    scheduleName.trim().length > 0;

  const hasCloneNodeError = !!workflowDetail && !cloneNodeId && selectedScanDef !== undefined;

  const handleSubmit = async () => {
    if (createSchedule.isPending) return;
    if (!selectedScanDef || !selectedRepo || !branch.trim()) return;

    const timezone = getLocalTimezone();
    const runtimeInputs: Record<string, unknown> = {
      repository: selectedRepo.fullName,
      owner: selectedRepo.owner,
      repo: selectedRepo.name,
      branch: branch.trim(),
      repositoryId: selectedRepo.id,
    };

    const nodeOverrides: Record<string, any> = {};
    if (cloneNodeId) {
      nodeOverrides[cloneNodeId] = {
        params: {},
        inputOverrides: {
          repository: selectedRepo.fullName,
          branch: branch.trim(),
        },
      };
    }

    try {
      await createSchedule.mutateAsync({
        workflowId: selectedScanDef.workflowId,
        name: scheduleName.trim(),
        cronExpression: cronExpression.trim(),
        timezone,
        humanLabel: humanLabel || undefined,
        overlapPolicy: 'skip',
        catchupWindowSeconds: 3600,
        inputPayload: {
          runtimeInputs,
          nodeOverrides,
        },
      });
      toast({
        title: 'Scan scheduled',
        description: (
          <span>
            Cadence: {humanLabel || cronExpression} ({timezone}).{' '}
            <a href="/schedules" className="underline font-medium">
              View on Schedules page
            </a>
          </span>
        ),
      });
      onScheduled?.();
      onClose();
    } catch (err) {
      const status =
        err !== null &&
        typeof err === 'object' &&
        'response' in err &&
        err.response !== null &&
        typeof err.response === 'object' &&
        'status' in err.response
          ? (err.response as { status: unknown }).status
          : undefined;
      toast({
        title: status === 409 ? 'Schedule already exists' : 'Failed to create schedule',
        description:
          status === 409
            ? 'A schedule already exists for this target.'
            : err instanceof Error
              ? err.message
              : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const showRepoPicker = !selectedRepo;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center mr-2 text-muted-foreground hover:text-foreground transition-colors align-middle"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            Schedule Code Scan
          </DialogTitle>
          <DialogDescription>
            {selectedRepo ? selectedRepo.fullName : 'Select a repository'}
          </DialogDescription>
        </DialogHeader>

        {showRepoPicker ? (
          /* Step 1: Repo picker */
          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search repositories..."
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {repositoriesLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))
              ) : filteredRepos.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No repositories found
                </p>
              ) : (
                filteredRepos.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => setSelectedRepo(repo)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors"
                  >
                    <FolderGit className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{repo.fullName}</div>
                      {repo.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {repo.description}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          /* Step 2: Configure */
          <div className="space-y-4 py-2">
            {/* Scan type */}
            {!preSelectedScanId && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Scan type</Label>
                {resolvedScans.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Some scan types are unavailable for your organization. Contact your admin.
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {resolvedScans.map((scan) => (
                      <button
                        key={scan.id}
                        type="button"
                        onClick={() => setSelectedScan(scan.id)}
                        className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                          selectedScan === scan.id
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/50'
                        }`}
                      >
                        <div className="font-medium">{scan.name}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {scan.description}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Branch */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Branch</Label>
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Branch will be validated when the scan runs.
              </p>
            </div>

            {/* Cadence */}
            <CadencePicker
              cronExpression={cronExpression}
              humanLabel={humanLabel}
              onChange={(cron, label) => {
                setCronExpression(cron);
                setHumanLabel(label);
              }}
            />

            {/* Schedule name */}
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Schedule name</Label>
              <Input
                value={scheduleName}
                onChange={(e) => {
                  setScheduleName(e.target.value);
                  setNameEdited(true);
                }}
                className="text-sm"
              />
            </div>

            {/* Clone node error */}
            {hasCloneNodeError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  Could not find the repository clone step in this workflow. Schedule creation is
                  blocked.
                </span>
              </div>
            )}

            {/* Duplicate warning */}
            {hasDuplicate && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-300 dark:border-yellow-700 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2.5 text-sm">
                <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                <span className="text-yellow-800 dark:text-yellow-200">
                  A schedule already exists for this target.
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!isValid || createSchedule.isPending || hasCloneNodeError}
                onClick={handleSubmit}
              >
                {createSchedule.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {hasDuplicate ? 'Create anyway' : 'Create schedule'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

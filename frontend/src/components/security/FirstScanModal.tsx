import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, FolderGit, CalendarClock } from 'lucide-react';
import { useGitHubRepositories, useTriggerScan } from '@/hooks/queries/useGithubQueries';
import type { GitHubRepo } from '@/store/githubStore';
import { useGitHubStore } from '@/store/githubStore';
import { useToast } from '@/components/ui/use-toast';
import { QUICK_SCANS } from './constants';
import { CodeScanScheduleDialog } from './CodeScanScheduleDialog';
import { SearchableSelectionList } from './ScheduleDialogShared';

export function FirstScanModal({
  open,
  onClose,
  scanCategory,
}: {
  open: boolean;
  onClose: () => void;
  scanCategory: 'code' | 'dependency' | 'container';
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: repositories = [], isLoading: repositoriesLoading } = useGitHubRepositories();
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);
  const triggerScanMutation = useTriggerScan();

  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [repoSearch, setRepoSearch] = useState('');
  const [triggering, setTriggering] = useState<string | null>(null);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);

  const filteredRepos = useMemo(() => {
    if (!repoSearch.trim()) return repositories;
    const q = repoSearch.toLowerCase();
    return repositories.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repositories, repoSearch]);

  // Ensure system workflows are loaded
  useEffect(() => {
    fetchSystemWorkflows();
  }, [fetchSystemWorkflows]);

  // Resolve QUICK_SCANS to actual workflow UUIDs via system workflow template slugs
  const resolvedScans = useMemo(() => {
    const categoryScans =
      scanCategory === 'code'
        ? QUICK_SCANS.filter((s) => s.id !== 'dependency-audit')
        : QUICK_SCANS.filter((s) => s.id === 'dependency-audit');

    return categoryScans.flatMap((scan) => {
      const match = systemWorkflows.find((sw) => sw.slug === scan.templateSlug);
      if (!match) return [];
      return [{ ...scan, workflowId: match.id }];
    });
  }, [systemWorkflows, scanCategory]);

  const handleTrigger = async (workflowId: string) => {
    if (!selectedRepo) return;
    setTriggering(workflowId);
    try {
      const result = await triggerScanMutation.mutateAsync({
        repoId: selectedRepo.id,
        workflowId,
        branch: selectedRepo.defaultBranch ?? undefined,
      });
      onClose();
      navigate(`/runs/${result.runId}`);
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

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{selectedRepo ? 'Select Scan Type' : 'Select Repository'}</DialogTitle>
          <DialogDescription>
            {selectedRepo
              ? `Choose a scan to run on ${selectedRepo.fullName}`
              : 'Pick a repository to run your first scan on'}
          </DialogDescription>
        </DialogHeader>

        {!selectedRepo ? (
          <SearchableSelectionList
            items={filteredRepos}
            isLoading={repositoriesLoading}
            search={repoSearch}
            onSearchChange={setRepoSearch}
            searchPlaceholder="Search repositories..."
            emptyMessage="No repositories found"
            getKey={(repo) => repo.id}
            renderItem={(repo) => (
              <button
                onClick={() => setSelectedRepo(repo)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors"
              >
                <FolderGit className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{repo.fullName}</div>
                  {repo.description && (
                    <div className="text-xs text-muted-foreground truncate">{repo.description}</div>
                  )}
                </div>
              </button>
            )}
          />
        ) : (
          <div className="space-y-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setSelectedRepo(null)}
            >
              &larr; Back to repos
            </Button>
            <div className="grid gap-2">
              {resolvedScans.map((scan) => {
                const Icon = scan.icon;
                return (
                  <Button
                    key={scan.workflowId}
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
            <div className="pt-2 border-t">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => setShowScheduleDialog(true)}
              >
                <CalendarClock className="h-4 w-4 mr-2" />
                Schedule this scan instead
              </Button>
            </div>
          </div>
        )}
      </DialogContent>

      <CodeScanScheduleDialog
        open={showScheduleDialog}
        onClose={() => setShowScheduleDialog(false)}
        repository={selectedRepo ?? undefined}
        onScheduled={() => {
          setShowScheduleDialog(false);
          onClose();
        }}
      />
    </Dialog>
  );
}

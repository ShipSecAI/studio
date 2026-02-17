import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Loader2, FolderGit } from 'lucide-react';
import { useGitHubStore, type GitHubRepo } from '@/store/githubStore';
import { useToast } from '@/components/ui/use-toast';
import { QUICK_SCANS } from './constants';

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
  const repositories = useGitHubStore((s) => s.repositories);
  const repositoriesLoading = useGitHubStore((s) => s.repositoriesLoading);
  const fetchRepositories = useGitHubStore((s) => s.fetchRepositories);
  const triggerScan = useGitHubStore((s) => s.triggerScan);

  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [repoSearch, setRepoSearch] = useState('');
  const [triggering, setTriggering] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetchRepositories();
      setSelectedRepo(null);
      setRepoSearch('');
      setTriggering(null);
    }
  }, [open, fetchRepositories]);

  const filteredRepos = useMemo(() => {
    if (!repoSearch.trim()) return repositories;
    const q = repoSearch.toLowerCase();
    return repositories.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repositories, repoSearch]);

  const scansForCategory =
    scanCategory === 'code'
      ? QUICK_SCANS.filter((s) => s.id !== 'dependency-audit')
      : QUICK_SCANS.filter((s) => s.id === 'dependency-audit');

  const handleTrigger = async (workflowId: string) => {
    if (!selectedRepo) return;
    setTriggering(workflowId);
    try {
      await triggerScan(selectedRepo.id, workflowId, selectedRepo.defaultBranch ?? undefined);
      toast({
        title: 'Scan started',
        description: `Security scan started for ${selectedRepo.fullName}`,
      });
      onClose();
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
              {scansForCategory.map((scan) => {
                const Icon = scan.icon;
                return (
                  <Button
                    key={scan.id}
                    variant="outline"
                    className="justify-start h-auto py-3 px-4"
                    onClick={() => handleTrigger(scan.id)}
                    disabled={triggering !== null}
                  >
                    {triggering === scan.id ? (
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
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Cloud, FolderGit, GitBranch, Loader2, PlayCircle, Search } from 'lucide-react';
import { useGitHubRepositories, useTriggerScan } from '@/hooks/queries/useGithubQueries';
import { useIntegrationConnections } from '@/hooks/queries/useIntegrationQueries';
import { useGitHubStore } from '@/store/githubStore';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { QUICK_SCANS, CLOUD_QUICK_SCANS, resolveScansToWorkflows } from './constants';
import type { GitHubRepo } from '@/store/githubStore';

type ScanCategory = 'code' | 'cloud';
type WizardStep = 1 | 2 | 3;

interface AwsConnection {
  id: string;
  displayName?: string;
  provider: string;
  config?: Record<string, unknown>;
  status?: string;
}

const STEP_LABELS = ['Category', 'Target', 'Scan'] as const;

// ── Step Indicator (dot + line) ───────────────────────────────────────────────

function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
  return (
    <div className="flex items-center justify-center gap-0 py-2">
      {STEP_LABELS.map((label, i) => {
        const stepNum = (i + 1) as WizardStep;
        const isCompleted = stepNum < currentStep;
        const isCurrent = stepNum === currentStep;
        const isFuture = stepNum > currentStep;

        return (
          <div key={label} className="flex items-center">
            {/* Connecting line (before dot, except first) */}
            {i > 0 && (
              <div
                className={cn(
                  'h-0.5 w-10',
                  isCompleted || isCurrent ? 'bg-primary' : 'bg-muted-foreground/20',
                )}
              />
            )}
            {/* Dot + label */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'h-3 w-3 rounded-full transition-all',
                  isCompleted && 'bg-primary',
                  isCurrent && 'bg-primary ring-4 ring-primary/20',
                  isFuture && 'bg-muted-foreground/30',
                )}
              />
              <span
                className={cn(
                  'text-[10px] mt-1',
                  isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main Dialog ───────────────────────────────────────────────────────────────

interface QuickScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuickScanDialog({ open, onOpenChange }: QuickScanDialogProps) {
  const { toast } = useToast();
  const navigate = useNavigate();

  // Wizard state
  const [step, setStep] = useState<WizardStep>(1);
  const [category, setCategory] = useState<ScanCategory | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<AwsConnection | null>(null);
  const [repoSearch, setRepoSearch] = useState('');
  const [connectionSearch, setConnectionSearch] = useState('');
  const [imageRef, setImageRef] = useState('');
  const [expandedScan, setExpandedScan] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<string | null>(null);
  const imageRefInputRef = useRef<HTMLInputElement>(null);

  // Data hooks
  const { data: repositories = [], isLoading: reposLoading } = useGitHubRepositories();
  const { data: orgConnections = [], isLoading: connectionsLoading } = useIntegrationConnections();
  const triggerScanMutation = useTriggerScan();
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);

  // Load system workflows when dialog opens
  useEffect(() => {
    if (open) fetchSystemWorkflows();
  }, [open, fetchSystemWorkflows]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(1);
      setCategory(null);
      setSelectedRepo(null);
      setSelectedConnection(null);
      setRepoSearch('');
      setConnectionSearch('');
      setImageRef('');
      setExpandedScan(null);
      setTriggering(null);
    }
  }, [open]);

  // Filtered lists
  const awsConnections = useMemo(
    () =>
      orgConnections.filter((c: { provider: string }) => c.provider === 'aws') as AwsConnection[],
    [orgConnections],
  );

  const filteredRepos = useMemo(() => {
    if (!repoSearch.trim()) return repositories;
    const q = repoSearch.toLowerCase();
    return repositories.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repositories, repoSearch]);

  const filteredConnections = useMemo(() => {
    if (!connectionSearch.trim()) return awsConnections;
    const q = connectionSearch.toLowerCase();
    return awsConnections.filter(
      (c) =>
        (c.displayName || '').toLowerCase().includes(q) ||
        ((c.config as Record<string, string>)?.accountId || '').includes(q),
    );
  }, [awsConnections, connectionSearch]);

  // Resolved scans
  const resolvedCodeScans = useMemo(
    () => resolveScansToWorkflows(QUICK_SCANS, systemWorkflows),
    [systemWorkflows],
  );

  const resolvedCloudScans = useMemo(
    () => resolveScansToWorkflows(CLOUD_QUICK_SCANS, systemWorkflows),
    [systemWorkflows],
  );

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelectCategory = (cat: ScanCategory) => {
    setCategory(cat);
    setStep(2);
  };

  const handleSelectRepo = (repo: GitHubRepo) => {
    setSelectedRepo(repo);
    setStep(3);
  };

  const handleSelectConnection = (conn: AwsConnection) => {
    setSelectedConnection(conn);
    setStep(3);
  };

  const handleBack = () => {
    if (step === 3) {
      setSelectedRepo(null);
      setSelectedConnection(null);
      setImageRef('');
      setExpandedScan(null);
      setStep(2);
    } else if (step === 2) {
      setCategory(null);
      setSelectedRepo(null);
      setSelectedConnection(null);
      setRepoSearch('');
      setConnectionSearch('');
      setStep(1);
    }
  };

  const handleCodeScan = async (workflowId: string) => {
    if (!selectedRepo) return;
    setTriggering(workflowId);
    try {
      const result = await triggerScanMutation.mutateAsync({
        repoId: selectedRepo.id,
        workflowId,
        branch: selectedRepo.defaultBranch ?? undefined,
      });
      if (!result.runId) {
        toast({ title: 'Error', description: 'No run ID returned', variant: 'destructive' });
        return;
      }
      onOpenChange(false);
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

  const handleCloudScan = async (workflowId: string, extraInputs?: Record<string, unknown>) => {
    if (!selectedConnection) return;
    setTriggering(workflowId);
    try {
      const inputs: Record<string, unknown> = {
        connectionId: selectedConnection.id,
        ...extraInputs,
      };
      const { executionId } = await api.executions.start(workflowId, { inputs });
      if (!executionId) {
        toast({ title: 'Error', description: 'No execution ID returned', variant: 'destructive' });
        return;
      }
      onOpenChange(false);
      navigate(`/runs/${executionId}`);
    } catch (error) {
      toast({
        title: 'Failed to start scan',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setTriggering(null);
    }
  };

  // ── Step titles ───────────────────────────────────────────────────────────

  const getTitle = () => {
    if (step === 1) return 'What do you want to scan?';
    if (step === 2) return category === 'code' ? 'Select Repository' : 'Select Cloud Account';
    if (step === 3) return 'Choose Scan Type';
    return 'Quick Scan';
  };

  const getDescription = () => {
    if (step === 1) return 'Choose a scan category to get started';
    if (step === 2 && category === 'code') return 'Pick a repository to scan';
    if (step === 2 && category === 'cloud') return 'Pick an AWS account to scan';
    if (step === 3 && selectedRepo) return `Scanning ${selectedRepo.fullName}`;
    if (step === 3 && selectedConnection)
      return `Scanning ${selectedConnection.displayName || 'AWS Account'}`;
    return '';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {getTitle()}
          </DialogTitle>
          <DialogDescription>{getDescription()}</DialogDescription>
        </DialogHeader>

        <StepIndicator currentStep={step} />

        {/* Step 1: Category Selection */}
        {step === 1 && (
          <div className="grid grid-cols-2 gap-3 py-2">
            <button
              type="button"
              onClick={() => handleSelectCategory('code')}
              className="flex flex-col items-center gap-3 rounded-lg border-2 border-border p-6 text-center transition-colors hover:border-primary hover:bg-primary/5"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10">
                <GitBranch className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <p className="font-medium">Code Security</p>
                <p className="text-xs text-muted-foreground mt-1">Secrets, SAST, Dependencies</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => handleSelectCategory('cloud')}
              className="flex flex-col items-center gap-3 rounded-lg border-2 border-border p-6 text-center transition-colors hover:border-primary hover:bg-primary/5"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/10">
                <Cloud className="h-6 w-6 text-orange-500" />
              </div>
              <div>
                <p className="font-medium">Cloud Security</p>
                <p className="text-xs text-muted-foreground mt-1">Misconfiguration, Containers</p>
              </div>
            </button>
          </div>
        )}

        {/* Step 2: Target Selection */}
        {step === 2 && category === 'code' && (
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
              {reposLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))
              ) : filteredRepos.length === 0 ? (
                repositories.length === 0 ? (
                  <div className="text-center py-6 space-y-3">
                    <p className="text-sm text-muted-foreground">No repositories connected</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onOpenChange(false);
                        navigate('/github/repositories');
                      }}
                    >
                      <GitBranch className="h-4 w-4 mr-2" />
                      Connect GitHub
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No matching repositories
                  </p>
                )
              ) : (
                filteredRepos.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => handleSelectRepo(repo)}
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
        )}

        {step === 2 && category === 'cloud' && (
          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search accounts..."
                value={connectionSearch}
                onChange={(e) => setConnectionSearch(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {connectionsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))
              ) : filteredConnections.length === 0 ? (
                awsConnections.length === 0 ? (
                  <div className="text-center py-6 space-y-3">
                    <p className="text-sm text-muted-foreground">No cloud accounts connected</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onOpenChange(false);
                        navigate('/cloud/accounts');
                      }}
                    >
                      <Cloud className="h-4 w-4 mr-2" />
                      Connect AWS
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No matching accounts
                  </p>
                )
              ) : (
                filteredConnections.map((conn) => {
                  const accountId = (conn.config as Record<string, string>)?.accountId;
                  const region = (conn.config as Record<string, string>)?.region;
                  return (
                    <button
                      key={conn.id}
                      onClick={() => handleSelectConnection(conn)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors"
                    >
                      <Cloud className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {conn.displayName || 'AWS Account'}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {[accountId, region].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Step 3: Scan Type Selection */}
        {step === 3 && category === 'code' && (
          <div className="space-y-3 py-2">
            {resolvedCodeScans.length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-muted-foreground">
                  No scan workflows found. Install them from Templates.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    navigate('/templates');
                  }}
                >
                  Browse Templates
                </Button>
              </div>
            ) : (
              <div className="grid gap-2">
                {resolvedCodeScans.map((scan) => {
                  const Icon = scan.icon;
                  const isTriggering = triggering === scan.workflowId;
                  return (
                    <Button
                      key={scan.workflowId}
                      variant="outline"
                      className="justify-start h-auto py-3 px-4"
                      onClick={() => handleCodeScan(scan.workflowId)}
                      disabled={triggering !== null}
                    >
                      {isTriggering ? (
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
            )}
          </div>
        )}

        {step === 3 && category === 'cloud' && (
          <div className="space-y-3 py-2">
            {resolvedCloudScans.length === 0 ? (
              <div className="text-center py-6 space-y-3">
                <p className="text-sm text-muted-foreground">
                  No cloud scan workflows found. Install them from Templates.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    navigate('/templates');
                  }}
                >
                  Browse Templates
                </Button>
              </div>
            ) : (
              resolvedCloudScans.map((scan) => {
                const Icon = scan.icon;
                const isTriggering = triggering === scan.workflowId;
                const needsImageRef = scan.slug === 'container-image-scan';
                const isExpanded = expandedScan === scan.slug;

                return (
                  <div key={scan.slug} className="rounded-lg border transition-colors">
                    <button
                      type="button"
                      onClick={() => {
                        if (needsImageRef) {
                          setExpandedScan(isExpanded ? null : scan.slug);
                          setTimeout(() => imageRefInputRef.current?.focus(), 50);
                        } else {
                          handleCloudScan(scan.workflowId);
                        }
                      }}
                      disabled={!!triggering}
                      className="flex items-start gap-3 w-full p-3 text-left hover:bg-muted/50 transition-colors disabled:opacity-50"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                        {isTriggering && !needsImageRef ? (
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
                          onChange={(e) => setImageRef(e.target.value.slice(0, 500))}
                          className="h-8 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && imageRef.trim()) {
                              handleCloudScan(scan.workflowId, { imageRef: imageRef.trim() });
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={!imageRef.trim() || !!triggering}
                          onClick={() =>
                            handleCloudScan(scan.workflowId, { imageRef: imageRef.trim() })
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
              })
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  RefreshCw,
  CheckCircle,
  Loader2,
  Settings,
  Github,
  LinkIcon,
  FolderGit,
  GitPullRequest,
  Shield,
} from 'lucide-react';

import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import {
  useGitHubStatus,
  useGitHubInstallations,
  useGitHubRepositories,
  useSetupInstallation,
  useSyncRepositories,
} from '@/hooks/queries/useGithubQueries';
import { queryKeys } from '@/lib/queryKeys';
import { useQueryClient } from '@tanstack/react-query';
import type { GitHubInstallation, GitHubRepo } from '@/store/githubStore';
import { formatRelativeTime } from '@/components/scans/scan-utils';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseInstallationId(input: string): number | null {
  const value = input.trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const id = Number.parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  const pathMatch = value.match(/\/installations\/(\d+)/i);
  if (pathMatch?.[1]) {
    const id = Number.parseInt(pathMatch[1], 10);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  const queryMatch = value.match(/[?&]installation_id=(\d+)/i);
  if (queryMatch?.[1]) {
    const id = Number.parseInt(queryMatch[1], 10);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export function GitHubIntegrationPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: statusData, isLoading: loadingStatus } = useGitHubStatus();
  const { data: installations = [], isLoading: loadingInstallations } = useGitHubInstallations();
  const { data: repositories = [] } = useGitHubRepositories();
  const { mutateAsync: setupInstallation } = useSetupInstallation();
  const { mutateAsync: syncRepositories } = useSyncRepositories();

  const installUrl = statusData?.installUrl ?? null;

  const [syncing, setSyncing] = useState(false);
  const [installationRef, setInstallationRef] = useState('');
  const [linking, setLinking] = useState(false);

  const activeCount = useMemo(
    () => installations.filter((i) => i.isActive).length,
    [installations],
  );

  const totalRepoCount = repositories.length;
  const scansEnabledCount = useMemo(
    () => repositories.filter((r) => r.scansEnabled).length,
    [repositories],
  );

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await syncRepositories();
      toast({
        title: 'Repositories synced',
        description: `Synced ${result.synced} repositories from GitHub.`,
      });
    } catch {
      toast({ title: 'Error', description: 'Failed to sync repositories', variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const handleLinkExistingInstallation = async () => {
    const installationId = parseInstallationId(installationRef);
    if (!installationId) {
      toast({
        title: 'Invalid installation reference',
        description: 'Paste a GitHub installation URL or a numeric installation ID.',
        variant: 'destructive',
      });
      return;
    }

    setLinking(true);
    try {
      await setupInstallation(installationId);
      qc.invalidateQueries({ queryKey: queryKeys.github.status() });
      setInstallationRef('');
      toast({
        title: 'GitHub linked',
        description: 'Existing GitHub installation connected and repositories synced.',
      });
    } catch (error) {
      toast({
        title: 'Failed to link installation',
        description:
          error instanceof Error ? error.message : 'Could not link the existing installation.',
        variant: 'destructive',
      });
    } finally {
      setLinking(false);
    }
  };

  // ---- Loading state ----

  const isLoading = loadingStatus || loadingInstallations;

  if (isLoading) {
    return (
      <div className="flex-1 bg-background">
        <div className="container mx-auto py-8 px-4 space-y-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-8 px-4 max-w-6xl space-y-8">
        {/* Provider Header */}
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex-shrink-0 p-3">
              <img src="/icons/github.svg" alt="GitHub" className="h-full w-full object-contain" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">GitHub</h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                Connect GitHub to scan repositories for secrets, vulnerabilities, and security
                issues. Run automated scans on pull requests and pushes.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {installations.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => navigate('/github/repositories')}
              >
                <FolderGit className="h-4 w-4" />
                Repositories
              </Button>
            )}

            {installUrl && (
              <Button className="gap-2" asChild>
                <a href={installUrl} target="_blank" rel="noopener noreferrer">
                  <Plus className="h-4 w-4" />
                  Install GitHub App
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Installation Cards */}
        <div>
          <h2 className="text-lg font-semibold mb-4">
            Installations
            {installations.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({installations.length})
              </span>
            )}
          </h2>

          {installations.length === 0 ? (
            <EmptyInstallationState
              installUrl={installUrl}
              installationRef={installationRef}
              setInstallationRef={setInstallationRef}
              linking={linking}
              onLinkExisting={handleLinkExistingInstallation}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {installations.map((inst) => (
                <InstallationCard
                  key={inst.id}
                  installation={inst}
                  repositories={repositories}
                  syncing={syncing}
                  onSync={handleSync}
                />
              ))}

              {/* Add Connection card */}
              {installUrl && (
                <Card className="overflow-hidden border-2 border-dashed hover:border-primary/50 hover:bg-muted/30 transition-colors">
                  <CardContent className="p-4 h-full flex flex-col items-center justify-center gap-3 min-h-[200px]">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Plus className="h-5 w-5 text-primary" />
                    </div>
                    <span className="text-sm font-medium text-muted-foreground">
                      Connect another account
                    </span>
                    <Button variant="outline" size="sm" asChild>
                      <a href={installUrl} target="_blank" rel="noopener noreferrer">
                        <LinkIcon className="h-3.5 w-3.5 mr-1.5" />
                        Install GitHub App
                      </a>
                    </Button>
                    <div className="w-full mt-2 pt-3 border-t text-left">
                      <p className="text-xs font-medium mb-1.5">Already installed?</p>
                      <div className="flex gap-2">
                        <Input
                          value={installationRef}
                          onChange={(e) => setInstallationRef(e.target.value)}
                          placeholder="Installation URL or ID"
                          disabled={linking}
                          className="text-xs h-8"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleLinkExistingInstallation}
                          disabled={linking || installationRef.trim().length === 0}
                        >
                          {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Link'}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>

        {/* Two-column bottom: Setup Instructions + Info Sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left column: Setup Instructions */}
          <div className="lg:col-span-3">
            <Card>
              <CardContent className="p-6 space-y-4">
                <h3 className="text-lg font-semibold">Setup</h3>
                <p className="text-sm text-muted-foreground">
                  Get started with GitHub integration in a few steps.
                </p>
                <ol className="space-y-3">
                  {[
                    'Click "Install GitHub App" to install the ShipSec app in your GitHub organization or personal account.',
                    'Select which repositories the app should have access to — you can choose all repositories or specific ones.',
                    "After installation, you'll be redirected back and your repositories will be synced automatically.",
                    'Navigate to Repositories to enable scans and configure trigger rules for automated security scanning.',
                  ].map((step, idx) => (
                    <li
                      key={idx}
                      className="flex gap-3 text-sm text-muted-foreground leading-relaxed"
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {idx + 1}
                      </span>
                      <span className="pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>

          {/* Right column: Info Sidebar */}
          <div className="lg:col-span-2">
            <div className="space-y-4">
              {/* Quick links */}
              {installations.length > 0 && (
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <h3 className="text-sm font-semibold mb-3">Quick Links</h3>
                    <button
                      onClick={() => navigate('/github/repositories')}
                      className="flex items-center gap-3 text-sm font-medium text-primary hover:underline w-full text-left"
                    >
                      <FolderGit className="h-4 w-4 flex-shrink-0" />
                      Manage Repositories
                    </button>
                    <button
                      onClick={() => navigate('/github/scans')}
                      className="flex items-center gap-3 text-sm font-medium text-primary hover:underline w-full text-left"
                    >
                      <Shield className="h-4 w-4 flex-shrink-0" />
                      View Scan Results
                    </button>
                    <button
                      onClick={() => navigate('/github/triggers')}
                      className="flex items-center gap-3 text-sm font-medium text-primary hover:underline w-full text-left"
                    >
                      <GitPullRequest className="h-4 w-4 flex-shrink-0" />
                      Trigger Rules
                    </button>
                  </CardContent>
                </Card>
              )}

              {/* Connection stats */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Connection Summary</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-md bg-muted/50 p-3 text-center">
                      <p className="text-2xl font-bold">{installations.length}</p>
                      <p className="text-xs text-muted-foreground">Installations</p>
                    </div>
                    <div className="rounded-md bg-muted/50 p-3 text-center">
                      <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                        {activeCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Active</p>
                    </div>
                  </div>
                  {installations.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-md bg-muted/50 p-3 text-center">
                        <p className="text-2xl font-bold">{totalRepoCount}</p>
                        <p className="text-xs text-muted-foreground">Repositories</p>
                      </div>
                      <div className="rounded-md bg-muted/50 p-3 text-center">
                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                          {scansEnabledCount}
                        </p>
                        <p className="text-xs text-muted-foreground">Scans Enabled</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Supported features */}
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Capabilities</h3>
                  <div className="flex flex-wrap gap-2">
                    {[
                      'Secret Detection',
                      'SAST Scanning',
                      'Dependency Audit',
                      'PR Comments',
                      'Check Runs',
                      'Scheduled Scans',
                    ].map((feature) => (
                      <Badge key={feature} variant="secondary" className="gap-1.5">
                        <Shield className="h-3 w-3" />
                        {feature}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InstallationCard({
  installation,
  repositories,
  syncing,
  onSync,
}: {
  installation: GitHubInstallation;
  repositories: GitHubRepo[];
  syncing: boolean;
  onSync: () => void;
}) {
  const instRepos = useMemo(
    () => repositories.filter((r) => r.installationId === installation.id),
    [repositories, installation.id],
  );

  const lastSynced = useMemo(
    () =>
      instRepos.reduce(
        (latest, r) => {
          if (!r.lastSyncedAt) return latest;
          if (!latest) return r.lastSyncedAt;
          return new Date(r.lastSyncedAt) > new Date(latest) ? r.lastSyncedAt : latest;
        },
        null as string | null,
      ),
    [instRepos],
  );

  return (
    <Card
      className={cn(
        'overflow-hidden transition-shadow hover:shadow-md',
        'border-gray-200 dark:border-gray-700',
      )}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          {installation.accountAvatarUrl ? (
            <img
              src={installation.accountAvatarUrl}
              alt={installation.accountLogin}
              className="h-10 w-10 rounded-lg flex-shrink-0 object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0 bg-muted text-muted-foreground">
              <Github className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-sm truncate">{installation.accountLogin}</h3>
              <Badge
                className={cn(
                  'gap-1',
                  installation.isActive
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800'
                    : '',
                )}
                variant={installation.isActive ? 'outline' : 'secondary'}
              >
                {installation.isActive && <CheckCircle className="h-3 w-3" />}
                {installation.isActive ? 'Connected' : 'Inactive'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {installation.accountType === 'Organization' ? 'Organization' : 'Personal account'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Repositories</span>
            <p className="font-medium">{instRepos.length}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Access</span>
            <p className="font-medium capitalize">
              {installation.repositorySelection === 'all' ? 'All repos' : 'Selected repos'}
            </p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Connected {formatRelativeTime(installation.createdAt)}
          {lastSynced && <> &middot; Synced {formatRelativeTime(lastSynced)}</>}
        </p>

        <div className="flex items-center gap-2 pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs flex-1"
            disabled={syncing}
            onClick={onSync}
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Sync
          </Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs flex-1" asChild>
            <a
              href={`https://github.com/settings/installations/${installation.installationId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Settings className="h-3.5 w-3.5" />
              Manage
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyInstallationState({
  installUrl,
  installationRef,
  setInstallationRef,
  linking,
  onLinkExisting,
}: {
  installUrl: string | null;
  installationRef: string;
  setInstallationRef: (v: string) => void;
  linking: boolean;
  onLinkExisting: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 hover:bg-muted/30 transition-colors">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mx-auto mb-3">
          <Github className="h-6 w-6 text-primary" />
        </div>
        <h3 className="text-base font-medium mb-1">No installations yet</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Install the ShipSec GitHub App to connect your repositories and enable automated security
          scans.
        </p>
        {installUrl && (
          <Button asChild>
            <a href={installUrl} target="_blank" rel="noopener noreferrer">
              <img src="/icons/github.svg" alt="" className="mr-2 h-4 w-4 brightness-0 invert" />
              Install GitHub App
            </a>
          </Button>
        )}
      </div>

      {installUrl && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm font-medium mb-2">Already installed?</p>
          <p className="text-sm text-muted-foreground mb-3">
            Paste the installation URL or ID from GitHub settings to link it here.
          </p>
          <div className="flex gap-2">
            <Input
              value={installationRef}
              onChange={(e) => setInstallationRef(e.target.value)}
              placeholder="https://github.com/settings/installations/12345678"
              disabled={linking}
            />
            <Button
              type="button"
              variant="outline"
              onClick={onLinkExisting}
              disabled={linking || installationRef.trim().length === 0}
            >
              {linking ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Linking...
                </>
              ) : (
                'Link'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

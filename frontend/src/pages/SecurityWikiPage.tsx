import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BookOpenText,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  GitBranch,
  Github,
  LayoutDashboard,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Settings,
  Workflow,
  XCircle,
} from 'lucide-react';

import { MarkdownView } from '@/components/ui/markdown';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import {
  api,
  type GitHubRepo,
  type SecurityWikiConfig,
  type SecurityWikiFile,
  type SecurityWikiRun,
  type SecurityWikiTreeNode,
} from '@/services/api';
import { cn } from '@/lib/utils';

const TEXT_EXTENSIONS = new Set(['md', 'mdx', 'txt', 'json', 'yaml', 'yml', 'toml', 'log']);
const CODE_WIKI_TEMPLATE_SLUG = 'sys-code-wiki-ingestion';
const CODE_WIKI_COMPONENT_ID = 'core.ai.codex';

interface WikiCodeSource {
  repoId: string;
  fullName: string;
  defaultBranch?: string | null;
  enabled: boolean;
  cadence: 'manual' | 'nightly' | 'weekly';
  addedAt: string;
}

interface WorkflowStatus {
  status?: string;
  runId?: string;
  workflowId?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

function flattenFiles(nodes: SecurityWikiTreeNode[]): SecurityWikiTreeNode[] {
  return nodes.flatMap((node) =>
    node.type === 'directory' ? flattenFiles(node.children ?? []) : [node],
  );
}

function findNode(nodes: SecurityWikiTreeNode[], path: string): SecurityWikiTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.type === 'directory') {
      const child = findNode(node.children ?? [], path);
      if (child) return child;
    }
  }
  return undefined;
}

function workflowRunId(run?: SecurityWikiRun | null): string | null {
  if (!run) return null;
  const value = run.validation?.workflowRunId;
  return typeof value === 'string' ? value : null;
}

function workflowId(run?: SecurityWikiRun | null): string | null {
  if (!run) return null;
  const value = run.validation?.workflowId;
  return typeof value === 'string' ? value : null;
}

function changedFiles(run?: SecurityWikiRun | null): string[] {
  if (!run) return [];
  if (Array.isArray(run.changedFiles))
    return run.changedFiles.filter((file) => typeof file === 'string');
  const validationFiles = run.validation?.changedFiles;
  return Array.isArray(validationFiles)
    ? validationFiles.filter((file) => typeof file === 'string')
    : [];
}

function codeSources(config?: SecurityWikiConfig): WikiCodeSource[] {
  const value = config?.metadata?.codeSources;
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const source = item as Record<string, unknown>;
    if (typeof source.repoId !== 'string' || typeof source.fullName !== 'string') return [];
    return {
      repoId: source.repoId,
      fullName: source.fullName,
      defaultBranch:
        typeof source.defaultBranch === 'string' || source.defaultBranch === null
          ? source.defaultBranch
          : undefined,
      enabled: source.enabled !== false,
      cadence:
        source.cadence === 'nightly' || source.cadence === 'weekly' ? source.cadence : 'manual',
      addedAt: typeof source.addedAt === 'string' ? source.addedAt : new Date().toISOString(),
    } satisfies WikiCodeSource;
  });
}

function statusVariant(status?: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status?.toLowerCase() ?? '';
  if (['completed', 'success', 'succeeded'].includes(normalized)) return 'default';
  if (['failed', 'failure', 'error', 'cancelled', 'canceled'].includes(normalized))
    return 'destructive';
  if (['running', 'workflow_started', 'pending', 'queued'].includes(normalized)) return 'secondary';
  return 'outline';
}

function formatDate(value?: string | null): string {
  if (!value) return 'Not recorded';
  return new Date(value).toLocaleString();
}

function deriveSlug(repoPath: string): string {
  const trimmed = repoPath.trim().replace(/\/+$/, '');
  const parts = trimmed.split('/').filter(Boolean);
  return parts
    .slice(-2)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
}

async function fetchWorkflowStatus(runId: string): Promise<WorkflowStatus> {
  const result = await api.executions.getStatus(runId);
  return (result ?? {}) as WorkflowStatus;
}

function WikiTree({
  nodes,
  selectedPath,
  search,
  onSelect,
  depth = 0,
}: {
  nodes: SecurityWikiTreeNode[];
  selectedPath?: string;
  search: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const visibleNodes = normalizedSearch
    ? nodes.filter((node) => {
        if (node.path.toLowerCase().includes(normalizedSearch)) return true;
        return (
          node.type === 'directory' &&
          flattenFiles(node.children ?? []).some((child) =>
            child.path.toLowerCase().includes(normalizedSearch),
          )
        );
      })
    : nodes;

  return (
    <div className="space-y-1">
      {visibleNodes.map((node) => {
        const isSelected = selectedPath === node.path;
        if (node.type === 'directory') {
          const hasSelectedChild = selectedPath?.startsWith(`${node.path}/`);
          return (
            <div key={node.path}>
              <div
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground"
                style={{ paddingLeft: 8 + depth * 14 }}
              >
                {hasSelectedChild ? (
                  <FolderOpen className="h-4 w-4" />
                ) : (
                  <Folder className="h-4 w-4" />
                )}
                <span className="truncate font-medium">{node.name}</span>
              </div>
              <WikiTree
                nodes={node.children ?? []}
                selectedPath={selectedPath}
                search={search}
                onSelect={onSelect}
                depth={depth + 1}
              />
            </div>
          );
        }

        return (
          <button
            key={node.path}
            type="button"
            onClick={() => onSelect(node.path)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted',
              isSelected && 'bg-primary/10 text-primary',
            )}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">{node.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function FilePreview({ file }: { file: SecurityWikiFile }) {
  const isMarkdown = file.extension === 'md' || file.extension === 'mdx';
  const isText = TEXT_EXTENSIONS.has(file.extension);

  if (isMarkdown) {
    return (
      <MarkdownView
        content={file.content}
        className="max-w-none"
        dataTestId="security-wiki-markdown"
      />
    );
  }

  if (isText) {
    return (
      <pre className="overflow-auto rounded-lg border bg-muted/30 p-4 text-sm leading-6 text-foreground">
        {file.content}
      </pre>
    );
  }

  return (
    <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed text-center">
      <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
      <h3 className="text-lg font-semibold">Preview unavailable</h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        This file type is tracked in the wiki, but the browser only renders markdown and safe text
        files.
      </p>
    </div>
  );
}

function ConfigCard({ config }: { config?: SecurityWikiConfig }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<'local' | 'github'>(config?.provider ?? 'local');
  const [repoName, setRepoName] = useState(config?.repoName ?? 'security-wiki');
  const [repoOwner, setRepoOwner] = useState(config?.repoOwner ?? '');
  const [repoUrl, setRepoUrl] = useState(config?.repoUrl ?? '');
  const [localPath, setLocalPath] = useState(config?.localPath ?? '');
  const [defaultBranch, setDefaultBranch] = useState(config?.defaultBranch ?? 'main');
  const [rootPath, setRootPath] = useState(config?.rootPath ?? '/');

  useEffect(() => {
    if (!config) return;
    setProvider(config.provider);
    setRepoName(config.repoName);
    setRepoOwner(config.repoOwner ?? '');
    setRepoUrl(config.repoUrl ?? '');
    setLocalPath(config.localPath ?? '');
    setDefaultBranch(config.defaultBranch);
    setRootPath(config.rootPath);
  }, [config]);

  const mutation = useMutation({
    mutationFn: api.securityWiki.upsertConfig,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['security-wiki', 'config'] }),
        queryClient.invalidateQueries({ queryKey: ['security-wiki', 'tree'] }),
      ]);
      toast({
        title: 'Security wiki saved',
        description: 'The active org wiki configuration was updated.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Failed to save wiki config',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-lg">Wiki configuration</CardTitle>
            <CardDescription>One agent-owned security wiki per organization.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="wiki-provider">Provider</Label>
          <select
            id="wiki-provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as 'local' | 'github')}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="local">Local checkout</option>
            <option value="github">GitHub repo</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="wiki-repo-name">Wiki repo name</Label>
          <Input
            id="wiki-repo-name"
            value={repoName}
            onChange={(event) => setRepoName(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wiki-owner">Repo owner</Label>
          <Input
            id="wiki-owner"
            value={repoOwner}
            onChange={(event) => setRepoOwner(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wiki-branch">Default branch</Label>
          <Input
            id="wiki-branch"
            value={defaultBranch}
            onChange={(event) => setDefaultBranch(event.target.value)}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="wiki-local-path">Local wiki path</Label>
          <Input
            id="wiki-local-path"
            value={localPath}
            onChange={(event) => setLocalPath(event.target.value)}
            placeholder="/workspace/security-wiki"
          />
          {provider === 'github' ? (
            <p className="text-xs text-muted-foreground">
              Browsing and CODE ingestion currently require a local managed checkout.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="wiki-url">Repo URL</Label>
          <Input
            id="wiki-url"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wiki-root">Root path</Label>
          <Input
            id="wiki-root"
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <Button
            onClick={() =>
              mutation.mutate({
                provider,
                repoName: repoName.trim(),
                repoOwner: repoOwner.trim() || undefined,
                repoUrl: repoUrl.trim() || undefined,
                localPath: localPath.trim() || undefined,
                defaultBranch: defaultBranch.trim() || 'main',
                rootPath: rootPath.trim() || '/',
                pathPolicy: {},
                metadata: { managedBy: 'shipsec-security-wiki-ui' },
              })
            }
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save configuration
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CodeSourcesPanel({ config }: { config?: SecurityWikiConfig }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const sources = codeSources(config);
  const repositoriesQuery = useQuery({
    queryKey: ['security-wiki', 'github-repositories'],
    queryFn: api.github.listRepositories,
    enabled: Boolean(config),
  });
  const mutation = useMutation({
    mutationFn: api.securityWiki.upsertConfig,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['security-wiki', 'config'] });
      toast({
        title: 'Code sources updated',
        description: 'The wiki source repository set was saved.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Failed to update code sources',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  const saveSources = (nextSources: WikiCodeSource[]) => {
    if (!config) return;
    mutation.mutate({
      provider: config.provider,
      repoName: config.repoName,
      repoOwner: config.repoOwner ?? undefined,
      repoUrl: config.repoUrl ?? undefined,
      localPath: config.localPath ?? undefined,
      defaultBranch: config.defaultBranch,
      rootPath: config.rootPath,
      pathPolicy: config.pathPolicy ?? {},
      metadata: {
        ...(config.metadata ?? {}),
        codeSources: nextSources,
      },
    });
  };

  const addSource = (repo: GitHubRepo) => {
    const nextSource: WikiCodeSource = {
      repoId: repo.id,
      fullName: repo.fullName,
      defaultBranch: repo.defaultBranch,
      enabled: true,
      cadence: 'manual',
      addedAt: new Date().toISOString(),
    };
    saveSources([...sources.filter((source) => source.repoId !== repo.id), nextSource]);
  };

  const removeSource = (repoId: string) => {
    saveSources(sources.filter((source) => source.repoId !== repoId));
  };

  const setCadence = (repoId: string, cadence: WikiCodeSource['cadence']) => {
    saveSources(
      sources.map((source) => (source.repoId === repoId ? { ...source, cadence } : source)),
    );
  };

  const availableRepositories =
    repositoriesQuery.data?.filter(
      (repo) => !sources.some((source) => source.repoId === repo.id),
    ) ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Github className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-lg">Code sources</CardTitle>
            <CardDescription>
              GitHub repositories that should feed this wiki through CODE ingestion workflows.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!config ? (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Save a wiki configuration before selecting code sources.
          </div>
        ) : null}

        {sources.length ? (
          <div className="space-y-2">
            {sources.map((source) => (
              <div
                key={source.repoId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{source.fullName}</p>
                  <p className="text-xs text-muted-foreground">
                    {source.defaultBranch ?? 'main'} · {source.cadence}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={source.cadence}
                    onChange={(event) =>
                      setCadence(source.repoId, event.target.value as WikiCodeSource['cadence'])
                    }
                    disabled={mutation.isPending}
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="manual">Manual</option>
                    <option value="nightly">Nightly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => removeSource(source.repoId)}
                    disabled={mutation.isPending}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No repositories selected for wiki ingestion yet.
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Available GitHub repositories</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => repositoriesQuery.refetch()}
              disabled={repositoriesQuery.isFetching || !config}
            >
              <RefreshCw
                className={cn('mr-2 h-4 w-4', repositoriesQuery.isFetching && 'animate-spin')}
              />
              Sync view
            </Button>
          </div>
          {repositoriesQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : repositoriesQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Could not load GitHub repositories</AlertTitle>
              <AlertDescription>
                {repositoriesQuery.error instanceof Error
                  ? repositoriesQuery.error.message
                  : 'Connect the GitHub App first.'}
              </AlertDescription>
            </Alert>
          ) : availableRepositories.length ? (
            <div className="max-h-72 space-y-1 overflow-auto rounded-lg border p-2">
              {availableRepositories.slice(0, 12).map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => addSource(repo)}
                  disabled={mutation.isPending}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{repo.fullName}</span>
                    <span className="text-xs text-muted-foreground">
                      {repo.defaultBranch ?? 'main'} · {repo.language ?? 'unknown'}
                    </span>
                  </span>
                  <Badge variant="outline">Add</Badge>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              All connected repositories are already selected, or no repositories are synced yet.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RunLauncher({ hasConfig }: { hasConfig: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [repoPath, setRepoPath] = useState('');
  const [repoSlug, setRepoSlug] = useState('');
  const [model, setModel] = useState('gpt-5.5');
  const [codexHome, setCodexHome] = useState('');
  const [promptText, setPromptText] = useState('');

  useEffect(() => {
    if (!repoSlug && repoPath.trim()) setRepoSlug(deriveSlug(repoPath));
  }, [repoPath, repoSlug]);

  const mutation = useMutation({
    mutationFn: api.securityWiki.runCodeIngestion,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['security-wiki', 'runs'] });
      toast({
        title: 'CODE wiki ingestion started',
        description: `Workflow run ${result.workflowRunId} is updating the wiki.`,
      });
    },
    onError: (error) => {
      toast({
        title: 'Failed to start CODE ingestion',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Workflow className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-lg">Update wiki</CardTitle>
            <CardDescription>
              Ask an agent to read a repository and write durable security notes back into the wiki.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="repo-path">Repository path</Label>
          <Input
            id="repo-path"
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
            placeholder="/workspace/repos/studio"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="repo-slug">Repo slug</Label>
          <Input
            id="repo-slug"
            value={repoSlug}
            onChange={(event) => setRepoSlug(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="model">Agent model</Label>
          <Input id="model" value={model} onChange={(event) => setModel(event.target.value)} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="codex-home">Codex home override</Label>
          <Input
            id="codex-home"
            value={codexHome}
            onChange={(event) => setCodexHome(event.target.value)}
            placeholder="Optional path passed to the Codex workflow component"
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="prompt-text">Prompt override</Label>
          <Textarea
            id="prompt-text"
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
            placeholder="Optional. Leave blank to use the production code-explorer prompt."
            className="min-h-24"
          />
        </div>
        <div className="md:col-span-2">
          <Button
            disabled={!hasConfig || !repoPath.trim() || !repoSlug.trim() || mutation.isPending}
            onClick={() =>
              mutation.mutate({
                repoPath: repoPath.trim(),
                repoSlug: repoSlug.trim(),
                agentName: 'code-explorer-agent',
                model: model.trim() || 'gpt-5.5',
                codexHome: codexHome.trim() || undefined,
                promptText: promptText.trim() || undefined,
              })
            }
          >
            {mutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Start wiki update
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RunsPanel({
  selectedPath,
  onSelectPath,
}: {
  selectedPath?: string;
  onSelectPath: (path: string) => void;
}) {
  const runsQuery = useQuery({
    queryKey: ['security-wiki', 'runs'],
    queryFn: api.securityWiki.listRuns,
    refetchInterval: 15000,
  });
  const latestWorkflowRunId = workflowRunId(runsQuery.data?.[0]);
  const statusQuery = useQuery({
    queryKey: ['security-wiki', 'workflow-status', latestWorkflowRunId],
    queryFn: () => fetchWorkflowStatus(latestWorkflowRunId!),
    enabled: Boolean(latestWorkflowRunId),
    refetchInterval: 10000,
  });
  const latestStatus = statusQuery.data?.status ?? runsQuery.data?.[0]?.status;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Runs and outputs</CardTitle>
            <CardDescription>
              Wiki run records with workflow status and changed files when available.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => runsQuery.refetch()}
            disabled={runsQuery.isFetching}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', runsQuery.isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {runsQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : runsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load runs</AlertTitle>
            <AlertDescription>
              {runsQuery.error instanceof Error ? runsQuery.error.message : 'Unknown error'}
            </AlertDescription>
          </Alert>
        ) : runsQuery.data?.length ? (
          runsQuery.data.slice(0, 8).map((run, index) => {
            const runWorkflowId = workflowRunId(run);
            const runWorkflowIdForRoute = workflowId(run);
            const displayStatus = index === 0 && latestStatus ? latestStatus : run.status;
            const files = changedFiles(run);
            return (
              <div key={run.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {statusVariant(displayStatus) === 'destructive' ? (
                        <XCircle className="h-4 w-4 text-destructive" />
                      ) : statusVariant(displayStatus) === 'default' ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <GitBranch className="h-4 w-4 text-muted-foreground" />
                      )}
                      <p className="truncate text-sm font-semibold">{run.repoSlug}</p>
                      <Badge variant={statusVariant(displayStatus)}>{displayStatus}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {run.agentName} · {run.model} · {formatDate(run.startedAt ?? run.createdAt)}
                    </p>
                  </div>
                  {runWorkflowId && runWorkflowIdForRoute ? (
                    <Link
                      to={`/workflows/${runWorkflowIdForRoute}/runs/${runWorkflowId}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Open workflow run
                    </Link>
                  ) : null}
                </div>
                {run.error ? <p className="mt-2 text-sm text-destructive">{run.error}</p> : null}
                {files.length ? (
                  <div className="mt-3 space-y-1">
                    {files.slice(0, 6).map((file) => (
                      <button
                        key={file}
                        type="button"
                        onClick={() => onSelectPath(file)}
                        className={cn(
                          'block w-full truncate rounded-md px-2 py-1 text-left text-xs hover:bg-muted',
                          selectedPath === file && 'bg-primary/10 text-primary',
                        )}
                      >
                        {file}
                      </button>
                    ))}
                    {files.length > 6 ? (
                      <p className="px-2 text-xs text-muted-foreground">
                        +{files.length - 6} more changed files
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Changed files will appear after the runtime writes validation/output metadata.
                  </p>
                )}
              </div>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No CODE wiki ingestion runs yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OverviewPanel({
  config,
  filesCount,
  onOpenFile,
}: {
  config?: SecurityWikiConfig;
  filesCount: number;
  onOpenFile: (path: string) => void;
}) {
  const runsQuery = useQuery({
    queryKey: ['security-wiki', 'runs'],
    queryFn: api.securityWiki.listRuns,
    refetchInterval: 15000,
  });
  const sources = codeSources(config);
  const latestRun = runsQuery.data?.[0];
  const latestFiles = changedFiles(latestRun);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-lg">
            <CardHeader className="pb-2">
              <CardDescription>Wiki files</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{filesCount}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Agent-readable pages available in the security memory.
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader className="pb-2">
              <CardDescription>Code sources</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{sources.length}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Repositories configured to refresh the wiki.
            </CardContent>
          </Card>
          <Card className="rounded-lg">
            <CardHeader className="pb-2">
              <CardDescription>Latest run</CardDescription>
              <CardTitle className="text-lg">
                {latestRun ? (
                  <Badge variant={statusVariant(latestRun.status)}>{latestRun.status}</Badge>
                ) : (
                  'No runs'
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {latestRun
                ? formatDate(latestRun.startedAt ?? latestRun.createdAt)
                : 'Start one from Runs.'}
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-lg">What this wiki is for</CardTitle>
            <CardDescription>
              A compact product security memory that agents can read before review and update after
              discovery.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
            <div className="rounded-lg bg-muted/40 p-4">
              <p className="font-medium text-foreground">Read</p>
              <p className="mt-1">
                Open the Wiki tab to inspect facts, assumptions, deployment maps, and security
                surfaces.
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-4">
              <p className="font-medium text-foreground">Refresh</p>
              <p className="mt-1">
                Use Runs when a repo changed or when the wiki needs a deeper agent pass.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="text-lg">Recent output</CardTitle>
          <CardDescription>Files touched by the latest wiki update.</CardDescription>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-5/6" />
            </div>
          ) : latestFiles.length ? (
            <div className="space-y-1">
              {latestFiles.slice(0, 8).map((file) => (
                <button
                  key={file}
                  type="button"
                  onClick={() => onOpenFile(file)}
                  className="block w-full truncate rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                >
                  {file}
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No changed-file output has been recorded yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WikiBrowser({
  treeQuery,
  filesCount,
  selectedPath,
  search,
  onSearch,
  onSelectPath,
  fileQuery,
}: {
  treeQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof api.securityWiki.getTree>>>>;
  filesCount: number;
  selectedPath?: string;
  search: string;
  onSearch: (value: string) => void;
  onSelectPath: (path: string) => void;
  fileQuery: ReturnType<typeof useQuery<SecurityWikiFile>>;
}) {
  const treeError = treeQuery.error instanceof Error ? treeQuery.error.message : null;

  return (
    <div className="grid min-h-[660px] flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="min-h-0 overflow-hidden rounded-lg">
        <CardHeader className="space-y-3 pb-3">
          <div>
            <CardTitle className="text-base">Files</CardTitle>
            {treeQuery.data ? (
              <p className="text-sm text-muted-foreground">
                {treeQuery.data.repoName ?? 'Active wiki'} ·{' '}
                <span className="tabular-nums">{filesCount}</span> files
              </p>
            ) : null}
          </div>
          <Input
            placeholder="Search files..."
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </CardHeader>
        <CardContent className="min-h-0 p-0">
          <ScrollArea className="h-[600px] px-3 pb-4">
            {treeQuery.isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-5/6" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ) : treeQuery.isError ? (
              <div className="p-4 text-sm text-muted-foreground">
                {treeError ??
                  'Wiki browsing is unavailable until a readable local checkout is configured.'}
              </div>
            ) : treeQuery.data?.tree.length ? (
              <WikiTree
                nodes={treeQuery.data.tree}
                selectedPath={selectedPath}
                search={search}
                onSelect={onSelectPath}
              />
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                No wiki files found yet. Run CODE wiki ingestion to populate this org memory.
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="min-h-0 overflow-hidden rounded-lg">
        <CardHeader className="border-b pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="truncate text-lg">
                {selectedPath ?? 'Select a wiki file'}
              </CardTitle>
              {fileQuery.data ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary">{fileQuery.data.extension || 'file'}</Badge>
                  <span className="tabular-nums">
                    {new Intl.NumberFormat().format(fileQuery.data.size)} bytes
                  </span>
                  <span>Updated {new Date(fileQuery.data.updatedAt).toLocaleString()}</span>
                </div>
              ) : null}
            </div>
            {selectedPath ? (
              <Button
                variant="outline"
                size="sm"
                className="active:scale-[0.96] transition-transform"
                onClick={() => navigator.clipboard?.writeText(selectedPath)}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy path
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <ScrollArea className="h-[600px]">
          <CardContent className="p-6">
            {!selectedPath ? (
              <div className="flex h-72 flex-col items-center justify-center rounded-lg border border-dashed text-center">
                <FolderOpen className="mb-3 h-10 w-10 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Pick a file</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select any wiki markdown file from the explorer.
                </p>
              </div>
            ) : fileQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : fileQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Could not load file</AlertTitle>
                <AlertDescription>
                  {fileQuery.error instanceof Error
                    ? fileQuery.error.message
                    : 'The selected wiki file could not be read.'}
                </AlertDescription>
              </Alert>
            ) : fileQuery.data ? (
              <FilePreview file={fileQuery.data} />
            ) : null}
          </CardContent>
        </ScrollArea>
      </Card>
    </div>
  );
}

export default function SecurityWikiPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPath = searchParams.get('path') ?? undefined;
  const search = searchParams.get('q') ?? '';

  const configQuery = useQuery({
    queryKey: ['security-wiki', 'config'],
    queryFn: api.securityWiki.getConfig,
    retry: false,
  });
  const treeQuery = useQuery({
    queryKey: ['security-wiki', 'tree'],
    queryFn: api.securityWiki.getTree,
    retry: false,
  });

  const files = useMemo(() => flattenFiles(treeQuery.data?.tree ?? []), [treeQuery.data?.tree]);
  const selectedNode = selectedPath
    ? findNode(treeQuery.data?.tree ?? [], selectedPath)
    : undefined;

  useEffect(() => {
    if (!selectedPath && files.length > 0) {
      const firstMarkdown = files.find(
        (file) => file.extension === 'md' || file.extension === 'mdx',
      );
      const firstFile = firstMarkdown ?? files[0];
      setSearchParams(
        (next) => {
          next.set('path', firstFile.path);
          return next;
        },
        { replace: true },
      );
    }
  }, [files, selectedPath, setSearchParams]);

  const fileQuery = useQuery({
    queryKey: ['security-wiki', 'file', selectedPath],
    queryFn: () => api.securityWiki.getFile(selectedPath!),
    enabled: Boolean(selectedPath && selectedNode?.type === 'file'),
  });

  const updateSearch = (value: string) => {
    setSearchParams((next) => {
      if (value) next.set('q', value);
      else next.delete('q');
      return next;
    });
  };

  const selectPath = (path: string) => {
    setSearchParams((next) => {
      next.set('path', path);
      return next;
    });
  };

  const config = configQuery.data;
  const configError = configQuery.error instanceof Error ? configQuery.error.message : null;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>ShipSec</span>
            <ChevronRight className="h-4 w-4" />
            <span>Security Wiki</span>
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Security Wiki</h1>
          <p className="mt-1 max-w-3xl text-muted-foreground">
            Product security memory for agents and humans: what exists, what matters, what changed,
            and what still needs proof.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void configQuery.refetch();
            void treeQuery.refetch();
          }}
          disabled={configQuery.isFetching || treeQuery.isFetching}
        >
          <RefreshCw
            className={cn(
              'mr-2 h-4 w-4',
              (configQuery.isFetching || treeQuery.isFetching) && 'animate-spin',
            )}
          />
          Refresh
        </Button>
      </div>

      {configQuery.isError ? (
        <Alert>
          <Settings className="h-4 w-4" />
          <AlertTitle>Configure the security wiki</AlertTitle>
          <AlertDescription>
            {configError ?? 'No active security wiki is configured for this organization.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col gap-4">
        <TabsList className="h-auto w-fit rounded-lg p-1">
          <TabsTrigger value="overview" className="gap-2 px-4 active:scale-[0.96]">
            <LayoutDashboard className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="wiki" className="gap-2 px-4 active:scale-[0.96]">
            <BookOpenText className="h-4 w-4" />
            Wiki
          </TabsTrigger>
          <TabsTrigger value="runs" className="gap-2 px-4 active:scale-[0.96]">
            <Workflow className="h-4 w-4" />
            Runs
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2 px-4 active:scale-[0.96]">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="m-0">
          <OverviewPanel config={config} filesCount={files.length} onOpenFile={selectPath} />
        </TabsContent>

        <TabsContent value="wiki" className="m-0 min-h-0 flex-1">
          <WikiBrowser
            treeQuery={treeQuery}
            filesCount={files.length}
            selectedPath={selectedPath}
            search={search}
            onSearch={updateSearch}
            onSelectPath={selectPath}
            fileQuery={fileQuery}
          />
        </TabsContent>

        <TabsContent value="runs" className="m-0">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
            <RunLauncher hasConfig={Boolean(config)} />
            <RunsPanel selectedPath={selectedPath} onSelectPath={selectPath} />
          </div>
        </TabsContent>

        <TabsContent value="settings" className="m-0">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
            <div className="space-y-4">
              <CodeSourcesPanel config={config} />
              <Alert>
                <Workflow className="h-4 w-4" />
                <AlertTitle>Execution details</AlertTitle>
                <AlertDescription>
                  Wiki updates run through {CODE_WIKI_TEMPLATE_SLUG} using {CODE_WIKI_COMPONENT_ID}.
                  This is shown here for debugging, not day-to-day use.
                </AlertDescription>
              </Alert>
            </div>
            <ConfigCard config={config} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

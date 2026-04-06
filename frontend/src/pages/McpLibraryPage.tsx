import { useEffect, useMemo, useState, useCallback } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SecretSelect } from '@/components/inputs/SecretSelect';
import { KeyRound } from 'lucide-react';
// Card components removed from render — kept in file for future use
import { McpDiscoveryPreview } from '@/components/mcp/McpDiscoveryPreview';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Search,
  Plus,
  ArrowDownToLine,
  Trash2,
  Edit3,
  RefreshCw,
  Plug,
  Wrench,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  FileJson,
  Layers,
  Cloud,
  Package,
  Globe,
  Loader,
  Loader2,
  CheckCircle,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useMcpServers,
  useMcpServerTemplates,
  useMcpAllTools,
  useCreateMcpServer,
  useUpdateMcpServer,
  useDeleteMcpServer,
  useToggleMcpServer,
  useTestMcpConnection,
  useFetchServerTools,
  useToggleMcpTool,
  useDiscoverMcpTools,
  useImportMcpServerTemplate,
  type McpServerTemplateResponse,
} from '@/hooks/queries/useMcpServerQueries';
import { useMcpGroupsWithServers, useMcpGroupTemplates } from '@/hooks/queries/useMcpGroupQueries';
import { useGitHubInstallations } from '@/hooks/queries/useGithubQueries';
import { queryKeys } from '@/lib/queryKeys';
import { useToast } from '@/components/ui/use-toast';
import {
  mcpGroupsApi,
  type McpGroupTemplateResponse,
  type McpGroupServerResponse,
} from '@/services/mcpGroupsApi';
import { mcpDiscoveryApi } from '@/services/mcpDiscoveryApi';
import type { McpHealthStatus, CreateMcpServer } from '@shipsec/shared';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/ui/markdown';
import { env } from '@/config/env';

const TRANSPORT_TYPES = [
  { value: 'http', label: 'HTTP' },
  { value: 'stdio', label: 'stdio (Local)' },
] as const;

type TransportType = (typeof TRANSPORT_TYPES)[number]['value'];

// Group icon mapping for visual distinction
function getGroupIcon(groupSlug: string, groupName: string) {
  const slug = groupSlug.toLowerCase();
  const name = groupName.toLowerCase();

  if (slug === 'aws' || name.includes('aws') || name.includes('amazon')) return Cloud;
  if (slug.includes('github') || name.includes('github')) return Package;
  if (slug.includes('gcp') || name.includes('gcp') || name.includes('google')) return Globe;
  return Package;
}

function getGroupLogoUrl(groupSlug: string) {
  const slug = groupSlug.toLowerCase();

  // Use reliable first-party CDNs for well-known providers
  const directLogoMap: Record<string, string> = {
    github: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
  };
  if (directLogoMap[slug]) return directLogoMap[slug];

  // Fall back to logo.dev for everything else
  const domainMap: Record<string, string> = {
    aws: 'aws.amazon.com',
  };
  const domain = domainMap[slug];
  if (!domain || !env.VITE_LOGO_DEV_PUBLIC_KEY) return null;

  return `https://img.logo.dev/${domain}?token=${env.VITE_LOGO_DEV_PUBLIC_KEY}`;
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 98 96"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-5 w-5', className)}
      aria-hidden="true"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0 1 12.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z"
      />
    </svg>
  );
}

function GroupLogo({ slug, name, className }: { slug: string; name: string; className?: string }) {
  const s = slug.toLowerCase();
  const isGitHub = s === 'github' || name.toLowerCase().includes('github');
  const logoUrl = isGitHub ? null : getGroupLogoUrl(slug);
  const FallbackIcon = getGroupIcon(slug, name);
  const [showFallback, setShowFallback] = useState(!logoUrl);

  if (isGitHub) {
    return <GitHubMark className={className} />;
  }

  if (showFallback) {
    return <FallbackIcon className={className} aria-hidden="true" />;
  }

  return (
    <img
      src={logoUrl ?? undefined}
      alt={`${name} logo`}
      className={cn('h-5 w-5 object-contain dark:invert')}
      onError={() => setShowFallback(true)}
    />
  );
}

function getGroupTheme(groupSlug: string) {
  if (groupSlug === 'aws') {
    return {
      container: 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800',
      headerBorder: 'border-orange-200 dark:border-orange-800',
      iconWrapper: 'bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800',
      iconText: 'text-orange-700 dark:text-orange-300',
      pillBorder: 'border-orange-200 dark:border-orange-800',
      accentText: 'text-orange-700 dark:text-orange-300',
    };
  }

  return {
    container: 'bg-background border-border',
    headerBorder: 'border-border',
    iconWrapper: 'bg-muted border-border',
    iconText: 'text-muted-foreground',
    pillBorder: 'border-border',
    accentText: 'text-muted-foreground',
  };
}

function HealthIndicator({
  status,
  checking,
}: {
  status: McpHealthStatus | null;
  checking?: boolean;
}) {
  const statusConfig = {
    healthy: { icon: CheckCircle2, color: 'text-green-500', label: 'Healthy' },
    unhealthy: { icon: AlertCircle, color: 'text-red-500', label: 'Unhealthy' },
    unknown: { icon: HelpCircle, color: 'text-gray-400', label: 'Not checked' },
  };

  if (checking) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <div className="flex items-center gap-1.5">
            <RefreshCw className="h-4 w-4 text-blue-500 animate-spin" />
            <span className="text-xs text-muted-foreground">Checking...</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Checking server status...</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  const config = statusConfig[status ?? 'unknown'];
  const Icon = config.icon;

  return (
    <Tooltip>
      <TooltipTrigger>
        <div className="flex items-center gap-1.5">
          <Icon className={cn('h-4 w-4', config.color)} />
          <span className="text-xs text-muted-foreground">{config.label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>Server status: {config.label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function TransportBadge({ type }: { type?: TransportType | null }) {
  const variants: Record<TransportType, 'default' | 'secondary' | 'outline'> = {
    http: 'default',
    stdio: 'outline',
  };

  const safeType: TransportType = type ?? 'http';
  const label = type ? type.toUpperCase() : 'UNKNOWN';

  return (
    <Badge variant={variants[safeType]} className="text-xs">
      {label}
    </Badge>
  );
}

function StatusBadge({
  status,
  variant,
}: {
  status: string;
  variant: 'success' | 'warning' | 'muted';
}) {
  const styles = {
    success:
      'bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
    warning:
      'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    muted: 'bg-muted text-muted-foreground border-border',
  };
  return (
    <Badge variant="outline" className={cn('text-xs whitespace-nowrap', styles[variant])}>
      {status}
    </Badge>
  );
}

const CURATED_COLS = 'md:grid-cols-[minmax(200px,2fr)_120px_100px_100px_minmax(160px,1fr)_32px]';

function CuratedOverviewHeader() {
  return (
    <div
      className={cn(
        'hidden md:grid px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground bg-muted/50 border-b items-center gap-x-3',
        CURATED_COLS,
      )}
    >
      <span>Name</span>
      <span>Status</span>
      <span>Scope</span>
      <span>Tools</span>
      <span className="text-right">Actions</span>
      <span />
    </div>
  );
}

/** Consistent grid row for all curated items */
function CuratedRow({
  logo,
  name,
  description,
  status,
  statusVariant,
  scope,
  toolsSummary,
  actions,
  accordionTrigger,
}: {
  logo: React.ReactNode;
  name: string;
  description?: string | null;
  status: string;
  statusVariant: 'success' | 'warning' | 'muted';
  scope?: string;
  toolsSummary?: string;
  actions?: React.ReactNode;
  accordionTrigger?: boolean;
}) {
  return (
    <div
      className={cn(
        'px-4 py-3 hover:bg-muted/30 transition-colors border-b last:border-b-0',
        'grid grid-cols-[1fr_auto] items-center gap-x-3',
        `md:grid ${CURATED_COLS}`,
      )}
    >
      {/* Name cell (logo + text) */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0">{logo}</div>
        <div className="min-w-0">
          <span className="font-medium text-sm truncate block">{name}</span>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{description}</p>
          )}
        </div>
      </div>

      {/* Status */}
      <div className="hidden md:block">
        <StatusBadge status={status} variant={statusVariant} />
      </div>

      {/* Scope */}
      <span className="hidden md:block text-xs text-muted-foreground">{scope ?? '—'}</span>

      {/* Tools */}
      <span className="hidden md:block text-xs text-muted-foreground">{toolsSummary ?? '—'}</span>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end">
        <div className="md:hidden mr-1">
          <StatusBadge status={status} variant={statusVariant} />
        </div>
        {actions}
      </div>

      {/* Accordion chevron */}
      {accordionTrigger ? (
        <AccordionTrigger className="hover:no-underline p-0 [&>svg]:h-4 [&>svg]:w-4 shrink-0" />
      ) : (
        <span />
      )}
    </div>
  );
}

interface ServerFormData {
  name: string;
  description: string;
  transportType: TransportType;
  endpoint: string;
  command: string;
  args: string;
  headers: string;
  healthCheckUrl: string;
  enabled: boolean;
}

interface HeaderEntry {
  key: string;
  value: string;
  secretId?: string; // If set, value references a secret by ID
}

const INITIAL_FORM_DATA: ServerFormData = {
  name: '',
  description: '',
  transportType: 'http',
  endpoint: '',
  command: '',
  args: '',
  headers: '',
  healthCheckUrl: '',
  enabled: true,
};

export function McpLibraryPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [formData, setFormData] = useState<ServerFormData>(INITIAL_FORM_DATA);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [checkingServers, setCheckingServers] = useState<Set<string>>(new Set());
  const [toolsDialogOpen, setToolsDialogOpen] = useState(false);
  const [selectedServerForTools, setSelectedServerForTools] = useState<string | null>(null);
  const [jsonValue, setJsonValue] = useState('');
  const [jsonParseError, setJsonParseError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isTestingDiscovery, setIsTestingDiscovery] = useState(false);
  const [discoveryPreview, setDiscoveryPreview] = useState<
    | {
        name: string;
        transportType: 'http' | 'stdio';
        toolCount: number;
        tools?: { name: string; description?: string }[];
        error?: string;
        status: 'pending' | 'discovering' | 'completed' | 'failed';
        cacheToken?: string;
      }[]
    | null
  >(null);
  const [discoveryCacheTokens, setDiscoveryCacheTokens] = useState<
    Map<
      string,
      {
        cacheToken: string;
        tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
      }
    >
  >(new Map());
  const [activeTab, setActiveTab] = useState<'manual' | 'json'>('manual');
  const [headerEntries, setHeaderEntries] = useState<HeaderEntry[]>([]);
  const [secretPickerEntryIndex, setSecretPickerEntryIndex] = useState<number | null>(null);
  const [discoveringServerIds, setDiscoveringServerIds] = useState<Set<string>>(new Set());
  const { data: groupTemplates = [], isLoading: isLoadingTemplates } = useMcpGroupTemplates();
  const [importingTemplates, setImportingTemplates] = useState<Set<string>>(new Set());
  const [_templatesOpen, setTemplatesOpen] = useState(true);
  const [templatesManuallyToggled, _setTemplatesManuallyToggled] = useState(false);
  // Group template discovery preview state - keyed by template slug
  const [groupDiscoveryPreview, setGroupDiscoveryPreview] = useState<
    Record<
      string,
      {
        name: string;
        transportType: 'http' | 'stdio';
        toolCount: number;
        tools?: { name: string; description?: string }[];
        error?: string;
        status: 'pending' | 'discovering' | 'completed' | 'failed';
        cacheToken?: string;
      }[]
    >
  >({});
  const [discoveringGroups, setDiscoveringGroups] = useState<Set<string>>(new Set());
  const [curatedAccordionValue, setCuratedAccordionValue] = useState<string[]>([]);
  const [serverTemplateReadOnly, setServerTemplateReadOnly] = useState<Record<string, boolean>>({});
  const [discoveryStatus, setDiscoveryStatus] = useState<{
    workflowId?: string;
    status?: 'running' | 'completed' | 'failed';
    tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
    toolCount?: number;
    error?: string;
  } | null>(null);

  const queryClient = useQueryClient();
  const { data: servers = [], isLoading, error: serversError } = useMcpServers();
  const { data: serverTemplates = [], isLoading: isLoadingServerTemplates } =
    useMcpServerTemplates();
  const { data: tools = [] } = useMcpAllTools();
  const { data: githubInstallations = [] } = useGitHubInstallations();
  const error = serversError?.message ?? null;
  const { data: groups = [] } = useMcpGroupsWithServers();

  // Mutation hooks
  const createServerMutation = useCreateMcpServer();
  const updateServerMutation = useUpdateMcpServer();
  const deleteServerMutation = useDeleteMcpServer();
  const toggleServerMutation = useToggleMcpServer();
  const testConnectionMutation = useTestMcpConnection();
  const fetchServerToolsMutation = useFetchServerTools();
  const toggleToolMutation = useToggleMcpTool();
  const discoverToolsMutation = useDiscoverMcpTools();
  const importServerTemplateMutation = useImportMcpServerTemplate();

  const getTemplateStateKey = useCallback(
    (slug: string, installationId?: number) =>
      installationId ? `${slug}:${installationId}` : slug,
    [],
  );

  const getGroupServers = useCallback(
    (groupId: string): McpGroupServerResponse[] => {
      return groups.find((g) => g.id === groupId)?.servers ?? [];
    },
    [groups],
  );

  // Templates are now fetched via useMcpGroupTemplates() hook above.

  // Default: show templates when no groups are installed; collapse when groups exist.
  useEffect(() => {
    if (templatesManuallyToggled) return;
    setTemplatesOpen(groups.length === 0);
  }, [groups.length, templatesManuallyToggled]);

  // Sync JSON config to Manual form when valid single-server JSON is entered
  useEffect(() => {
    if (!jsonValue.trim() || editingServer) return;

    const { servers: parsedServers, error } = parseClaudeCodeConfig(jsonValue);
    if (error || parsedServers.length !== 1) return;

    // Only sync if JSON tab is active and the form data differs
    const parsedConfig = parsedServers[0].config;
    if (activeTab === 'json' && parsedConfig.name !== formData.name) {
      setFormData(parsedConfig);
    }
  }, [jsonValue, activeTab, editingServer]);

  // Populate header entries when editing a server
  useEffect(() => {
    if (!editingServer) return;
    const server = servers.find((s) => s.id === editingServer);
    if (server?.headerKeys && server.headerKeys.length > 0) {
      setHeaderEntries(server.headerKeys.map((key) => ({ key, value: '' })));
    } else {
      setHeaderEntries([]);
    }
  }, [editingServer, servers]);

  // Header entry management functions
  const addHeaderEntry = () => {
    setHeaderEntries((prev) => [...prev, { key: '', value: '' }]);
  };

  const updateHeaderEntry = (index: number, field: 'key' | 'value' | 'secretId', value: string) => {
    setHeaderEntries((prev) => {
      const updated = [...prev];
      if (field === 'secretId') {
        updated[index] = { ...updated[index], secretId: value || undefined, value: '' };
      } else {
        updated[index] = { ...updated[index], [field]: value, secretId: undefined };
      }
      return updated;
    });
  };

  const removeHeaderEntry = (index: number) => {
    setHeaderEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const groupedServerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const server of servers) {
      if (server.groupId) {
        ids.add(server.id);
      }
    }
    for (const group of groups) {
      for (const server of getGroupServers(group.id)) {
        ids.add(server.serverId);
      }
    }
    return ids;
  }, [servers, groups, getGroupServers]);

  const filteredCustomServers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const customServers = servers.filter(
      (server) => !groupedServerIds.has(server.id) && !server.templateSlug,
    );

    if (!query) return customServers;

    return customServers.filter(
      (server) =>
        server.name.toLowerCase().includes(query) ||
        server.description?.toLowerCase().includes(query) ||
        server.endpoint?.toLowerCase().includes(query),
    );
  }, [servers, searchQuery, groupedServerIds]);

  const importedGroupSlugs = useMemo(() => new Set(groups.map((group) => group.slug)), [groups]);

  const filteredTemplates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groupTemplates;

    return groupTemplates.filter(
      (template) =>
        template.name.toLowerCase().includes(query) ||
        template.slug.toLowerCase().includes(query) ||
        template.description?.toLowerCase().includes(query),
    );
  }, [groupTemplates, searchQuery]);

  const filteredServerTemplates = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return serverTemplates;

    return serverTemplates.filter(
      (template) =>
        template.name.toLowerCase().includes(query) ||
        template.slug.toLowerCase().includes(query) ||
        template.description?.toLowerCase().includes(query),
    );
  }, [serverTemplates, searchQuery]);

  const githubImportedServersByInstallationId = useMemo(() => {
    const map = new Map<number, (typeof servers)[number]>();
    for (const server of servers) {
      if (server.templateSlug === 'github' && typeof server.githubInstallationId === 'number') {
        map.set(server.githubInstallationId, server);
      }
    }
    return map;
  }, [servers]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groups;

    return groups.filter(
      (group) =>
        group.name.toLowerCase().includes(query) ||
        group.slug.toLowerCase().includes(query) ||
        group.description?.toLowerCase().includes(query),
    );
  }, [groups, searchQuery]);

  // Calculate tool counts per server (enabled/total)
  const toolCountsByServer = useMemo(() => {
    const counts: Record<string, { enabled: number; total: number }> = {};
    for (const server of servers) {
      const serverTools = tools.filter((t) => t.serverId === server.id);
      counts[server.id] = {
        enabled: serverTools.filter((t) => t.enabled).length,
        total: serverTools.length,
      };
    }
    return counts;
  }, [servers, tools]);

  const getGroupServerHealthStatus = (server: {
    id: string;
    serverId: string;
    healthStatus: McpHealthStatus;
  }) =>
    servers.find((s) => s.id === (server.serverId || server.id))?.lastHealthStatus ??
    server.healthStatus;

  const getGroupServerToolCounts = (server: {
    id: string;
    serverId: string;
    toolCount: number;
  }) => {
    const serverId = server.serverId || server.id;
    const counts = toolCountsByServer[serverId];
    // If we haven't loaded tools for this server (common for disabled servers),
    // don't let a 0/0 cache override the server's known discovered toolCount.
    if (counts && !(counts.total === 0 && server.toolCount > 0)) {
      return counts;
    }
    const fallbackTotal = server.toolCount;
    return fallbackTotal > 0 ? { enabled: fallbackTotal, total: fallbackTotal } : null;
  };

  const getServerDiscoveryImage = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    if (!server?.groupId) return undefined;
    const group = groups.find((g) => g.id === server.groupId);
    return group?.defaultDockerImage ?? undefined;
  };

  const renderServerTableHeader = () => (
    <TableHeader>
      <TableRow>
        <TableHead className="w-[200px]">Name</TableHead>
        <TableHead className="w-[100px]">Type</TableHead>
        <TableHead>Connection</TableHead>
        <TableHead className="w-[120px]">Status</TableHead>
        <TableHead className="w-[80px] text-center">Tools</TableHead>
        <TableHead className="w-[100px] text-center">Enabled</TableHead>
        <TableHead className="w-[180px] text-right">Actions</TableHead>
      </TableRow>
    </TableHeader>
  );

  const renderConnectionCell = (connection: {
    endpoint?: string | null;
    command?: string | null;
    args?: string[] | null;
  }) => {
    if (connection.endpoint) {
      return (
        <Tooltip>
          <TooltipTrigger className="text-left">
            <div className="font-mono text-sm text-muted-foreground truncate max-w-[300px]">
              {connection.endpoint}
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[400px]">
            <p className="font-mono text-xs break-all">{connection.endpoint}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    if (connection.command) {
      return (
        <Tooltip>
          <TooltipTrigger className="text-left">
            <div className="font-mono text-sm text-muted-foreground truncate max-w-[300px]">
              {connection.command}
              {connection.args &&
                connection.args.length > 0 &&
                (() => {
                  const argsStr = connection.args.join(' ');
                  const MAX_INLINE_ARGS = 40;
                  if (argsStr.length <= MAX_INLINE_ARGS) {
                    return ` ${argsStr}`;
                  }
                  return ` +${connection.args.length} arg${
                    connection.args.length === 1 ? '' : 's'
                  }`;
                })()}
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-[400px]">
            <p className="font-mono text-xs break-all">
              {connection.command} {connection.args?.join(' ') || ''}
            </p>
          </TooltipContent>
        </Tooltip>
      );
    }

    return <span className="text-muted-foreground">—</span>;
  };

  // Generate Claude Code style JSON from form data (for JSON tab display)
  const formDataToJson = (data: ServerFormData, serverHeaderKeys?: string[] | null): string => {
    const serverConfig: Record<string, unknown> = {};

    if (data.transportType === 'stdio') {
      serverConfig.command = data.command;
      if (data.args.trim()) {
        serverConfig.args = data.args
          .split('\n')
          .map((a) => a.trim())
          .filter(Boolean);
      }
    } else {
      serverConfig.url = data.endpoint;
    }

    // Show existing header keys with masked values, plus any new headers from form
    const headersToShow: Record<string, string> = {};

    // Add existing headers with masked values
    if (serverHeaderKeys && serverHeaderKeys.length > 0) {
      for (const key of serverHeaderKeys) {
        headersToShow[key] = '****';
      }
    }

    // Add/override with new header entries that have values
    for (const entry of headerEntries) {
      if (entry.key.trim()) {
        if (entry.value.trim()) {
          headersToShow[entry.key] = '****'; // Mask new values too in JSON view
        } else if (entry.secretId) {
          headersToShow[entry.key] = '****';
        }
      }
    }

    if (Object.keys(headersToShow).length > 0) {
      serverConfig.headers = headersToShow;
    }

    return JSON.stringify(
      {
        mcpServers: {
          [data.name || 'server']: serverConfig,
        },
      },
      null,
      2,
    );
  };

  const handleCreateNew = () => {
    setEditingServer(null);
    setFormData(INITIAL_FORM_DATA);
    setJsonValue('');
    setJsonParseError(null);
    setDiscoveryStatus(null);
    setActiveTab('manual');
    setEditorOpen(true);
  };

  const handleEditorClose = (open: boolean) => {
    if (!open) {
      setDiscoveryStatus(null);
    }
    setEditorOpen(open);
  };

  const handleEdit = (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    if (!server) return;

    setEditingServer(serverId);
    setDiscoveryStatus(null);
    const editFormData: ServerFormData = {
      name: server.name,
      description: server.description ?? '',
      transportType: server.transportType,
      endpoint: server.endpoint ?? '',
      command: server.command ?? '',
      args: server.args?.join('\n') ?? '',
      headers: '', // Never show existing headers
      healthCheckUrl: '',
      enabled: server.enabled,
    };
    setFormData(editFormData);
    setJsonValue(formDataToJson(editFormData, server.headerKeys));
    setJsonParseError(null);
    setActiveTab('manual');
    setEditorOpen(true);
  };

  const handleTestAndDiscover = async () => {
    // Build headers from headerEntries
    const headersPayload = headerEntries
      .filter((e) => e.key.trim() && (e.value.trim() || e.secretId))
      .reduce(
        (acc, entry) => {
          const key = entry.key.trim();
          const value = entry.secretId ? `{{secret:${entry.secretId}}}` : entry.value.trim();
          acc[key] = value;
          return acc;
        },
        {} as Record<string, string>,
      );

    const input = {
      transport: formData.transportType,
      name: formData.name.trim(),
      endpoint: formData.transportType === 'http' ? formData.endpoint.trim() : undefined,
      headers: Object.keys(headersPayload).length > 0 ? headersPayload : undefined,
      command: formData.transportType === 'stdio' ? formData.command.trim() : undefined,
      args:
        formData.transportType === 'stdio' && formData.args.trim()
          ? formData.args
              .split('\n')
              .map((a) => a.trim())
              .filter(Boolean)
          : undefined,
    };

    try {
      const { workflowId } = await mcpDiscoveryApi.discover(input);
      setDiscoveryStatus({ workflowId, status: 'running' });

      const pollInterval = setInterval(async () => {
        try {
          const result = await mcpDiscoveryApi.getStatus(workflowId);

          if (result.status === 'completed') {
            clearInterval(pollInterval);
            setDiscoveryStatus({
              status: 'completed',
              tools: result.tools,
              toolCount: result.toolCount,
            });
          } else if (result.status === 'failed') {
            clearInterval(pollInterval);
            setDiscoveryStatus({
              status: 'failed',
              error: result.error,
            });
          }
        } catch (error) {
          clearInterval(pollInterval);
          setDiscoveryStatus({
            status: 'failed',
            error: error instanceof Error ? error.message : 'Discovery failed',
          });
        }
      }, 2000);

      // Cleanup interval on unmount
      return () => clearInterval(pollInterval);
    } catch (error) {
      setDiscoveryStatus({
        status: 'failed',
        error: error instanceof Error ? error.message : 'Failed to start discovery',
      });
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Build headers from headerEntries - include entries with value OR secretId
      const headersPayload = headerEntries
        .filter((e) => e.key.trim() && (e.value.trim() || e.secretId))
        .reduce(
          (acc, entry) => {
            const key = entry.key.trim();
            // Use secret reference format if secretId is set, otherwise use the value
            const value = entry.secretId ? `{{secret:${entry.secretId}}}` : entry.value.trim();
            acc[key] = value;
            return acc;
          },
          {} as Record<string, string>,
        );

      const payload: CreateMcpServer = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        transportType: formData.transportType,
        endpoint: formData.transportType === 'http' ? formData.endpoint.trim() : undefined,
        command: formData.transportType === 'stdio' ? formData.command.trim() : undefined,
        args:
          formData.transportType === 'stdio' && formData.args.trim()
            ? formData.args
                .split('\n')
                .map((a) => a.trim())
                .filter(Boolean)
            : undefined,
        headers: Object.keys(headersPayload).length > 0 ? headersPayload : undefined,
        enabled: true, // Always enabled on create, can toggle from list
      };

      if (editingServer) {
        // Mark as checking BEFORE the update to prevent "Unknown" flash
        setCheckingServers((prev) => new Set([...prev, editingServer]));
        await updateServerMutation.mutateAsync({ id: editingServer, input: payload });
        // Run health check after update to refresh status and tools
        testConnectionMutation
          .mutateAsync(editingServer)
          .then(async () => {
            // Invalidate queries to refresh tool counts and health status
            await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
            await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
          })
          .catch(() => {
            // Silently ignore health check errors on update
          })
          .finally(() => {
            setCheckingServers((prev) => {
              const next = new Set(prev);
              next.delete(editingServer);
              return next;
            });
          });
        toast({ title: 'Server updated', description: `${payload.name} has been updated.` });
      } else {
        const newServer = await createServerMutation.mutateAsync(payload);
        // Immediately add to checking set - batched with store update to prevent "Unknown" flash
        setCheckingServers((prev) => new Set([...prev, newServer.id]));
        // Run health check to set status and discover tools
        testConnectionMutation
          .mutateAsync(newServer.id)
          .then(async (result) => {
            // Invalidate queries to refresh tool counts and health status
            await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
            await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
            if (result.toolCount !== undefined && result.toolCount > 0) {
              toast({
                title: 'Server ready',
                description: `Discovered ${result.toolCount} tool(s) from ${payload.name}.`,
              });
            }
          })
          .catch(() => {
            // Silently ignore health check errors
          })
          .finally(() => {
            setCheckingServers((prev) => {
              const next = new Set(prev);
              next.delete(newServer.id);
              return next;
            });
          });
        toast({ title: 'Server created', description: `${payload.name} has been added.` });
      }

      setEditorOpen(false);
      setEditingServer(null);
      setFormData(INITIAL_FORM_DATA);
      setDiscoveryStatus(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save server',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!serverToDelete) return;

    setIsDeleting(true);
    try {
      await deleteServerMutation.mutateAsync(serverToDelete);
      toast({ title: 'Server deleted', description: 'MCP server has been removed.' });
      setDeleteDialogOpen(false);
      setServerToDelete(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to delete server',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleToggle = async (serverId: string) => {
    try {
      const server = await toggleServerMutation.mutateAsync(serverId);
      toast({
        title: server.enabled ? 'Server enabled' : 'Server disabled',
        description: `${server.name} has been ${server.enabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to toggle server',
        variant: 'destructive',
      });
    }
  };

  const handleTestConnection = async (serverId: string) => {
    setTestingServer(serverId);
    try {
      const result = await testConnectionMutation.mutateAsync(serverId);
      toast({
        title: result.success ? 'Connection successful' : 'Connection failed',
        description: result.message,
        variant: result.success ? 'default' : 'destructive',
      });
    } catch (err) {
      toast({
        title: 'Test failed',
        description: err instanceof Error ? err.message : 'Connection test failed',
        variant: 'destructive',
      });
    } finally {
      setTestingServer(null);
    }
  };

  const handleViewTools = async (serverId: string) => {
    setSelectedServerForTools(serverId);
    setToolsDialogOpen(true);
    await fetchServerToolsMutation.mutateAsync(serverId);
  };

  const handleDiscoverServerTools = async (serverId: string, image?: string) => {
    if (discoveringServerIds.has(serverId)) return;

    setDiscoveringServerIds((prev) => new Set(prev).add(serverId));
    try {
      const server = servers.find((item) => item.id === serverId);
      if (server?.templateSlug) {
        const result = await testConnectionMutation.mutateAsync(serverId);
        await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
        await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
        toast({
          title: result.success ? 'Tool discovery complete' : 'Discovery failed',
          description: result.message,
          variant: result.success ? 'default' : 'destructive',
        });
        return;
      }

      const tools = await discoverToolsMutation.mutateAsync({ serverId, servers, image });
      toast({
        title: 'Tool discovery complete',
        description: `Discovered ${tools.length} tool(s) from this server.`,
      });
    } catch (err) {
      toast({
        title: 'Discovery failed',
        description: err instanceof Error ? err.message : 'Failed to discover tools',
        variant: 'destructive',
      });
    } finally {
      setDiscoveringServerIds((prev) => {
        const next = new Set(prev);
        next.delete(serverId);
        return next;
      });
    }
  };

  const refreshTemplates = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.mcpGroups.templates() });
  };

  const handleGroupTestAndDiscover = async (template: McpGroupTemplateResponse) => {
    if (discoveringGroups.has(template.slug)) return;

    setDiscoveringGroups((prev) => new Set(prev).add(template.slug));

    // Initialize preview with pending status
    interface GroupDiscoveryRow {
      name: string;
      transportType: 'http' | 'stdio';
      toolCount: number;
      status: 'pending' | 'discovering' | 'completed' | 'failed';
      tools?: { name: string; description?: string }[];
      error?: string;
      cacheToken?: string;
    }

    const initialResults: GroupDiscoveryRow[] = template.servers.map((server) => ({
      name: server.name,
      transportType: server.transportType,
      toolCount: 0,
      status: 'pending',
      tools: undefined,
      error: undefined,
      cacheToken: undefined,
    }));
    setGroupDiscoveryPreview((prev) => ({
      ...prev,
      [template.slug]: initialResults,
    }));

    try {
      const results: GroupDiscoveryRow[] = [...initialResults].map((entry) => ({
        ...entry,
        status: 'discovering',
      }));
      setGroupDiscoveryPreview((prev) => ({ ...prev, [template.slug]: [...results] }));

      const { workflowId, cacheTokens } = await mcpDiscoveryApi.discoverGroup({
        image: template.defaultDockerImage,
        servers: template.servers.map((server) => ({
          transport: server.transportType,
          name: server.name,
          endpoint: server.transportType === 'http' ? (server.endpoint ?? undefined) : undefined,
          command: server.transportType === 'stdio' ? (server.command ?? undefined) : undefined,
          args: server.transportType === 'stdio' ? (server.args ?? undefined) : undefined,
        })),
      });

      const maxAttempts = 60;
      const pollInterval = 1000;
      let finished = false;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const status = await mcpDiscoveryApi.getGroupStatus(workflowId);

        if (status.status === 'completed') {
          const resultsByName = new Map(
            (status.results ?? []).map((result) => [result.name, result]),
          );

          const updated: GroupDiscoveryRow[] = template.servers.map((server) => {
            const result = resultsByName.get(server.name);
            if (!result) {
              return {
                name: server.name,
                transportType: server.transportType,
                toolCount: 0,
                status: 'failed',
                error: 'Discovery result missing',
              };
            }

            const tools = result.tools ?? [];
            return {
              name: server.name,
              transportType: server.transportType,
              toolCount: result.toolCount ?? tools.length,
              tools: tools.map((t) => ({ name: t.name, description: t.description })),
              status: result.status === 'completed' ? 'completed' : 'failed',
              error: result.error,
              cacheToken: result.cacheToken ?? cacheTokens[server.name],
            };
          });

          setGroupDiscoveryPreview((prev) => ({ ...prev, [template.slug]: updated }));
          const completedCount = updated.filter((r) => r.status === 'completed').length;
          toast({
            title: 'Discovery complete',
            description: `${completedCount}/${template.servers.length} servers discovered`,
          });
          finished = true;
          break;
        }

        if (status.status === 'failed') {
          const updated: GroupDiscoveryRow[] = template.servers.map((server) => ({
            name: server.name,
            transportType: server.transportType,
            toolCount: 0,
            status: 'failed',
            error: status.error ?? 'Discovery failed',
          }));
          setGroupDiscoveryPreview((prev) => ({ ...prev, [template.slug]: updated }));
          finished = true;
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }

      if (!finished) {
        const updated: GroupDiscoveryRow[] = template.servers.map((server) => ({
          name: server.name,
          transportType: server.transportType,
          toolCount: 0,
          status: 'failed',
          error: 'Discovery timed out',
        }));
        setGroupDiscoveryPreview((prev) => ({ ...prev, [template.slug]: updated }));
      }
    } catch (err) {
      toast({
        title: 'Discovery failed',
        description: err instanceof Error ? err.message : 'Failed to discover servers',
        variant: 'destructive',
      });
    } finally {
      setDiscoveringGroups((prev) => {
        const next = new Set(prev);
        next.delete(template.slug);
        return next;
      });
    }
  };

  const handleImportDiscoveredTemplate = async (template: McpGroupTemplateResponse) => {
    const preview = groupDiscoveryPreview[template.slug];
    if (!preview) {
      toast({
        title: 'No discovery data',
        description: 'Please run "Test & Discover" first',
        variant: 'destructive',
      });
      return;
    }

    if (importingTemplates.has(template.slug)) return;

    setImportingTemplates((prev) => new Set(prev).add(template.slug));
    try {
      // Collect cache tokens from completed discoveries
      const serverCacheTokens: Record<string, string> = {};
      for (const result of preview) {
        if (result.status === 'completed' && result.cacheToken) {
          serverCacheTokens[result.name] = result.cacheToken;
        }
      }

      const successCount = Object.keys(serverCacheTokens).length;
      if (successCount === 0) {
        toast({
          title: 'No servers discovered',
          description: 'At least one server must be successfully discovered',
          variant: 'destructive',
        });
        return;
      }

      // Import template with cache tokens
      const result = await mcpGroupsApi.importTemplate(template.slug, serverCacheTokens);
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpGroups.all() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });

      toast({
        title: 'Group imported',
        description: `Imported ${result.group.name} with ${successCount} server(s)`,
      });

      // Clear discovery preview after successful import
      setGroupDiscoveryPreview((prev) => {
        const { [template.slug]: _, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Failed to import group',
        variant: 'destructive',
      });
    } finally {
      setImportingTemplates((prev) => {
        const next = new Set(prev);
        next.delete(template.slug);
        return next;
      });
    }
  };

  const handleImportServerTemplate = async (
    template: McpServerTemplateResponse,
    githubInstallationId?: number,
  ) => {
    const importKey = getTemplateStateKey(template.slug, githubInstallationId);
    if (importingTemplates.has(importKey)) return;

    if (template.slug === 'github' && !githubInstallationId) {
      toast({
        title: 'Select a GitHub installation',
        description: 'Choose a connected GitHub App installation before importing GitHub MCP.',
        variant: 'destructive',
      });
      return;
    }

    setImportingTemplates((prev) => new Set(prev).add(importKey));
    try {
      const result = await importServerTemplateMutation.mutateAsync({
        slug: template.slug,
        input:
          template.slug === 'github'
            ? {
                github: {
                  installationId: githubInstallationId!,
                  readOnly: serverTemplateReadOnly[importKey] ?? false,
                  toolsets: template.defaultToolsets,
                },
              }
            : {},
      });

      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.templates() });

      toast({
        title: result.action === 'created' ? 'Server imported' : 'Server updated',
        description:
          result.server.lastHealthStatus === 'healthy'
            ? `${result.server.name} was imported and tool discovery completed.`
            : result.server.lastHealthStatus === 'unhealthy'
              ? `${result.server.name} was imported, but discovery failed. Check the connection details.`
              : `${result.server.name} is now available in the MCP library.`,
      });
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Failed to import server template',
        variant: 'destructive',
      });
    } finally {
      setImportingTemplates((prev) => {
        const next = new Set(prev);
        next.delete(importKey);
        return next;
      });
    }
  };

  const handleRemoveGroup = async (groupId: string, groupName: string) => {
    const confirmed = window.confirm(`Remove ${groupName}? This will delete the group.`);
    if (!confirmed) return;

    try {
      await mcpGroupsApi.deleteGroup(groupId);
      toast({
        title: 'Group removed',
        description: `${groupName} was removed.`,
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpGroups.all() });
    } catch (err) {
      toast({
        title: 'Remove failed',
        description: err instanceof Error ? err.message : 'Failed to remove group',
        variant: 'destructive',
      });
    }
  };

  const handleToggleTool = async (serverId: string, toolId: string) => {
    try {
      const tool = await toggleToolMutation.mutateAsync({ serverId, toolId });
      toast({
        title: tool.enabled ? 'Tool enabled' : 'Tool disabled',
        description: `${tool.toolName} has been ${tool.enabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to toggle tool',
        variant: 'destructive',
      });
    }
  };

  // Parse Claude Code style JSON config
  const parseClaudeCodeConfig = (
    jsonString: string,
  ): {
    servers: { name: string; config: ServerFormData }[];
    error?: string;
  } => {
    try {
      const parsed = JSON.parse(jsonString);

      // Validate structure - support both { mcpServers: {...} } and direct server config
      let mcpServers: Record<string, unknown>;

      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        mcpServers = parsed.mcpServers;
      } else if (parsed.url || parsed.command) {
        // Direct single server config without name
        mcpServers = { 'Imported Server': parsed };
      } else {
        return {
          servers: [],
          error: 'Invalid config: expected mcpServers object or server config with url/command',
        };
      }

      const servers: { name: string; config: ServerFormData }[] = [];

      for (const [name, config] of Object.entries(mcpServers)) {
        const serverConfig = config as {
          url?: string;
          headers?: Record<string, string>;
          command?: string;
          args?: string[];
        };

        // Determine transport type based on config
        let transportType: TransportType = 'http';
        if (serverConfig.command) {
          transportType = 'stdio';
        }

        servers.push({
          name,
          config: {
            name,
            description: '',
            transportType,
            endpoint: serverConfig.url ?? '',
            command: serverConfig.command ?? '',
            args: serverConfig.args?.join('\n') ?? '',
            headers: serverConfig.headers ? JSON.stringify(serverConfig.headers, null, 2) : '',
            healthCheckUrl: '', // Will default to endpoint
            enabled: true,
          },
        });
      }

      return { servers };
    } catch (e) {
      return {
        servers: [],
        error: e instanceof Error ? `JSON parse error: ${e.message}` : 'Invalid JSON',
      };
    }
  };

  // Handle "Test & Discover" for JSON config - validates and discovers tools before importing
  const handleJsonTestAndDiscover = async () => {
    const { servers, error } = parseClaudeCodeConfig(jsonValue);

    if (error) {
      setJsonParseError(error);
      return;
    }

    if (servers.length === 0) {
      setJsonParseError('No servers found in config');
      return;
    }

    setIsTestingDiscovery(true);
    setJsonParseError(null);

    // Initialize preview with pending status
    const initialResults: {
      name: string;
      transportType: 'http' | 'stdio';
      toolCount: number;
      status: 'pending' | 'discovering' | 'completed' | 'failed';
      tools?: { name: string; description?: string }[];
      error?: string;
      cacheToken?: string;
    }[] = servers.map(({ config }) => ({
      name: config.name.trim(),
      transportType: config.transportType as 'http' | 'stdio',
      toolCount: 0,
      status: 'pending' as const,
      tools: undefined,
      error: undefined,
      cacheToken: undefined,
    }));
    setDiscoveryPreview(initialResults);

    try {
      // Discover tools sequentially with live updates
      const results = [...initialResults];

      for (let i = 0; i < servers.length; i++) {
        const { config } = servers[i];

        // Update status to discovering
        results[i] = { ...results[i], status: 'discovering', error: undefined };
        setDiscoveryPreview([...results]);

        try {
          const { workflowId, cacheToken } = await mcpDiscoveryApi.discover({
            transport: config.transportType,
            name: config.name.trim(),
            endpoint:
              config.transportType === 'http' ? config.endpoint.trim() || undefined : undefined,
            command:
              config.transportType === 'stdio' ? config.command.trim() || undefined : undefined,
            args:
              config.transportType === 'stdio' && config.args.trim()
                ? config.args
                    .split('\n')
                    .map((a) => a.trim())
                    .filter(Boolean)
                : undefined,
          });

          // Poll for completion (60 second timeout)
          const maxAttempts = 60;
          const pollInterval = 1000;

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const status = await mcpDiscoveryApi.getStatus(workflowId);

            if (status.status === 'completed') {
              results[i] = {
                ...results[i],
                toolCount: status.toolCount ?? 0,
                tools: status.tools?.map((t) => ({ name: t.name, description: t.description })),
                status: 'completed',
                error: undefined,
                cacheToken,
              };
              // Store cache token and full tool data for this server
              if (cacheToken) {
                const tools = status.tools ?? [];
                if (tools.length > 0) {
                  setDiscoveryCacheTokens((prev) =>
                    new Map(prev).set(config.name.trim(), {
                      cacheToken,
                      tools: tools.map((t) => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema,
                      })),
                    }),
                  );
                }
              }
              setDiscoveryPreview([...results]);
              break;
            }

            if (status.status === 'failed') {
              results[i] = {
                ...results[i],
                toolCount: 0,
                error: status.error ?? 'Discovery failed',
                status: 'failed',
              };
              setDiscoveryPreview([...results]);
              break;
            }

            await new Promise((resolve) => setTimeout(resolve, pollInterval));
          }
        } catch (err) {
          results[i] = {
            ...results[i],
            toolCount: 0,
            error: err instanceof Error ? err.message : 'Unknown error',
            status: 'failed',
          };
          setDiscoveryPreview([...results]);
        }
      }
    } finally {
      setIsTestingDiscovery(false);
    }
  };

  // Handle saving from JSON tab (parses JSON and saves)
  const handleJsonSave = async () => {
    const { servers, error } = parseClaudeCodeConfig(jsonValue);

    if (error) {
      setJsonParseError(error);
      return;
    }

    if (servers.length === 0) {
      setJsonParseError('No servers found in config');
      return;
    }

    // When editing, update the server with the parsed config
    if (editingServer) {
      const firstServer = servers[0].config;
      setIsSaving(true);
      try {
        const payload: CreateMcpServer = {
          name: formData.name.trim(), // Keep original name
          description: firstServer.description.trim() || undefined,
          transportType: firstServer.transportType,
          endpoint:
            firstServer.transportType === 'http'
              ? firstServer.endpoint.trim() || undefined
              : undefined,
          command:
            firstServer.transportType === 'stdio'
              ? firstServer.command.trim() || undefined
              : undefined,
          args:
            firstServer.transportType === 'stdio' && firstServer.args.trim()
              ? firstServer.args
                  .split('\n')
                  .map((a) => a.trim())
                  .filter(Boolean)
              : undefined,
          headers: firstServer.headers.trim() ? JSON.parse(firstServer.headers) : undefined,
          enabled: formData.enabled,
        };
        await updateServerMutation.mutateAsync({ id: editingServer, input: payload });
        toast({ title: 'Server updated', description: `${payload.name} has been updated.` });
        setEditorOpen(false);
        setEditingServer(null);
        setFormData(INITIAL_FORM_DATA);
        setDiscoveryStatus(null);
      } catch (err) {
        toast({
          title: 'Error',
          description: err instanceof Error ? err.message : 'Failed to save server',
          variant: 'destructive',
        });
      } finally {
        setIsSaving(false);
      }
      return;
    }

    // When adding new, batch create all servers
    setIsImporting(true);
    setJsonParseError(null);

    try {
      const results = await Promise.allSettled(
        servers.map(({ config }) => {
          const cached = discoveryCacheTokens.get(config.name.trim());
          const payload: CreateMcpServer = {
            name: config.name.trim(),
            description: config.description.trim() || undefined,
            transportType: config.transportType,
            endpoint:
              config.transportType === 'http' ? config.endpoint.trim() || undefined : undefined,
            command:
              config.transportType === 'stdio' ? config.command.trim() || undefined : undefined,
            args:
              config.transportType === 'stdio' && config.args.trim()
                ? config.args
                    .split('\n')
                    .map((a) => a.trim())
                    .filter(Boolean)
                : undefined,
            headers: config.headers.trim() ? JSON.parse(config.headers) : undefined,
            enabled: true,
            // Pass cacheToken to backend so it can automatically create tools from cached discovery
            cacheToken: cached?.cacheToken,
          };
          return createServerMutation.mutateAsync(payload);
        }),
      );

      // Extract successfully created servers and collect errors
      type ServerResponse = Awaited<ReturnType<typeof createServerMutation.mutateAsync>>;
      const createdServers = results
        .filter((r): r is PromiseFulfilledResult<ServerResponse> => r.status === 'fulfilled')
        .map((r) => r.value);

      // Extract error details from failed promises
      const failedResults = results.filter((r) => r.status === 'rejected');
      const errors = failedResults.map((r, idx) => {
        const error = r.status === 'rejected' ? r.reason : null;
        const serverName = servers[idx]?.config?.name || `Server ${idx + 1}`;
        return {
          server: serverName,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      });

      const succeeded = createdServers.length;
      const failed = failedResults.length;

      // Mark all created servers as checking to prevent "Unknown" flash
      if (createdServers.length > 0) {
        setCheckingServers(new Set(createdServers.map((s) => s.id)));

        // For servers with cached discovery results, skip post-save discovery
        const serversToDiscover: typeof createdServers = [];
        for (const server of createdServers) {
          const cached = discoveryCacheTokens.get(server.name);
          if (cached) {
            // Server has cached discovery results - skip discovery, tools will be added via backend
            console.log(
              `[MCP Import] Using cached discovery results for ${server.name}: ${cached.tools.length} tools`,
            );
          } else {
            serversToDiscover.push(server);
          }
        }

        // Only discover tools for servers without cached results
        if (serversToDiscover.length > 0) {
          setDiscoveringServerIds(new Set(serversToDiscover.map((s) => s.id)));

          Promise.allSettled(
            serversToDiscover.map((server) =>
              discoverToolsMutation
                .mutateAsync({ serverId: server.id, servers: createdServers })
                .catch(() => {}),
            ),
          )
            .then(async () => {
              // Invalidate queries to refresh tool counts and health status
              await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
              await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
            })
            .finally(() => {
              // Clear discovering state
              setDiscoveringServerIds((prev) => {
                const next = new Set(prev);
                serversToDiscover.forEach((s) => next.delete(s.id));
                return next;
              });
            });
        }

        // For cached servers, just fetch their tools and refresh
        if (serversToDiscover.length < createdServers.length) {
          Promise.resolve()
            .then(async () => {
              // Invalidate queries to refresh tool counts and health status
              await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });
              await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
            })
            .finally(() => {
              // Clear checking state
              setCheckingServers((prev) => {
                const next = new Set(prev);
                createdServers.forEach((s) => next.delete(s.id));
                return next;
              });
            });
        }
      }

      if (failed > 0) {
        // Build detailed error message
        const errorDetails = errors.map((e) => `${e.server}: ${e.error}`).join('\n');
        const title =
          succeeded > 0
            ? `Partial import: ${succeeded} succeeded, ${failed} failed`
            : `Import failed: ${failed} server${failed === 1 ? '' : 's'} could not be created`;
        toast({
          title,
          description: errorDetails || 'Some servers could not be created',
          variant: succeeded > 0 ? 'default' : 'destructive',
        });
      } else {
        toast({
          title: 'Import successful',
          description: `Created ${succeeded} MCP server(s)`,
        });
      }

      setEditorOpen(false);
      setJsonValue('');
      setDiscoveryStatus(null);
    } catch (err) {
      toast({
        title: 'Import failed',
        description: err instanceof Error ? err.message : 'Failed to import servers',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  };

  const serverTools = useMemo(() => {
    if (!selectedServerForTools) return [];
    return tools.filter((t) => t.serverId === selectedServerForTools);
  }, [tools, selectedServerForTools]);

  const selectedServerRecord = useMemo(() => {
    if (!selectedServerForTools) return null;
    return servers.find((server) => server.id === selectedServerForTools) ?? null;
  }, [servers, selectedServerForTools]);

  const githubReadOnlyDisabledTools = useMemo(() => {
    const githubTemplate = serverTemplates.find((template) => template.slug === 'github');
    return githubTemplate?.readOnlyDisabledTools ?? [];
  }, [serverTemplates]);

  const getEffectiveGitHubReadOnly = useCallback(
    (server: {
      templateSlug?: string | null;
      githubInstallationId?: number | null;
      templateConfig?: Record<string, unknown> | null;
    }) => {
      if (server.templateSlug !== 'github' || !server.githubInstallationId) return false;
      const stateKey = getTemplateStateKey('github', server.githubInstallationId);
      if (stateKey in serverTemplateReadOnly) {
        return serverTemplateReadOnly[stateKey];
      }
      return server.templateConfig?.readOnly === true;
    },
    [getTemplateStateKey, serverTemplateReadOnly],
  );

  const selectedServerReadOnly = selectedServerRecord
    ? getEffectiveGitHubReadOnly(selectedServerRecord)
    : false;

  const selectedServerDialogTools = useMemo(() => {
    if (!selectedServerReadOnly || selectedServerRecord?.templateSlug !== 'github') {
      return serverTools.map((tool) => ({ ...tool, disabledByReadOnly: false }));
    }

    const disabledToolNames = new Set(githubReadOnlyDisabledTools);
    const syntheticDisabledTools = githubReadOnlyDisabledTools
      .filter((toolName) => !serverTools.some((tool) => tool.toolName === toolName))
      .map((toolName) => ({
        id: `readonly-disabled-${toolName}`,
        toolName,
        description: 'Disabled because GitHub MCP is in read-only mode.',
        inputSchema: null,
        serverId: selectedServerRecord.id,
        serverName: selectedServerRecord.name,
        enabled: false,
        discoveredAt: selectedServerRecord.updatedAt,
        disabledByReadOnly: true,
      }));

    return [
      ...serverTools.map((tool) => ({
        ...tool,
        enabled: disabledToolNames.has(tool.toolName) ? false : tool.enabled,
        disabledByReadOnly: disabledToolNames.has(tool.toolName),
      })),
      ...syntheticDisabledTools,
    ];
  }, [githubReadOnlyDisabledTools, selectedServerReadOnly, selectedServerRecord, serverTools]);

  const handleToggleGitHubReadOnly = async (
    template: McpServerTemplateResponse,
    installationId: number,
    checked: boolean,
  ) => {
    const stateKey = getTemplateStateKey(template.slug, installationId);
    const previousValue = serverTemplateReadOnly[stateKey];

    setServerTemplateReadOnly((prev) => ({
      ...prev,
      [stateKey]: checked,
    }));
    setImportingTemplates((prev) => new Set(prev).add(stateKey));

    try {
      const result = await importServerTemplateMutation.mutateAsync({
        slug: template.slug,
        input: {
          github: {
            installationId,
            readOnly: checked,
            toolsets: template.defaultToolsets,
          },
        },
      });

      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.templates() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.tools() });

      toast({
        title: checked ? 'Write tools disabled' : 'Write tools re-enabled',
        description:
          result.server.lastHealthStatus === 'healthy'
            ? `${result.server.name} was refreshed and tool availability updated.`
            : `${result.server.name} was updated. Rediscover if tool availability looks stale.`,
      });
    } catch (err) {
      setServerTemplateReadOnly((prev) => {
        const { [stateKey]: _, ...rest } = prev;
        if (previousValue === undefined) {
          return rest;
        }
        return { ...rest, [stateKey]: previousValue };
      });
      toast({
        title: 'Read-only update failed',
        description: err instanceof Error ? err.message : 'Failed to update GitHub MCP mode',
        variant: 'destructive',
      });
    } finally {
      setImportingTemplates((prev) => {
        const next = new Set(prev);
        next.delete(stateKey);
        return next;
      });
    }
  };

  const selectedServer = useMemo<{ name?: string; transportType?: TransportType } | null>(() => {
    if (!selectedServerForTools) return null;
    const direct = servers.find((s) => s.id === selectedServerForTools);
    if (direct) return direct;
    for (const group of groups) {
      const match = getGroupServers(group.id).find((s) => s.serverId === selectedServerForTools);
      if (match) {
        return {
          name: match.serverName,
          transportType: match.transportType,
        };
      }
    }
    return null;
  }, [servers, selectedServerForTools, groups, getGroupServers]);

  if (error) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">Failed to load MCP servers</h2>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button
            onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() })}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">MCP Servers</h1>
          <p className="text-muted-foreground">
            Configure Model Context Protocol servers for AI agents
          </p>
        </div>
        <Button onClick={handleCreateNew}>
          <Plus className="h-4 w-4 mr-2" />
          Add Server
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search servers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers.all() });
            queryClient.invalidateQueries({ queryKey: queryKeys.mcpGroups.all() });
            void refreshTemplates();
          }}
          disabled={isLoading}
        >
          <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {/* Curated Section */}
      <div className="mb-8">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Curated
        </p>
        <div className="rounded-lg border overflow-hidden">
          {isLoadingTemplates && groups.length === 0 && isLoadingServerTemplates ? (
            <div className="divide-y">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3">
                  <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-7 w-16 shrink-0" />
                </div>
              ))}
            </div>
          ) : filteredGroups.length === 0 &&
            filteredTemplates.filter((t) => !importedGroupSlugs.has(t.slug)).length === 0 &&
            filteredServerTemplates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Layers className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                {searchQuery
                  ? 'No curated servers match your search.'
                  : 'No curated servers available.'}
              </p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <CuratedOverviewHeader />
              <Accordion
                type="multiple"
                value={curatedAccordionValue}
                onValueChange={setCuratedAccordionValue}
              >
                {/* Imported groups */}
                {filteredGroups.map((group) => {
                  const theme = getGroupTheme(group.slug);
                  const groupServerList = getGroupServers(group.id);
                  const serverCount = groupServerList.length;
                  const totalTools = groupServerList.reduce((sum, server) => {
                    const counts = getGroupServerToolCounts(server);
                    return sum + (counts?.total ?? 0);
                  }, 0);

                  return (
                    <AccordionItem key={group.id} value={group.id} className="border-0">
                      <CuratedRow
                        logo={
                          <div className={cn('p-2 rounded-lg border', theme.iconWrapper)}>
                            <GroupLogo
                              slug={group.slug}
                              name={group.name}
                              className={cn('h-5 w-5', theme.iconText)}
                            />
                          </div>
                        }
                        name={group.name}
                        description={group.description}
                        status="Installed"
                        statusVariant="success"
                        scope={`${serverCount} ${serverCount === 1 ? 'server' : 'servers'}`}
                        toolsSummary={`${totalTools} tools`}
                        actions={
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => {
                                  void handleRemoveGroup(group.id, group.name);
                                }}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Remove group</TooltipContent>
                          </Tooltip>
                        }
                        accordionTrigger
                      />
                      <AccordionContent className="px-4 pb-4 pt-0 border-t">
                        {serverCount === 0 ? (
                          <div className="border rounded-lg">
                            <Table>
                              {renderServerTableHeader()}
                              <TableBody>
                                <TableRow>
                                  <TableCell colSpan={7} className="text-center py-8 text-sm">
                                    <span className="text-muted-foreground">
                                      No servers in this group
                                    </span>
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <div className="border rounded-lg">
                            <Table>
                              {renderServerTableHeader()}
                              <TableBody>
                                {groupServerList.map((server) => {
                                  const groupServerId = server.serverId || server.id;
                                  const toolCounts = getGroupServerToolCounts(server);
                                  const healthStatus = getGroupServerHealthStatus(server);

                                  return (
                                    <TableRow key={groupServerId}>
                                      <TableCell>
                                        <div>
                                          <div className="font-medium">{server.serverName}</div>
                                          {server.description && (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                                                  {server.description}
                                                </div>
                                              </TooltipTrigger>
                                              <TooltipContent side="bottom" className="max-w-xs">
                                                {server.description}
                                              </TooltipContent>
                                            </Tooltip>
                                          )}
                                        </div>
                                      </TableCell>
                                      <TableCell>
                                        <TransportBadge type={server.transportType} />
                                      </TableCell>
                                      <TableCell>
                                        {renderConnectionCell({
                                          endpoint: server.endpoint,
                                          command: server.command,
                                          args: server.args,
                                        })}
                                      </TableCell>
                                      <TableCell>
                                        <HealthIndicator
                                          status={healthStatus}
                                          checking={checkingServers.has(groupServerId)}
                                        />
                                      </TableCell>
                                      <TableCell className="text-center">
                                        {toolCounts && toolCounts.total > 0 ? (
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 px-2 font-mono text-xs"
                                                onClick={() => handleViewTools(groupServerId)}
                                              >
                                                {toolCounts.enabled}/{toolCounts.total}
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p>
                                                {toolCounts.enabled} enabled out of{' '}
                                                {toolCounts.total} tools
                                              </p>
                                            </TooltipContent>
                                          </Tooltip>
                                        ) : (
                                          <span className="text-muted-foreground text-xs">—</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="text-center">
                                        <Switch
                                          checked={server.enabled}
                                          onCheckedChange={() => handleToggle(groupServerId)}
                                        />
                                      </TableCell>
                                      <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleViewTools(groupServerId)}
                                              >
                                                <Wrench className="h-4 w-4" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>View tools</TooltipContent>
                                          </Tooltip>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() =>
                                                  handleDiscoverServerTools(
                                                    groupServerId,
                                                    group.defaultDockerImage ?? undefined,
                                                  )
                                                }
                                                disabled={discoveringServerIds.has(groupServerId)}
                                              >
                                                {discoveringServerIds.has(groupServerId) ? (
                                                  <Loader className="h-4 w-4 animate-spin" />
                                                ) : (
                                                  <RefreshCw className="h-4 w-4" />
                                                )}
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Rediscover tools</TooltipContent>
                                          </Tooltip>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}

                {/* Available group templates (not yet imported) */}
                {filteredTemplates
                  .filter((template) => !importedGroupSlugs.has(template.slug))
                  .map((template) => {
                    const theme = getGroupTheme(template.slug);

                    return (
                      <AccordionItem
                        key={template.slug}
                        value={`template-${template.slug}`}
                        className="border-0"
                      >
                        <CuratedRow
                          logo={
                            <div className={cn('p-2 rounded-lg border', theme.iconWrapper)}>
                              <GroupLogo
                                slug={template.slug}
                                name={template.name}
                                className={cn('h-5 w-5', theme.iconText)}
                              />
                            </div>
                          }
                          name={template.name}
                          description={template.description}
                          status="Ready to import"
                          statusVariant="warning"
                          scope={`${template.servers.length} ${template.servers.length === 1 ? 'server' : 'servers'}`}
                          actions={
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => {
                                    handleGroupTestAndDiscover(template);
                                    setCuratedAccordionValue((prev) =>
                                      prev.includes(`template-${template.slug}`)
                                        ? prev
                                        : [...prev, `template-${template.slug}`],
                                    );
                                  }}
                                  disabled={discoveringGroups.has(template.slug)}
                                >
                                  {discoveringGroups.has(template.slug) ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Search className="h-4 w-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Discover servers</TooltipContent>
                            </Tooltip>
                          }
                          accordionTrigger
                        />
                        <AccordionContent className="px-4 pb-4 pt-0 border-t">
                          <div className="space-y-3 pt-3">
                            {groupDiscoveryPreview[template.slug] && (
                              <McpDiscoveryPreview
                                results={groupDiscoveryPreview[template.slug]}
                                onClear={() => {
                                  setGroupDiscoveryPreview((prev) => {
                                    const { [template.slug]: _, ...rest } = prev;
                                    return rest;
                                  });
                                }}
                              />
                            )}

                            {groupDiscoveryPreview[template.slug] && (
                              <div className="flex items-center justify-between text-sm bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">
                                <span className="text-green-700 dark:text-green-300">
                                  {
                                    groupDiscoveryPreview[template.slug].filter(
                                      (r) => r.status === 'completed',
                                    ).length
                                  }{' '}
                                  of {template.servers.length} servers ready
                                </span>
                              </div>
                            )}

                            <div className="flex justify-end gap-2">
                              {groupDiscoveryPreview[template.slug] && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setGroupDiscoveryPreview((prev) => {
                                      const { [template.slug]: _, ...rest } = prev;
                                      return rest;
                                    });
                                  }}
                                >
                                  Clear
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleGroupTestAndDiscover(template)}
                                disabled={discoveringGroups.has(template.slug)}
                              >
                                {discoveringGroups.has(template.slug) ? (
                                  <>
                                    <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                    Discovering...
                                  </>
                                ) : (
                                  <>
                                    <Search className="h-3 w-3 mr-2" />
                                    Test & Discover
                                  </>
                                )}
                              </Button>
                              <Button
                                size="sm"
                                disabled={
                                  importingTemplates.has(template.slug) ||
                                  !groupDiscoveryPreview[template.slug] ||
                                  groupDiscoveryPreview[template.slug].some(
                                    (r) => r.status !== 'completed',
                                  )
                                }
                                onClick={() => handleImportDiscoveredTemplate(template)}
                              >
                                {importingTemplates.has(template.slug) ? (
                                  <>
                                    <RefreshCw className="h-3 w-3 mr-2 animate-spin" />
                                    Importing...
                                  </>
                                ) : (
                                  <>
                                    <ArrowDownToLine className="h-3 w-3 mr-2" />
                                    Import
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}

                {/* Server templates */}
                {filteredServerTemplates.map((template) => {
                  const isGitHubTemplate = template.slug === 'github';
                  const githubImportedServers = isGitHubTemplate
                    ? githubInstallations
                        .map((installation) =>
                          githubImportedServersByInstallationId.get(installation.installationId),
                        )
                        .filter((server): server is NonNullable<typeof server> => Boolean(server))
                    : [];
                  const genericImportedServer =
                    !isGitHubTemplate && template.importedServerId
                      ? servers.find((server) => server.id === template.importedServerId)
                      : null;
                  const isImported = isGitHubTemplate
                    ? githubImportedServers.length > 0
                    : Boolean(genericImportedServer);
                  const importedToolCounts = genericImportedServer
                    ? toolCountsByServer[genericImportedServer.id]
                    : undefined;
                  const readOnlyDisabledTools = template.readOnlyDisabledTools ?? [];
                  const importedAvailableCount = importedToolCounts?.enabled ?? 0;
                  const importedTotalCount = importedToolCounts?.total ?? 0;
                  const githubSummary = githubImportedServers.reduce(
                    (sum, server) => {
                      const counts = toolCountsByServer[server.id] ?? { enabled: 0, total: 0 };
                      return {
                        active: sum.active + counts.enabled,
                        total: sum.total + counts.total,
                      };
                    },
                    { active: 0, total: 0 },
                  );

                  // Determine status
                  const statusInfo = isGitHubTemplate
                    ? isImported
                      ? { label: 'Installed', variant: 'success' as const }
                      : githubInstallations.length > 0
                        ? { label: 'Ready to import', variant: 'warning' as const }
                        : { label: 'Setup required', variant: 'muted' as const }
                    : isImported
                      ? { label: 'Installed', variant: 'success' as const }
                      : { label: 'Ready to import', variant: 'warning' as const };

                  return (
                    <AccordionItem
                      key={template.slug}
                      value={`server-template-${template.slug}`}
                      className="border-0"
                    >
                      <CuratedRow
                        logo={
                          <div className="p-2 rounded-lg border bg-muted">
                            <GroupLogo
                              slug={template.slug}
                              name={template.name}
                              className="h-5 w-5 text-muted-foreground"
                            />
                          </div>
                        }
                        name={template.name}
                        description={template.description}
                        status={statusInfo.label}
                        statusVariant={statusInfo.variant}
                        scope={
                          isGitHubTemplate
                            ? `${isImported ? githubImportedServers.length : githubInstallations.length} install${(isImported ? githubImportedServers.length : githubInstallations.length) === 1 ? '' : 's'}`
                            : isImported
                              ? template.runtimeType.toUpperCase()
                              : template.runtimeType.toUpperCase()
                        }
                        toolsSummary={
                          isGitHubTemplate
                            ? isImported
                              ? `${githubSummary.active}/${githubSummary.total} tools`
                              : undefined
                            : isImported
                              ? `${importedAvailableCount}/${importedTotalCount} tools`
                              : undefined
                        }
                        actions={
                          <>
                            {/* Installed server actions (generic) */}
                            {genericImportedServer && (
                              <>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => handleViewTools(genericImportedServer.id)}
                                    >
                                      <Wrench className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>View tools</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() =>
                                        handleDiscoverServerTools(genericImportedServer.id)
                                      }
                                      disabled={discoveringServerIds.has(genericImportedServer.id)}
                                    >
                                      {discoveringServerIds.has(genericImportedServer.id) ? (
                                        <Loader className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <RefreshCw className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Rediscover tools</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => {
                                        setServerToDelete(genericImportedServer.id);
                                        setDeleteDialogOpen(true);
                                      }}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Remove server</TooltipContent>
                                </Tooltip>
                              </>
                            )}
                            {/* GitHub installed: show manage label */}
                            {isGitHubTemplate && isImported && (
                              <span className="text-xs text-muted-foreground mr-1">Manage →</span>
                            )}
                            {/* GitHub not imported: show setup / import hint */}
                            {isGitHubTemplate &&
                              !isImported &&
                              githubInstallations.length === 0 && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                                      <a href="/integrations/github">
                                        <Plug className="h-4 w-4" />
                                      </a>
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Connect GitHub App</TooltipContent>
                                </Tooltip>
                              )}
                            {isGitHubTemplate && !isImported && githubInstallations.length > 0 && (
                              <span className="text-xs text-muted-foreground mr-1">Import →</span>
                            )}
                          </>
                        }
                        accordionTrigger
                      />
                      <AccordionContent className="px-4 pb-4 pt-0 border-t">
                        <div className="space-y-3 pt-3">
                          {isGitHubTemplate ? (
                            /* GitHub: per-installation rows */
                            githubInstallations.length === 0 ? (
                              <div className="flex items-center justify-between rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
                                <span>No GitHub App installation found.</span>
                                <a
                                  href="/integrations/github"
                                  className="text-primary hover:underline font-medium text-xs"
                                >
                                  Connect GitHub App →
                                </a>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {githubInstallations.map((installation) => {
                                  const stateKey = getTemplateStateKey(
                                    template.slug,
                                    installation.installationId,
                                  );
                                  const installationServer =
                                    githubImportedServersByInstallationId.get(
                                      installation.installationId,
                                    ) ?? null;
                                  const installationReadOnly = installationServer
                                    ? getEffectiveGitHubReadOnly(installationServer)
                                    : (serverTemplateReadOnly[stateKey] ?? false);
                                  const installationServerTools = installationServer
                                    ? tools.filter(
                                        (tool) => tool.serverId === installationServer.id,
                                      )
                                    : [];
                                  const disabledToolNames = new Set(readOnlyDisabledTools);
                                  const installationTotalCount = installationServerTools.length;
                                  const installationAvailableCount = installationReadOnly
                                    ? installationServerTools.filter(
                                        (tool) => !disabledToolNames.has(tool.toolName),
                                      ).length
                                    : installationServerTools.filter((tool) => tool.enabled).length;
                                  const installationImporting = importingTemplates.has(stateKey);

                                  return (
                                    <div
                                      key={installation.id}
                                      className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                                    >
                                      {/* Info */}
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm font-medium truncate">
                                            {installation.accountLogin}
                                          </span>
                                          {installationServer ? (
                                            <StatusBadge status="Imported" variant="success" />
                                          ) : (
                                            <StatusBadge status="Not imported" variant="muted" />
                                          )}
                                          {installationReadOnly && (
                                            <Badge variant="outline" className="text-[10px]">
                                              read-only
                                            </Badge>
                                          )}
                                        </div>
                                        {installationServer && (
                                          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                                            <HealthIndicator
                                              status={installationServer.lastHealthStatus ?? null}
                                              checking={checkingServers.has(installationServer.id)}
                                            />
                                            <span>·</span>
                                            <span>
                                              {installationAvailableCount}/{installationTotalCount}{' '}
                                              tools
                                            </span>
                                          </div>
                                        )}
                                      </div>

                                      {/* Read-only toggle */}
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-xs text-muted-foreground">
                                          Read-only
                                        </span>
                                        <Switch
                                          checked={installationReadOnly}
                                          disabled={installationImporting}
                                          onCheckedChange={(checked) =>
                                            handleToggleGitHubReadOnly(
                                              template,
                                              installation.installationId,
                                              checked,
                                            )
                                          }
                                        />
                                      </div>

                                      {/* Action buttons */}
                                      <div className="flex items-center gap-1 shrink-0">
                                        {installationServer ? (
                                          <>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-8 w-8"
                                                  onClick={() =>
                                                    handleViewTools(installationServer.id)
                                                  }
                                                >
                                                  <Wrench className="h-4 w-4" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>View tools</TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-8 w-8"
                                                  onClick={() =>
                                                    handleDiscoverServerTools(installationServer.id)
                                                  }
                                                  disabled={discoveringServerIds.has(
                                                    installationServer.id,
                                                  )}
                                                >
                                                  {discoveringServerIds.has(
                                                    installationServer.id,
                                                  ) ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                  ) : (
                                                    <RefreshCw className="h-4 w-4" />
                                                  )}
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Rediscover tools</TooltipContent>
                                            </Tooltip>
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-8 w-8"
                                                  onClick={() => {
                                                    setServerToDelete(installationServer.id);
                                                    setDeleteDialogOpen(true);
                                                  }}
                                                >
                                                  <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                              </TooltipTrigger>
                                              <TooltipContent>Remove</TooltipContent>
                                            </Tooltip>
                                          </>
                                        ) : (
                                          <Button
                                            size="sm"
                                            onClick={() =>
                                              handleImportServerTemplate(
                                                template,
                                                installation.installationId,
                                              )
                                            }
                                            disabled={installationImporting}
                                          >
                                            {installationImporting ? (
                                              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                                            ) : (
                                              <ArrowDownToLine className="h-3 w-3 mr-1.5" />
                                            )}
                                            Import
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )
                          ) : (
                            /* Non-GitHub: simple detail + actions */
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs text-muted-foreground">
                                {isImported
                                  ? 'Imported server is available in workflow MCP tool-source pickers.'
                                  : 'Import to make this server available in workflows.'}
                              </p>
                              {!isImported && (
                                <Button
                                  size="sm"
                                  onClick={() => handleImportServerTemplate(template)}
                                  disabled={importingTemplates.has(
                                    getTemplateStateKey(template.slug),
                                  )}
                                >
                                  {importingTemplates.has(getTemplateStateKey(template.slug)) ? (
                                    <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                                  ) : (
                                    <ArrowDownToLine className="h-3 w-3 mr-1.5" />
                                  )}
                                  Import
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          )}
        </div>
      </div>

      {/* Custom Section */}
      <div className="mb-8">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Custom
        </p>
        <div className="border rounded-lg overflow-hidden">
          <Table>
            {renderServerTableHeader()}
            <TableBody>
              {isLoading && servers.length === 0 ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-10 mx-auto" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-10 mx-auto" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-8 w-24 ml-auto" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredCustomServers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <Plug className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">
                      {searchQuery
                        ? 'No servers match your search'
                        : 'No standalone servers configured'}
                    </p>
                    {!searchQuery && (
                      <Button variant="outline" className="mt-4" onClick={handleCreateNew}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add your first server
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                filteredCustomServers.map((server) => (
                  <TableRow key={server.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{server.name}</div>
                        {server.description && (
                          <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                            {server.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TransportBadge type={server.transportType} />
                    </TableCell>
                    <TableCell>
                      {renderConnectionCell({
                        endpoint: server.endpoint,
                        command: server.command,
                        args: server.args,
                      })}
                    </TableCell>
                    <TableCell>
                      <HealthIndicator
                        status={server.lastHealthStatus ?? null}
                        checking={checkingServers.has(server.id)}
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      {toolCountsByServer[server.id]?.total > 0 ? (
                        <Tooltip>
                          <TooltipTrigger>
                            <Badge variant="outline" className="font-mono text-xs">
                              {toolCountsByServer[server.id].enabled}/
                              {toolCountsByServer[server.id].total}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>
                              {toolCountsByServer[server.id].enabled} enabled out of{' '}
                              {toolCountsByServer[server.id].total} tools
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={server.enabled}
                        onCheckedChange={() => handleToggle(server.id)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleViewTools(server.id)}
                            >
                              <Wrench className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View tools</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleTestConnection(server.id)}
                              disabled={testingServer === server.id}
                            >
                              <Plug
                                className={cn(
                                  'h-4 w-4',
                                  testingServer === server.id && 'animate-pulse',
                                )}
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Test connection</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(server.id)}
                            >
                              <Edit3 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setServerToDelete(server.id);
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Delete</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {!searchQuery && filteredCustomServers.length > 0 && (
            <div className="border-t px-4 py-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCreateNew}
                className="w-full justify-center text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add custom server
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Server Editor Sheet */}
      <Sheet open={editorOpen} onOpenChange={handleEditorClose}>
        <SheetContent className="sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editingServer ? 'Edit MCP Server' : 'Add MCP Server'}</SheetTitle>
            <SheetDescription>
              Configure an MCP server that AI agents can use to access tools.
            </SheetDescription>
          </SheetHeader>

          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'manual' | 'json')}
            className="mt-4"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">Manual</TabsTrigger>
              <TabsTrigger value="json">
                <FileJson className="h-4 w-4 mr-2" />
                JSON
              </TabsTrigger>
            </TabsList>

            <TabsContent value="manual" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My MCP Server"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description..."
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="transportType">Transport Type *</Label>
                <Select
                  value={formData.transportType}
                  onValueChange={(value) =>
                    setFormData({ ...formData, transportType: value as TransportType })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSPORT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {formData.transportType === 'http' && (
                <div className="space-y-2">
                  <Label htmlFor="endpoint">Endpoint URL *</Label>
                  <Input
                    id="endpoint"
                    value={formData.endpoint}
                    onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
                    placeholder="https://mcp.example.com/mcp"
                  />
                </div>
              )}

              {formData.transportType === 'stdio' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="command">Command *</Label>
                    <Input
                      id="command"
                      value={formData.command}
                      onChange={(e) => setFormData({ ...formData, command: e.target.value })}
                      placeholder="npx"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="args">Arguments (one per line)</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setSecretPickerEntryIndex(-1)}
                      >
                        <KeyRound className="h-3 w-3 mr-1" />
                        Insert Secret
                      </Button>
                    </div>
                    <Textarea
                      ref={(el) => {
                        if (el && secretPickerEntryIndex === -1) {
                          // Store textarea ref for cursor positioning
                          (el as any)._argsTextarea = el;
                        }
                      }}
                      id="args"
                      value={formData.args}
                      onChange={(e) => setFormData({ ...formData, args: e.target.value })}
                      placeholder="-y&#10;@modelcontextprotocol/server-everything&#10;{{secret:SECRET_ID}}"
                      rows={3}
                    />
                    {secretPickerEntryIndex === -1 && (
                      <div className="mt-1">
                        <SecretSelect
                          value={undefined}
                          onChange={(secretId) => {
                            if (secretId) {
                              const textarea = document.getElementById(
                                'args',
                              ) as HTMLTextAreaElement;
                              if (textarea) {
                                const cursorPos = textarea.selectionStart;
                                const textBefore = formData.args.substring(0, cursorPos);
                                const textAfter = formData.args.substring(cursorPos);
                                const secretRef = `{{secret:${secretId}}}`;
                                setFormData({
                                  ...formData,
                                  args: textBefore + secretRef + textAfter,
                                });
                                // Move cursor after the inserted secret reference
                                setTimeout(() => {
                                  textarea.selectionStart = textarea.selectionEnd =
                                    cursorPos + secretRef.length;
                                  textarea.focus();
                                }, 0);
                              }
                            }
                            setSecretPickerEntryIndex(null);
                          }}
                          placeholder="Select a secret to insert..."
                          clearable={false}
                        />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Use &quot;Insert Secret&quot; to add secret references. Each line becomes a
                      separate argument.
                    </p>
                  </div>
                </>
              )}

              <div className="space-y-3">
                <Label>Headers</Label>
                {headerEntries.length > 0 ? (
                  <div className="space-y-2">
                    {headerEntries.map((entry, index) => (
                      <div key={index} className="flex gap-2 items-center">
                        <Input
                          value={entry.key}
                          onChange={(e) => updateHeaderEntry(index, 'key', e.target.value)}
                          placeholder="Header name"
                          className="flex-1 font-mono text-sm"
                        />
                        <div className="relative flex-1">
                          <Input
                            type={entry.secretId ? 'text' : 'password'}
                            value={entry.secretId ? `🔐 Secret` : entry.value}
                            onChange={(e) => updateHeaderEntry(index, 'value', e.target.value)}
                            placeholder="Value"
                            className={cn(
                              'font-mono text-sm pr-20',
                              entry.secretId && 'text-green-600 dark:text-green-400',
                            )}
                          />
                          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setSecretPickerEntryIndex(index)}
                              title="Pick a secret"
                            >
                              <KeyRound className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                          {secretPickerEntryIndex === index && (
                            <div className="absolute top-full right-0 mt-1 z-50 w-64 bg-popover border rounded-md shadow-lg p-2">
                              <SecretSelect
                                value={entry.secretId}
                                onChange={(secretId) => {
                                  updateHeaderEntry(index, 'secretId', secretId ?? '');
                                  setSecretPickerEntryIndex(null);
                                }}
                                placeholder="Select a secret..."
                                clearable={true}
                              />
                            </div>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeHeaderEntry(index)}
                          className="h-9 w-9 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground py-2">
                    No headers configured. Add headers for authentication.
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addHeaderEntry}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Header
                </Button>
                <p className="text-xs text-muted-foreground">
                  Pick a secret to reference stored values, or enter values directly. Headers are
                  securely encrypted when stored.
                </p>
              </div>

              {/* Discovery Status Alerts */}
              {discoveryStatus?.status === 'completed' && (
                <div className="flex items-center justify-between p-3 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <span className="text-sm text-green-700 dark:text-green-300">
                      Found {discoveryStatus.toolCount} tool
                      {discoveryStatus.toolCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaving || !formData.name.trim()}
                  >
                    {isSaving ? 'Saving...' : 'Save MCP Server'}
                  </Button>
                </div>
              )}

              {discoveryStatus?.status === 'failed' && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm text-destructive">
                    Discovery failed: {discoveryStatus.error || 'Unknown error'}
                  </span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setEditorOpen(false)}
                  disabled={discoveryStatus?.status === 'running'}
                >
                  Cancel
                </Button>
                {discoveryStatus?.status !== 'completed' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={handleTestAndDiscover}
                      disabled={
                        discoveryStatus?.status === 'running' ||
                        !formData.name.trim() ||
                        (!formData.endpoint.trim() && !formData.command.trim())
                      }
                    >
                      {discoveryStatus?.status === 'running' ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Discovering...
                        </>
                      ) : (
                        'Test & Discover'
                      )}
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={
                        isSaving ||
                        !formData.name.trim() ||
                        (!formData.endpoint.trim() && !formData.command.trim())
                      }
                    >
                      {isSaving ? 'Saving...' : editingServer ? 'Update' : 'Create'}
                    </Button>
                  </>
                )}
              </div>
            </TabsContent>

            <TabsContent value="json" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>{editingServer ? 'Server Configuration (JSON)' : 'Paste JSON Config'}</Label>
                <Textarea
                  value={jsonValue}
                  onChange={(e) => {
                    setJsonValue(e.target.value);
                    setJsonParseError(null);
                  }}
                  placeholder={`{
  "mcpServers": {
    "server-name": {
      "url": "https://mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer xxx"
      }
    }
  }
}`}
                  rows={14}
                  className="font-mono text-sm"
                />
                {jsonParseError && (
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{jsonParseError}</span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {editingServer
                    ? 'Edit the JSON configuration and save.'
                    : 'Paste Claude Code config format. Multiple servers will be created.'}
                </p>
              </div>

              {/* Discovery Preview */}
              {discoveryPreview && (
                <McpDiscoveryPreview
                  results={discoveryPreview}
                  onClear={() => setDiscoveryPreview(null)}
                />
              )}

              <div className="flex flex-col gap-3 pt-4">
                {/* Discovery info message */}
                {!editingServer && !discoveryPreview && jsonValue.trim() && (
                  <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                    <HelpCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>
                      Run &quot;Test &amp; Discover&quot; first to validate servers and discover
                      available tools before importing.
                    </span>
                  </div>
                )}

                {/* Discovery summary when available */}
                {!editingServer && discoveryPreview && (
                  <div className="flex items-center justify-between text-sm bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-md px-3 py-2">
                    <span className="text-green-700 dark:text-green-300">
                      {discoveryPreview.filter((r) => r.status === 'completed').length} of{' '}
                      {discoveryPreview.length} servers ready
                      {discoveryPreview.some((r) => r.status === 'completed') && (
                        <span className="text-green-600 dark:text-green-400 ml-2">
                          (
                          {discoveryPreview
                            .filter((r) => r.status === 'completed')
                            .reduce((sum, r) => sum + (r.toolCount ?? 0), 0)}{' '}
                          tools discovered)
                        </span>
                      )}
                    </span>
                    {discoveryPreview.some((r) => r.status === 'failed') && (
                      <span className="text-destructive">
                        {discoveryPreview.filter((r) => r.status === 'failed').length} failed
                      </span>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditorOpen(false)}>
                    Cancel
                  </Button>
                  {!editingServer && (
                    <Button
                      variant="outline"
                      onClick={handleJsonTestAndDiscover}
                      disabled={isTestingDiscovery || !jsonValue.trim()}
                    >
                      {isTestingDiscovery ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4 mr-2" />
                          Test & Discover
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={handleJsonSave}
                    disabled={
                      (editingServer ? isSaving : isImporting) ||
                      !jsonValue.trim() ||
                      // Require discovery for new servers (unless editing)
                      (!editingServer && !discoveryPreview) ||
                      // Disable while any discovery is still running
                      (!editingServer &&
                        discoveryPreview?.some(
                          (r) => r.status === 'discovering' || r.status === 'pending',
                        ))
                    }
                  >
                    {editingServer
                      ? isSaving
                        ? 'Saving...'
                        : 'Update'
                      : isImporting
                        ? 'Importing...'
                        : discoveryPreview && discoveryPreview.some((r) => r.status === 'completed')
                          ? `Import ${discoveryPreview.filter((r) => r.status === 'completed').length} Server${discoveryPreview.filter((r) => r.status === 'completed').length === 1 ? '' : 's'}`
                          : 'Import'}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete MCP Server</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this server? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tools Dialog */}
      <Dialog open={toolsDialogOpen} onOpenChange={setToolsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Tools from {selectedServer?.name ?? 'Server'}</DialogTitle>
            <DialogDescription>
              {selectedServerDialogTools.length > 0 ? (
                <span className="flex items-center gap-2 mt-1">
                  Enabled: {selectedServerDialogTools.filter((t) => t.enabled).length} /{' '}
                  {selectedServerDialogTools.length}
                  {selectedServerReadOnly && githubReadOnlyDisabledTools.length > 0 && (
                    <span className="text-muted-foreground">
                      • {githubReadOnlyDisabledTools.length} disabled by read-only
                    </span>
                  )}
                </span>
              ) : (
                'These are the tools discovered from this MCP server.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto">
            {selectedServerReadOnly && githubReadOnlyDisabledTools.length > 0 && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/20">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                  Read-only mode is enabled
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Write-capable GitHub tools stay disabled here until read-only mode is turned off.
                </p>
              </div>
            )}
            {selectedServerDialogTools.length === 0 ? (
              <div className="text-center py-8">
                <Wrench className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm font-medium mb-1">No tools discovered yet</p>
                <p className="text-xs text-muted-foreground mb-4">
                  Discover tools from this server to enable them in your workflows
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    selectedServerForTools &&
                    handleDiscoverServerTools(
                      selectedServerForTools,
                      getServerDiscoveryImage(selectedServerForTools),
                    )
                  }
                  disabled={
                    !selectedServerForTools || discoveringServerIds.has(selectedServerForTools)
                  }
                >
                  {selectedServerForTools && discoveringServerIds.has(selectedServerForTools) ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Discovering...
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-2" />
                      Discover Tools
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedServerDialogTools.map((tool) => (
                  <div
                    key={tool.id}
                    className={cn(
                      'border rounded-lg p-3 transition-opacity',
                      !tool.enabled && 'opacity-60',
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{tool.toolName}</div>
                        {tool.description && (
                          <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            <MarkdownView
                              content={tool.description}
                              className="prose prose-sm max-w-none"
                            />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {tool.disabledByReadOnly ? 'Disabled by read-only' : 'Enabled'}
                        </span>
                        <Switch
                          checked={tool.enabled}
                          disabled={tool.disabledByReadOnly}
                          onCheckedChange={() =>
                            !tool.disabledByReadOnly && handleToggleTool(tool.serverId, tool.id)
                          }
                        />
                      </div>
                    </div>
                    {tool.inputSchema && (
                      <details className="mt-2">
                        <summary className="text-xs text-muted-foreground cursor-pointer">
                          View schema
                        </summary>
                        <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto">
                          {JSON.stringify(tool.inputSchema, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default McpLibraryPage;

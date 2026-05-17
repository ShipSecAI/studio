import { useState, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Server,
  Search,
  X,
  Globe,
  Box,
  Cloud,
  Shield,
  Database,
  Key,
  Bell,
  Layers,
  Activity,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PaginationControls } from '@/components/PaginationControls';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useCloudAssets,
  useCloudAsset,
  useCloudAssetSummary,
  useCloudSyncRuns,
  useTriggerCloudSync,
  type CloudAsset,
} from '@/hooks/queries/useCloudInventoryQueries';
import { useIntegrationConnections } from '@/hooks/queries/useIntegrationQueries';
import { useToast } from '@/components/ui/use-toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ── Asset type display config ────────────────────────────────────────────────

const ASSET_TYPE_LABELS: Record<string, string> = {
  // Tier 1
  iam_user: 'IAM User',
  iam_role: 'IAM Role',
  iam_policy: 'IAM Policy',
  iam_group: 'IAM Group',
  s3_bucket: 'S3 Bucket',
  ec2_instance: 'EC2 Instance',
  ec2_security_group: 'Security Group',
  ec2_eip: 'Elastic IP',
  ec2_volume: 'EBS Volume',
  route53_hosted_zone: 'Hosted Zone',
  route53_record: 'DNS Record',
  lambda_function: 'Lambda Function',
  ecr_repository: 'ECR Repository',
  ecr_image: 'ECR Image',
  // Tier 2
  eks_cluster: 'EKS Cluster',
  rds_instance: 'RDS Instance',
  rds_cluster: 'RDS Cluster',
  cloudfront_distribution: 'CloudFront Distribution',
  elb_load_balancer: 'Load Balancer',
  elb_target_group: 'Target Group',
  vpc: 'VPC',
  vpc_subnet: 'Subnet',
  // Tier 3
  secretsmanager_secret: 'Secret',
  kms_key: 'KMS Key',
  ecs_cluster: 'ECS Cluster',
  ecs_service: 'ECS Service',
  acm_certificate: 'ACM Certificate',
  cloudtrail_trail: 'CloudTrail Trail',
  guardduty_detector: 'GuardDuty Detector',
  sns_topic: 'SNS Topic',
  sqs_queue: 'SQS Queue',
  dynamodb_table: 'DynamoDB Table',
  elasticache_cluster: 'ElastiCache Cluster',
  apigateway_rest_api: 'REST API',
  apigateway_http_api: 'HTTP API',
  // GCP
  gcp_organization: 'GCP Organization',
  gcp_folder: 'GCP Folder',
  gcp_project: 'GCP Project',
  gcp_compute_instance: 'GCE Instance',
  gcp_storage_bucket: 'GCS Bucket',
  gcp_service_account: 'GCP Service Account',
  gcp_dns_zone: 'Cloud DNS Zone',
  gcp_gke_cluster: 'GKE Cluster',
  gcp_cloud_sql_instance: 'Cloud SQL Instance',
  gcp_secret: 'Secret Manager Secret',
  gcp_cloud_run_service: 'Cloud Run Service',
  gcp_kms_key_ring: 'KMS Key Ring',
  gcp_kms_crypto_key: 'KMS Crypto Key',
};

const SERVICE_GROUPS: Record<string, string[]> = {
  Identity: ['iam_user', 'iam_role', 'iam_policy', 'iam_group'],
  Compute: ['ec2_instance', 'lambda_function', 'ecs_cluster', 'ecs_service', 'eks_cluster'],
  Storage: [
    's3_bucket',
    'ec2_volume',
    'ecr_repository',
    'ecr_image',
    'dynamodb_table',
    'gcp_storage_bucket',
  ],
  Network: [
    'vpc',
    'vpc_subnet',
    'ec2_security_group',
    'ec2_eip',
    'elb_load_balancer',
    'elb_target_group',
    'cloudfront_distribution',
    'route53_hosted_zone',
    'route53_record',
    'apigateway_rest_api',
    'apigateway_http_api',
    'gcp_dns_zone',
  ],
  Database: ['rds_instance', 'rds_cluster', 'elasticache_cluster', 'gcp_cloud_sql_instance'],
  Security: [
    'secretsmanager_secret',
    'kms_key',
    'acm_certificate',
    'cloudtrail_trail',
    'guardduty_detector',
    'gcp_secret',
    'gcp_kms_key_ring',
    'gcp_kms_crypto_key',
    'gcp_service_account',
  ],
  Messaging: ['sns_topic', 'sqs_queue'],
  GCP: [
    'gcp_project',
    'gcp_folder',
    'gcp_organization',
    'gcp_gke_cluster',
    'gcp_cloud_run_service',
  ],
};

const GROUP_ICONS: Record<string, typeof Server> = {
  Identity: Key,
  Compute: Server,
  Storage: Database,
  Network: Globe,
  Database: Database,
  Security: Shield,
  Messaging: Bell,
};

const PAGE_SIZE = 25;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }
  > = {
    active: { variant: 'default', label: 'Active' },
    stale: { variant: 'secondary', label: 'Stale' },
    removed: { variant: 'destructive', label: 'Removed' },
  };
  const c = config[status] ?? { variant: 'outline' as const, label: status };
  return (
    <Badge variant={c.variant} className="text-xs">
      {c.label}
    </Badge>
  );
}

// ── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards() {
  const { data: summary, isLoading } = useCloudAssetSummary();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  if (!summary) return null;

  const activeCount = summary.byStatus.find((s) => s.status === 'active')?.count ?? 0;
  const staleCount = summary.byStatus.find((s) => s.status === 'stale')?.count ?? 0;
  const typeCount = summary.byType.length;
  const regionCount = summary.byRegion.length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div className="border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <Cloud className="h-4 w-4" />
          Total Assets
        </div>
        <div className="text-2xl font-semibold tabular-nums">
          {summary.totalAssets.toLocaleString()}
        </div>
      </div>
      <div className="border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <CheckCircle2 className="h-4 w-4" />
          Active
        </div>
        <div className="text-2xl font-semibold tabular-nums text-success">
          {activeCount.toLocaleString()}
        </div>
        {staleCount > 0 && <span className="text-xs text-warning">{staleCount} stale</span>}
      </div>
      <div className="border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <Layers className="h-4 w-4" />
          Asset Types
        </div>
        <div className="text-2xl font-semibold tabular-nums">{typeCount}</div>
      </div>
      <div className="border rounded-lg p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
          <Globe className="h-4 w-4" />
          Regions
        </div>
        <div className="text-2xl font-semibold tabular-nums">{regionCount}</div>
      </div>
    </div>
  );
}

// ── Type breakdown ───────────────────────────────────────────────────────────

function TypeBreakdown({ onSelectType }: { onSelectType: (type: string | null) => void }) {
  const { data: summary } = useCloudAssetSummary();
  const groupedCounts = useMemo(() => {
    if (!summary || summary.byType.length === 0) return [];

    // Group types into service groups
    const typeMap = new Map(summary.byType.map((t) => [t.assetType, t.count]));
    const groups: { group: string; types: { type: string; count: number }[]; total: number }[] = [];

    for (const [group, types] of Object.entries(SERVICE_GROUPS)) {
      const items = types
        .map((t) => ({ type: t, count: typeMap.get(t) ?? 0 }))
        .filter((t) => t.count > 0);
      if (items.length > 0) {
        groups.push({
          group,
          types: items,
          total: items.reduce((sum, t) => sum + t.count, 0),
        });
      }
    }

    return groups.sort((a, b) => b.total - a.total);
  }, [summary]);

  if (groupedCounts.length === 0) return null;

  return (
    <div className="border rounded-lg p-4 mb-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-3">Asset Breakdown</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {groupedCounts.map(({ group, types, total }) => {
          const Icon = GROUP_ICONS[group] ?? Box;
          return (
            <div key={group} className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                {group}
                <span className="text-muted-foreground ml-auto">{total}</span>
              </div>
              {types.map(({ type, count }) => (
                <button
                  key={type}
                  className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground pl-5 py-0.5 rounded hover:bg-muted/50 transition-colors"
                  onClick={() => onSelectType(type)}
                >
                  <span>{ASSET_TYPE_LABELS[type] ?? type}</span>
                  <span className="font-mono">{count}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sync run history ─────────────────────────────────────────────────────────

function SyncRunHistory({
  cloudConnections,
}: {
  cloudConnections: {
    id: string;
    provider?: string;
    displayName: string;
    metadata?: Record<string, unknown> | null;
  }[];
}) {
  const { data, isLoading } = useCloudSyncRuns({ limit: 5 });

  if (isLoading) return null;
  const connectionById = new Map(cloudConnections.map((conn) => [conn.id, conn]));
  const runs =
    data?.syncRuns.reduce<typeof data.syncRuns>((acc, run) => {
      const connection = connectionById.get(run.integrationId);
      const accountId =
        run.accountIdentifier ??
        (typeof connection?.metadata?.accountId === 'string'
          ? connection.metadata.accountId
          : null) ??
        (typeof connection?.metadata?.defaultProjectId === 'string'
          ? connection.metadata.defaultProjectId
          : null) ??
        (typeof connection?.metadata?.organizationId === 'string'
          ? connection.metadata.organizationId
          : null) ??
        (typeof connection?.metadata?.roleArn === 'string'
          ? connection.metadata.roleArn.split(':')[4] || null
          : null);
      const dedupeKey = `${run.integrationId}:${accountId ?? 'org'}`;
      const existing = acc.find(
        (item) => `${item.integrationId}:${item.accountIdentifier ?? 'org'}` === dedupeKey,
      );
      if (!existing) {
        acc.push({
          ...run,
          accountIdentifier: accountId,
        });
      }
      return acc;
    }, []) ?? [];

  if (runs.length === 0) return null;

  return (
    <div className="border rounded-lg p-4 mb-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
        <Activity className="h-3.5 w-3.5" />
        Recent Sync Status
      </h3>
      <div className="space-y-2">
        {runs.map((run) => (
          <div
            key={run.id}
            className="flex items-start gap-3 text-sm py-2 px-2 rounded hover:bg-muted/50"
          >
            {run.status === 'completed' ? (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-success" />
            ) : run.status === 'failed' ? (
              <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
            ) : (
              <RefreshCw className="h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">
                {buildSyncRunTitle(run, connectionById.get(run.integrationId))}
              </div>
              <div className="text-xs text-muted-foreground truncate mt-0.5">
                {buildSyncRunSubtitle(run)}
              </div>
            </div>
            <div className="flex items-center gap-4 text-muted-foreground text-xs whitespace-nowrap">
              {run.status === 'completed' && (
                <>
                  <span>{run.assetsDiscovered ?? 0} assets</span>
                  <span>{run.coveredRegions?.length ?? 0} regions</span>
                </>
              )}
              {run.temporalRunId ? (
                <Link
                  to={`/runs/${run.temporalRunId}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  View run
                  <ArrowUpRight className="h-3 w-3" />
                </Link>
              ) : null}
              <span>{formatRelative(run.startedAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildSyncRunTitle(
  run: {
    status: string;
    accountIdentifier: string | null;
  },
  connection?: { displayName: string; metadata?: Record<string, unknown> | null },
): string {
  const accountId =
    run.accountIdentifier ??
    (typeof connection?.metadata?.accountId === 'string' ? connection.metadata.accountId : null) ??
    (typeof connection?.metadata?.defaultProjectId === 'string'
      ? connection.metadata.defaultProjectId
      : null) ??
    (typeof connection?.metadata?.organizationId === 'string'
      ? connection.metadata.organizationId
      : null) ??
    (typeof connection?.metadata?.roleArn === 'string'
      ? connection.metadata.roleArn.split(':')[4] || null
      : null);

  if (connection?.displayName && accountId) {
    return `${connection.displayName} · ${accountId}`;
  }
  if (connection?.displayName) {
    return connection.displayName;
  }
  if (accountId) {
    return `Cloud Inventory Sync · ${accountId}`;
  }
  if (run.status === 'running') {
    return 'Cloud Inventory Sync';
  }
  return 'Org-wide Cloud Sync';
}

function buildSyncRunSubtitle(run: {
  status: string;
  errors: { message: string; timestamp: string }[] | null;
  assetsDiscovered: number | null;
  assetsCreated: number | null;
  assetsUpdated: number | null;
  coveredRegions: string[] | null;
}): string {
  if (run.status === 'failed') {
    return run.errors?.[0]?.message || 'Sync failed before final stats were recorded.';
  }
  if (run.status === 'running') {
    return 'Syncing Cartography graph and refreshing inventory...';
  }

  const parts: string[] = [];
  if ((run.assetsDiscovered ?? 0) > 0) {
    parts.push(`${run.assetsDiscovered} assets discovered`);
  }
  if ((run.assetsCreated ?? 0) > 0) {
    parts.push(`${run.assetsCreated} created`);
  }
  if ((run.assetsUpdated ?? 0) > 0) {
    parts.push(`${run.assetsUpdated} updated`);
  }
  if ((run.coveredRegions?.length ?? 0) > 0) {
    parts.push(`${run.coveredRegions?.length} regions`);
  }
  return parts.join(' · ') || 'Completed';
}

// ── Asset detail panel ───────────────────────────────────────────────────────

function AssetDetailPanel({ asset, onClose }: { asset: CloudAsset; onClose: () => void }) {
  return (
    <div className="w-[460px] border-l bg-background overflow-y-auto flex-shrink-0">
      <div className="sticky top-0 bg-background border-b px-4 py-3 flex items-center justify-between z-10">
        <h3 className="font-semibold truncate">{asset.name}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-6">
        {/* Overview */}
        <section>
          <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <Cloud className="h-3.5 w-3.5" /> Overview
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <Badge variant="outline">
                {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <StatusBadge status={asset.status} />
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Region</span>
              <span className="font-mono text-xs">{asset.region ?? 'global'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Account</span>
              <span className="font-mono text-xs">{asset.accountIdentifier}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">First Seen</span>
              <span>{formatDate(asset.firstDiscoveredAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Seen</span>
              <span>{formatDate(asset.lastSeenAt)}</span>
            </div>
          </div>
        </section>

        {/* External ID */}
        <section>
          <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <Key className="h-3.5 w-3.5" /> External ID
          </h4>
          <code className="text-xs bg-muted p-2 rounded block break-all">{asset.externalId}</code>
        </section>

        {/* Metadata */}
        {asset.metadata && Object.keys(asset.metadata).length > 0 && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Box className="h-3.5 w-3.5" /> Metadata
            </h4>
            <pre className="text-xs bg-muted p-3 rounded overflow-x-auto max-h-96">
              {JSON.stringify(asset.metadata, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded" />
      ))}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function CloudInventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  const assetType = searchParams.get('assetType') ?? undefined;
  const region = searchParams.get('region') ?? undefined;
  const status = searchParams.get('status') ?? undefined;
  const page = parseInt(searchParams.get('page') ?? '0', 10);

  const { data, isLoading } = useCloudAssets({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    assetType,
    region,
    status,
    search: search || undefined,
  });

  const { data: selectedAsset } = useCloudAsset(selectedAssetId);
  const { data: summary } = useCloudAssetSummary();
  const { data: orgConnections = [] } = useIntegrationConnections();
  const triggerSync = useTriggerCloudSync();
  const { toast } = useToast();
  const navigate = useNavigate();

  const cloudConnections = useMemo(
    () =>
      orgConnections.filter(
        (c: { provider: string; credentialType?: string }) =>
          (c.provider === 'aws' && c.credentialType === 'iam_role') ||
          (c.provider === 'gcp' && c.credentialType === 'service_account'),
      ),
    [orgConnections],
  );

  const handleSync = (connectionId: string, displayName: string) => {
    triggerSync.mutate(connectionId, {
      onSuccess: (result) => {
        toast({
          title: `Sync triggered for ${displayName}`,
          description: 'Opening workflow run details.',
        });
        navigate(`/runs/${result.runId}`);
      },
      onError: (err: any) =>
        toast({ title: 'Sync failed', description: err.message, variant: 'destructive' }),
    });
  };

  const assets = data?.assets ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const setFilterParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    next.delete('page');
    setSearchParams(next);
  };

  // Get unique regions and asset types from summary for filter dropdowns.
  // Always include the currently selected value (from URL) so the Select trigger
  // can find a matching option even when summary data is empty or still loading.
  const availableRegions = useMemo(() => {
    const fromSummary = (summary?.byRegion ?? []).map((r) => r.region);
    const all = region && !fromSummary.includes(region) ? [region, ...fromSummary] : fromSummary;
    return all.sort();
  }, [summary, region]);

  const availableTypes = useMemo(() => {
    const fromSummary = (summary?.byType ?? []).map((t) => t.assetType);
    const all =
      assetType && !fromSummary.includes(assetType) ? [assetType, ...fromSummary] : fromSummary;
    return all.sort();
  }, [summary, assetType]);

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 p-6 overflow-auto">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Cloud Inventory</h1>
              <p className="text-muted-foreground text-sm mt-1">
                {total.toLocaleString()} asset{total !== 1 ? 's' : ''} discovered across connected
                cloud environments
              </p>
            </div>
            {cloudConnections.length === 1 ? (
              <Button
                variant="outline"
                size="sm"
                disabled={triggerSync.isPending}
                onClick={() => handleSync(cloudConnections[0].id, cloudConnections[0].displayName)}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-1.5 ${triggerSync.isPending ? 'animate-spin' : ''}`}
                />
                Sync Now
              </Button>
            ) : cloudConnections.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={triggerSync.isPending}>
                    <RefreshCw
                      className={`h-4 w-4 mr-1.5 ${triggerSync.isPending ? 'animate-spin' : ''}`}
                    />
                    Sync Now
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {cloudConnections.map((conn: any) => (
                    <DropdownMenuItem
                      key={conn.id}
                      onClick={() => handleSync(conn.id, conn.displayName)}
                    >
                      {conn.displayName}
                      {(conn.metadata?.accountId ||
                        conn.metadata?.defaultProjectId ||
                        conn.metadata?.organizationId ||
                        conn.metadata?.roleArn) && (
                        <span className="text-muted-foreground text-xs ml-2">
                          (
                          {conn.metadata?.accountId ??
                            conn.metadata?.defaultProjectId ??
                            conn.metadata?.organizationId ??
                            (typeof conn.metadata?.roleArn === 'string'
                              ? conn.metadata.roleArn.split(':')[4]
                              : null)}
                          )
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>

          {/* Summary cards */}
          <SummaryCards />

          {/* Type breakdown */}
          <TypeBreakdown onSelectType={(t) => setFilterParam('assetType', t)} />

          {/* Sync run history */}
          <SyncRunHistory cloudConnections={cloudConnections} />

          {/* Filter bar */}
          <div className="flex flex-wrap gap-3 mb-4">
            <Select
              value={assetType ?? '__all__'}
              onValueChange={(v) => setFilterParam('assetType', v === '__all__' ? null : v)}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Types</SelectItem>
                {availableTypes.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ASSET_TYPE_LABELS[t] ?? t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={region ?? '__all__'}
              onValueChange={(v) => setFilterParam('region', v === '__all__' ? null : v)}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Regions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Regions</SelectItem>
                {availableRegions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={status ?? '__all__'}
              onValueChange={(v) => setFilterParam('status', v === '__all__' ? null : v)}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="stale">Stale</SelectItem>
                <SelectItem value="removed">Removed</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search assets..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Active filters */}
          {(assetType || region || status) && (
            <div className="flex gap-2 mb-4 flex-wrap">
              {assetType && (
                <Badge variant="secondary" className="gap-1">
                  Type: {ASSET_TYPE_LABELS[assetType] ?? assetType}
                  <button onClick={() => setFilterParam('assetType', null)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {region && (
                <Badge variant="secondary" className="gap-1">
                  Region: {region}
                  <button onClick={() => setFilterParam('region', null)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
              {status && (
                <Badge variant="secondary" className="gap-1">
                  Status: {status.charAt(0).toUpperCase() + status.slice(1)}
                  <button onClick={() => setFilterParam('status', null)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )}
            </div>
          )}

          {/* Table */}
          {isLoading ? (
            <LoadingSkeleton />
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 rounded-xl border bg-muted p-4">
                <Cloud className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No assets found</h3>
              <p className="text-muted-foreground max-w-md">
                Cloud assets will appear here after running an asset discovery sync on your cloud
                connections.
              </p>
            </div>
          ) : (
            <>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Name</th>
                      <th className="text-left px-4 py-3 font-medium">Type</th>
                      <th className="text-left px-4 py-3 font-medium hidden md:table-cell">
                        Region
                      </th>
                      <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">
                        Account
                      </th>
                      <th className="text-left px-4 py-3 font-medium">Status</th>
                      <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">
                        Last Seen
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset) => (
                      <tr
                        key={asset.id}
                        className={`border-b hover:bg-muted/30 cursor-pointer transition-colors ${
                          selectedAssetId === asset.id ? 'bg-muted/50' : ''
                        }`}
                        onClick={() => setSelectedAssetId(asset.id)}
                      >
                        <td className="px-4 py-3 truncate max-w-[280px]">
                          <span className="font-medium">{asset.name}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs">
                            {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell font-mono text-xs text-muted-foreground">
                          {asset.region ?? 'global'}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell font-mono text-xs text-muted-foreground">
                          {asset.accountIdentifier}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={asset.status} />
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground text-xs">
                          {formatRelative(asset.lastSeenAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <PaginationControls
                page={page}
                totalPages={totalPages}
                onPageChange={(nextPage) => setFilterParam('page', String(nextPage))}
              />
            </>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {selectedAsset && (
        <AssetDetailPanel asset={selectedAsset} onClose={() => setSelectedAssetId(null)} />
      )}
    </div>
  );
}

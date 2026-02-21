import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Server,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Globe,
  Wifi,
  FileText,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useAsmAssets,
  useAsmAsset,
  useAsmDomains,
  type AsmAsset,
} from '@/hooks/queries/useAsmQueries';

const ASSET_TYPES = [
  'subdomain',
  'web_app',
  'api',
  'ip_address',
  'certificate',
  'open_port',
  'dns_record',
  'dangling_cname',
] as const;

const TYPE_LABELS: Record<string, string> = {
  subdomain: 'Subdomain',
  web_app: 'Web App',
  api: 'API',
  ip_address: 'IP Address',
  certificate: 'Certificate',
  open_port: 'Open Port',
  dns_record: 'DNS Record',
  dangling_cname: 'Dangling CNAME',
};

const PAGE_SIZE = 25;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function AssetDetailPanel({ asset, onClose }: { asset: AsmAsset; onClose: () => void }) {
  return (
    <div className="w-[460px] border-l bg-background overflow-y-auto flex-shrink-0">
      <div className="sticky top-0 bg-background border-b px-4 py-3 flex items-center justify-between z-10">
        <h3 className="font-semibold truncate">{asset.hostname}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-6">
        {/* Overview */}
        <section>
          <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5" /> Overview
          </h4>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <Badge variant="outline">{TYPE_LABELS[asset.type] ?? asset.type}</Badge>
            </div>
            {asset.ipAddresses && asset.ipAddresses.length > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">IP</span>
                <span className="font-mono text-xs">{asset.ipAddresses.join(', ')}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">First Seen</span>
              <span>{formatDate(asset.firstSeen)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Seen</span>
              <span>{formatDate(asset.lastSeen)}</span>
            </div>
            {asset.riskScore && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Risk Score</span>
                <span className="font-medium">{asset.riskScore}</span>
              </div>
            )}
          </div>
        </section>

        {/* Technology */}
        {asset.techStack && asset.techStack.length > 0 && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" /> Technology
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {asset.techStack.map((tech) => (
                <Badge key={tech} variant="secondary" className="text-xs">
                  {tech}
                </Badge>
              ))}
            </div>
          </section>
        )}

        {/* Open Ports */}
        {asset.ports && asset.ports.length > 0 && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Wifi className="h-3.5 w-3.5" /> Open Ports
            </h4>
            <div className="space-y-1 text-sm">
              {asset.ports.map((p) => (
                <div key={p.port} className="flex justify-between font-mono text-xs">
                  <span>
                    {p.port}/{p.protocol}
                  </span>
                  <span className="text-muted-foreground">{p.service}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* TLS Info */}
        {asset.tlsInfo && Object.keys(asset.tlsInfo).length > 0 && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" /> Certificate
            </h4>
            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
              {JSON.stringify(asset.tlsInfo, null, 2)}
            </pre>
          </section>
        )}

        {/* DNS Records */}
        {asset.dnsRecords && Object.keys(asset.dnsRecords).length > 0 && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> DNS Records
            </h4>
            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
              {JSON.stringify(asset.dnsRecords, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded" />
      ))}
    </div>
  );
}

export function AssetsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);

  const domainId = searchParams.get('domainId') ?? undefined;
  const type = searchParams.get('type') ?? undefined;
  const page = parseInt(searchParams.get('page') ?? '0', 10);
  const sortBy = (searchParams.get('sortBy') as any) ?? 'lastSeen';
  const sortOrder = (searchParams.get('sortOrder') as 'asc' | 'desc') ?? 'desc';

  const { data, isLoading } = useAsmAssets({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    domainId,
    type,
    search: search || undefined,
    sortBy,
    sortOrder,
  });

  const { data: domains } = useAsmDomains();
  const { data: selectedAsset } = useAsmAsset(selectedAssetId);

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

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 p-6 overflow-auto">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Assets</h1>
              <p className="text-muted-foreground text-sm mt-1">
                {total} asset{total !== 1 ? 's' : ''} discovered across all domains
              </p>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap gap-3 mb-4">
            <Select
              value={domainId ?? '__all__'}
              onValueChange={(v) => setFilterParam('domainId', v === '__all__' ? null : v)}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Domains" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Domains</SelectItem>
                {domains?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={type ?? '__all__'}
              onValueChange={(v) => setFilterParam('type', v === '__all__' ? null : v)}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Types</SelectItem>
                {ASSET_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search hosts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <LoadingSkeleton />
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-muted p-4 mb-4">
                <Server className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No assets found</h3>
              <p className="text-muted-foreground max-w-md">
                Assets will appear here after running a scan on your domains.
              </p>
            </div>
          ) : (
            <>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Host</th>
                      <th className="text-left px-4 py-3 font-medium">Type</th>
                      <th className="text-left px-4 py-3 font-medium hidden md:table-cell">
                        Technology
                      </th>
                      <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">
                        Ports
                      </th>
                      <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">
                        First Seen
                      </th>
                      <th className="text-left px-4 py-3 font-medium">Last Seen</th>
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
                        <td className="px-4 py-3 font-mono text-xs truncate max-w-[300px]">
                          {asset.hostname}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className="text-xs">
                            {TYPE_LABELS[asset.type] ?? asset.type}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="flex gap-1 flex-wrap">
                            {asset.techStack?.slice(0, 3).map((t) => (
                              <Badge key={t} variant="secondary" className="text-xs">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell font-mono text-xs text-muted-foreground">
                          {asset.ports?.map((p) => p.port).join(', ') || '-'}
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                          {formatDate(asset.firstSeen)}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(asset.lastSeen)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-muted-foreground">
                    Page {page + 1} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page === 0}
                      onClick={() => setFilterParam('page', String(page - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages - 1}
                      onClick={() => setFilterParam('page', String(page + 1))}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
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

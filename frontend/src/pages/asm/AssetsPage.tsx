import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Server, Search, ChevronLeft, ChevronRight, Globe, Code2, Radar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { getTechIcon, getTechColor } from '@/lib/techIcons';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAsmAssets, useAsmDomains, type AsmAssetHit } from '@/hooks/queries/useAsmQueries';

const PAGE_SIZE = 25;

const SCANNER_LABELS: Record<string, string> = {
  dnsx: 'DNS',
  httpx: 'HTTP',
  nuclei: 'Nuclei',
  'asm.recon': 'Recon',
};

function getScannerLabels(asset: AsmAssetHit): string[] {
  if (Array.isArray(asset.scanner_labels) && asset.scanner_labels.length > 0) {
    return asset.scanner_labels;
  }
  if (Array.isArray(asset.source_scanners) && asset.source_scanners.length > 0) {
    return asset.source_scanners;
  }
  return [asset.scanner];
}

function TechBadge({ name }: { name: string }) {
  const Icon = getTechIcon(name);
  const color = getTechColor(name);
  return (
    <Badge variant="secondary" className="text-xs gap-1">
      {Icon && <Icon className="h-3 w-3" style={color ? { color } : undefined} />}
      {name}
    </Badge>
  );
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function AssetDetailPanel({ asset, onClose }: { asset: AsmAssetHit; onClose: () => void }) {
  return (
    <div className="w-[460px] border-l bg-background overflow-y-auto flex-shrink-0">
      <div className="sticky top-0 bg-background border-b px-4 py-3 flex items-center justify-between z-10">
        <h3 className="font-semibold truncate">{asset.host}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <span className="sr-only">Close</span>
          &times;
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
              <span className="text-muted-foreground">Scanner</span>
              <div className="flex flex-wrap justify-end gap-1">
                {getScannerLabels(asset).map((scanner) => (
                  <Badge key={scanner} variant="outline">
                    {SCANNER_LABELS[scanner] ?? scanner}
                  </Badge>
                ))}
              </div>
            </div>
            {asset.url && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">URL</span>
                <span className="font-mono text-xs truncate max-w-[280px]">{asset.url}</span>
              </div>
            )}
            {(asset.ip || asset.answers?.a?.[0] || asset.answers?.aaaa?.[0]) && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">IP</span>
                <span className="font-mono text-xs">
                  {asset.ip || asset.answers?.a?.[0] || asset.answers?.aaaa?.[0]}
                </span>
              </div>
            )}
            {asset.status_code != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status Code</span>
                <Badge variant={asset.status_code < 400 ? 'secondary' : 'destructive'}>
                  {asset.status_code}
                </Badge>
              </div>
            )}
            {asset.title && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Title</span>
                <span className="truncate max-w-[280px]">{asset.title}</span>
              </div>
            )}
            {asset.webserver && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Web Server</span>
                <span className="font-mono text-xs">{asset.webserver}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Seen</span>
              <span>{formatDate(asset.timestamp)}</span>
            </div>
          </div>
        </section>

        {/* Technology */}
        {asset.technologies && asset.technologies.length > 0 && (
          <section>
            <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Code2 className="h-3.5 w-3.5" /> Technology
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {asset.technologies.map((tech) => (
                <TechBadge key={tech} name={tech} />
              ))}
            </div>
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
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<AsmAssetHit | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const domainFilter = searchParams.get('domain') ?? undefined;
  const scannerFilter = searchParams.get('scanner') ?? undefined;
  const page = parseInt(searchParams.get('page') ?? '0', 10);

  // Debounce search input
  useEffect(() => {
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 300);
    return () => clearTimeout(debounceTimer.current);
  }, [searchInput]);

  const { data: domains } = useAsmDomains();

  const { data, isLoading } = useAsmAssets({
    scanner: scannerFilter ? [scannerFilter] : undefined,
    search: debouncedSearch || undefined,
    page,
    domain: domainFilter,
  });

  const hits = data?.hits ?? [];
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
              <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
              <p className="text-muted-foreground text-sm mt-1">
                {total} unique host{total !== 1 ? 's' : ''} discovered across all domains
              </p>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap gap-3 mb-4">
            <Select
              value={domainFilter ?? '__all__'}
              onValueChange={(v) => setFilterParam('domain', v === '__all__' ? null : v)}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Domains" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Domains</SelectItem>
                {domains?.map((d) => (
                  <SelectItem key={d.id} value={d.domain}>
                    {d.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={scannerFilter ?? '__all__'}
              onValueChange={(v) => setFilterParam('scanner', v === '__all__' ? null : v)}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All Scanners" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Scanners</SelectItem>
                <SelectItem value="dnsx">DNS (DNSx)</SelectItem>
                <SelectItem value="httpx">HTTP (HTTPx)</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search hosts..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <LoadingSkeleton />
          ) : hits.length === 0 ? (
            <section className="rounded-xl border bg-card/80 p-6 shadow-sm">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="flex max-w-2xl gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-muted/70">
                    <Server className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold tracking-tight">No assets found</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      Assets appear after a domain scan discovers DNS records, HTTP services, and
                      exposed hosts.
                    </p>
                  </div>
                </div>
                <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3 md:w-[28rem]">
                  {['Run a domain scan', 'Review new hosts', 'Open asset details'].map((step) => (
                    <div
                      key={step}
                      className="flex min-h-10 items-center gap-2 rounded-md border bg-background/70 px-3"
                    >
                      <Radar className="h-3.5 w-3.5 shrink-0" />
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium">Host</th>
                      <th className="text-left px-4 py-3 font-medium">Scanner</th>
                      <th className="text-left px-4 py-3 font-medium hidden md:table-cell">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">
                        Technology
                      </th>
                      <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">IP</th>
                      <th className="text-left px-4 py-3 font-medium hidden sm:table-cell">
                        Web Server
                      </th>
                      <th className="text-left px-4 py-3 font-medium">Last Seen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hits.map((hit) => (
                      <tr
                        key={hit.id}
                        className={`border-b hover:bg-muted/30 cursor-pointer transition-colors ${
                          selectedAsset?.id === hit.id ? 'bg-muted/50' : ''
                        }`}
                        onClick={() => setSelectedAsset(hit)}
                      >
                        <td className="px-4 py-3 font-mono text-xs truncate max-w-[300px]">
                          {hit.host}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {getScannerLabels(hit).map((scanner) => (
                              <Badge
                                key={`${hit.id}-${scanner}`}
                                variant="outline"
                                className="text-xs"
                              >
                                {SCANNER_LABELS[scanner] ?? scanner}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          {hit.status_code != null ? (
                            <Badge
                              variant={hit.status_code < 400 ? 'secondary' : 'destructive'}
                              className="text-xs"
                            >
                              {hit.status_code}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <div className="flex gap-1 flex-wrap">
                            {hit.technologies?.slice(0, 3).map((t) => (
                              <TechBadge key={t} name={t} />
                            ))}
                            {(hit.technologies?.length ?? 0) > 3 && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                +{hit.technologies!.length - 3}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell font-mono text-xs text-muted-foreground">
                          {hit.ip || hit.answers?.a?.[0] || hit.answers?.aaaa?.[0] || '-'}
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground text-xs">
                          {hit.webserver ?? '-'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDate(hit.timestamp)}
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
        <AssetDetailPanel asset={selectedAsset} onClose={() => setSelectedAsset(null)} />
      )}
    </div>
  );
}

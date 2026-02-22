import { useState } from 'react';
import { Globe, Plus, MoreHorizontal, Play, ExternalLink, Trash2, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import {
  useAsmDomains,
  useCreateDomain,
  useDeleteDomain,
  useTriggerDomainScan,
  type AsmDomain,
} from '@/hooks/queries/useAsmQueries';

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function DomainCard({
  domain,
  onScan,
  onDelete,
}: {
  domain: AsmDomain;
  onScan: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const navigate = useNavigate();

  return (
    <Card className="group hover:border-primary/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <CardTitle className="text-base truncate">{domain.domain}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800"
            >
              Active
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onScan(domain.id)}>
                  <Play className="h-4 w-4 mr-2" />
                  Run Scan
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/asm/assets?domain=${domain.domain}`)}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View Assets
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDelete(domain.id)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-muted-foreground">Assets</span>
            <p className="font-medium">{domain.assetCount}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Last Scan</span>
            <p className="font-medium">{formatRelativeTime(domain.lastScanAt)}</p>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={() => onScan(domain.id)}>
            <Play className="h-3.5 w-3.5 mr-1.5" />
            Scan
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => navigate(`/asm/assets?domain=${domain.domain}`)}
          >
            View Assets
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AddDomainDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [domain, setDomain] = useState('');
  const [scopeInclude, setScopeInclude] = useState('');
  const [scopeExclude, setScopeExclude] = useState('');
  const createDomain = useCreateDomain();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (scanNow: boolean) => {
    try {
      const result = await createDomain.mutateAsync({
        domain,
        scopeInclude: scopeInclude ? scopeInclude.split('\n').filter(Boolean) : undefined,
        scopeExclude: scopeExclude ? scopeExclude.split('\n').filter(Boolean) : undefined,
        scanNow,
      });
      toast({
        title: scanNow ? 'Domain added & scan started' : 'Domain added',
        description: `${domain} has been added to your attack surface.`,
      });
      setDomain('');
      setScopeInclude('');
      setScopeExclude('');
      onOpenChange(false);

      // Navigate to the workflow run if a scan was triggered
      if (scanNow && result.runId) {
        navigate(`/runs/${result.runId}`);
      }
    } catch (error) {
      toast({
        title: 'Failed to add domain',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Domain</DialogTitle>
          <DialogDescription>
            Enter a root domain to discover your external attack surface.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="domain">Root Domain</Label>
            <Input
              id="domain"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scope-include">
              Include Patterns <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Textarea
              id="scope-include"
              placeholder="*.example.com&#10;api.example.com"
              value={scopeInclude}
              onChange={(e) => setScopeInclude(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scope-exclude">
              Exclude Patterns <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Textarea
              id="scope-exclude"
              placeholder="internal.example.com&#10;staging.*"
              value={scopeExclude}
              onChange={(e) => setScopeExclude(e.target.value)}
              rows={3}
              className="text-sm"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleSubmit(false)}
            disabled={!domain || createDomain.isPending}
          >
            Add Without Scanning
          </Button>
          <Button onClick={() => handleSubmit(true)} disabled={!domain || createDomain.isPending}>
            {createDomain.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add & Scan Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({ onAddDomain }: { onAddDomain: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-6 mb-6">
        <Globe className="h-10 w-10 text-muted-foreground" />
      </div>
      <h3 className="text-xl font-semibold mb-2">Add your first domain</h3>
      <p className="text-muted-foreground max-w-md mb-6">
        Enter a root domain to discover your external attack surface — subdomains, DNS records, open
        ports, certificates, and vulnerabilities.
      </p>
      <Button onClick={onAddDomain} size="lg">
        <Plus className="h-4 w-4 mr-2" />
        Add Domain
      </Button>
      <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm text-muted-foreground max-w-lg">
        {[
          'Subdomain enumeration',
          'DNS analysis',
          'HTTP fingerprinting',
          'Port scanning',
          'Vulnerability detection',
          'Certificate inventory',
        ].map((feature) => (
          <div key={feature} className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-primary" />
            {feature}
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-5 w-40" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-10 rounded" />
              <Skeleton className="h-10 rounded" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function DomainsPage() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const { data: domains, isLoading } = useAsmDomains();
  const deleteDomain = useDeleteDomain();
  const triggerScan = useTriggerDomainScan();
  const { toast } = useToast();

  const navigate = useNavigate();

  const handleScan = async (domainId: string) => {
    try {
      const result = await triggerScan.mutateAsync({ domainId });
      toast({
        title: 'Scan started',
        description: `Running attack surface scan for ${result.domain}`,
      });
      // Navigate to the workflow run
      if (result.runId) {
        navigate(`/runs/${result.runId}`);
      }
    } catch (error) {
      toast({
        title: 'Failed to start scan',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (domainId: string) => {
    try {
      await deleteDomain.mutateAsync(domainId);
      toast({ title: 'Domain removed' });
    } catch (error) {
      toast({
        title: 'Failed to remove domain',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Domains</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage root domains for attack surface discovery
          </p>
        </div>
        {domains && domains.length > 0 && (
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Domain
          </Button>
        )}
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : !domains || domains.length === 0 ? (
        <EmptyState onAddDomain={() => setAddDialogOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {domains.map((domain) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              onScan={handleScan}
              onDelete={handleDelete}
            />
          ))}
          {/* Dashed add card */}
          <button
            onClick={() => setAddDialogOpen(true)}
            className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors min-h-[170px]"
          >
            <Plus className="h-8 w-8" />
            <span className="text-sm font-medium">Add Domain</span>
          </button>
        </div>
      )}

      <AddDomainDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  );
}

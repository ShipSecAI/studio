import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, FolderGit, Code, Cloud, Shield, Container, Globe } from 'lucide-react';
import { useGitHubRepositories, useTriggerScan } from '@/hooks/queries/useGithubQueries';
import { useIntegrationConnections } from '@/hooks/queries/useIntegrationQueries';
import { useAsmDomains, useTriggerDomainScan } from '@/hooks/queries/useAsmQueries';
import { useGitHubStore } from '@/store/githubStore';
import { useToast } from '@/components/ui/use-toast';
import { QUICK_SCANS } from '@/components/security/constants';
import { SearchableSelectionList } from '@/components/security/ScheduleDialogShared';
import { api } from '@/services/api';

type Category = 'code' | 'cloud' | 'asm';

interface AwsConnection {
  id: string;
  displayName?: string;
  provider: string;
  credentialType?: string;
  config?: Record<string, unknown>;
  status?: string;
}

const CLOUD_SCANS = [
  {
    id: 'aws-cloud-security-scan',
    templateSlug: 'sys-aws-cloud-security-scan',
    name: 'AWS Misconfiguration Scan',
    description: 'Prowler — CIS, GDPR, HIPAA benchmarks',
    icon: Shield,
    providers: ['aws'],
  },
  {
    id: 'gcp-cloud-security-scan',
    templateSlug: 'sys-gcp-cloud-security-scan',
    name: 'GCP Misconfiguration Scan',
    description: 'Prowler — GCP posture and compliance checks',
    icon: Shield,
    providers: ['gcp'],
  },
  {
    id: 'container-image-scan',
    templateSlug: 'sys-container-image-scan',
    name: 'Container Image Scan',
    description: 'Trivy — ECR image vulnerability scan',
    icon: Container,
    providers: ['aws'],
  },
];

const CATEGORIES: { key: Category; label: string; description: string; icon: typeof Code }[] = [
  {
    key: 'code',
    label: 'Code Security',
    description: 'Secrets, SAST & dependency audits',
    icon: Code,
  },
  {
    key: 'cloud',
    label: 'Cloud Security',
    description: 'AWS misconfigurations & container scans',
    icon: Cloud,
  },
  {
    key: 'asm',
    label: 'Attack Surface',
    description: 'Subdomain discovery, DNS & HTTP probing',
    icon: Globe,
  },
];

export function QuickScanDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [category, setCategory] = useState<Category | null>(null);
  const [selectedScanTemplateSlug, setSelectedScanTemplateSlug] = useState<string | null>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setCategory(null);
      setSelectedScanTemplateSlug(null);
    }
  }, [open]);

  const handleCategorySelect = (cat: Category) => {
    if (cat === category) return;
    setCategory(cat);
    setSelectedScanTemplateSlug(null);
  };

  const handleScanTypeSelect = (templateSlug: string) => {
    setSelectedScanTemplateSlug(templateSlug);
  };

  // Show target picker when: ASM selected, or a scan type is chosen
  const showTarget = category === 'asm' || (category && selectedScanTemplateSlug);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick Scan</DialogTitle>
          <DialogDescription>
            {!category && 'What would you like to scan?'}
            {category && !showTarget && 'Choose a scan type'}
            {showTarget && category === 'code' && 'Pick a repository to scan'}
            {showTarget && category === 'cloud' && 'Pick an AWS account to scan'}
            {showTarget && category === 'asm' && 'Pick a domain to scan'}
          </DialogDescription>
        </DialogHeader>

        {/* Category selection — always visible */}
        <div className="grid grid-cols-3 gap-3">
          {CATEGORIES.map(({ key, label, description, icon: Icon }) => (
            <button
              key={key}
              onClick={() => handleCategorySelect(key)}
              className={`rounded-lg border p-3 hover:border-primary/50 transition-colors flex flex-col items-center text-center gap-1.5 ${
                category === key ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <Icon
                className={`h-5 w-5 ${category === key ? 'text-primary' : 'text-muted-foreground'}`}
              />
              <div>
                <div className="font-medium text-xs">{label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                  {description}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Scan type selection — for code & cloud */}
        {category && category !== 'asm' && (
          <ScanTypeStep
            category={category}
            selected={selectedScanTemplateSlug}
            onSelect={handleScanTypeSelect}
          />
        )}

        {/* Target pickers */}
        {showTarget && category === 'code' && selectedScanTemplateSlug && (
          <CodeTargetStep templateSlug={selectedScanTemplateSlug} onClose={onClose} />
        )}
        {showTarget && category === 'cloud' && selectedScanTemplateSlug && (
          <CloudTargetStep templateSlug={selectedScanTemplateSlug} onClose={onClose} />
        )}
        {showTarget && category === 'asm' && <AsmTargetStep onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

// ── Scan Type Selection ──────────────────────────────────────────────────────

function ScanTypeStep({
  category,
  selected,
  onSelect,
}: {
  category: Category;
  selected: string | null;
  onSelect: (templateSlug: string) => void;
}) {
  const scans = category === 'code' ? QUICK_SCANS : CLOUD_SCANS;

  return (
    <div className="grid gap-1.5 border-t pt-3">
      <div className="text-xs font-medium text-muted-foreground mb-0.5">Scan type</div>
      {scans.map((scan) => {
        const Icon = scan.icon;
        const isSelected = selected === scan.templateSlug;
        return (
          <button
            key={scan.id}
            onClick={() => onSelect(scan.templateSlug)}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
              isSelected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
            }`}
          >
            <Icon
              className={`h-4 w-4 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`}
            />
            <div>
              <div className="text-sm font-medium">{scan.name}</div>
              <div className="text-xs text-muted-foreground">{scan.description}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Code Target (Repo Picker) ────────────────────────────────────────────────

function CodeTargetStep({ templateSlug, onClose }: { templateSlug: string; onClose: () => void }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: repositories = [], isLoading } = useGitHubRepositories();
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);
  const triggerScanMutation = useTriggerScan();
  const [search, setSearch] = useState('');
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  useEffect(() => {
    fetchSystemWorkflows();
  }, [fetchSystemWorkflows]);

  const workflowId = useMemo(() => {
    const match = systemWorkflows.find((sw) => sw.slug === templateSlug);
    return match?.id;
  }, [systemWorkflows, templateSlug]);

  const filteredRepos = useMemo(() => {
    if (!search.trim()) return repositories;
    const q = search.toLowerCase();
    return repositories.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repositories, search]);

  const handleTrigger = async (repo: {
    id: string;
    fullName: string;
    defaultBranch?: string | null;
  }) => {
    if (!workflowId) return;
    setTriggeringId(repo.id);
    try {
      const result = await triggerScanMutation.mutateAsync({
        repoId: repo.id,
        workflowId,
        branch: repo.defaultBranch ?? undefined,
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
      setTriggeringId(null);
    }
  };

  if (!isLoading && repositories.length === 0) {
    return (
      <div className="py-4 text-center space-y-3 border-t pt-3">
        <p className="text-sm text-muted-foreground">No GitHub repositories connected</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onClose();
            navigate('/github/repositories');
          }}
        >
          Connect GitHub
        </Button>
      </div>
    );
  }

  if (!workflowId && !isLoading) {
    return (
      <div className="py-4 text-center border-t pt-3">
        <p className="text-sm text-destructive">
          System workflow not found. Please check your workflow templates.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="text-xs font-medium text-muted-foreground">Select repository</div>
      <SearchableSelectionList
        items={filteredRepos}
        isLoading={isLoading}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search repositories..."
        emptyMessage="No repositories found"
        listClassName="max-h-48"
        getKey={(repo) => repo.id}
        renderItem={(repo) => (
          <button
            onClick={() => handleTrigger(repo)}
            disabled={triggeringId !== null}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors disabled:opacity-50"
          >
            {triggeringId === repo.id ? (
              <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
            ) : (
              <FolderGit className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{repo.fullName}</div>
              {repo.description && (
                <div className="text-xs text-muted-foreground truncate">{repo.description}</div>
              )}
            </div>
          </button>
        )}
      />
    </div>
  );
}

// ── Cloud Target (Connection Picker) ─────────────────────────────────────────

function CloudTargetStep({ templateSlug, onClose }: { templateSlug: string; onClose: () => void }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: connections = [], isLoading } = useIntegrationConnections();
  const systemWorkflows = useGitHubStore((s) => s.systemWorkflows);
  const fetchSystemWorkflows = useGitHubStore((s) => s.fetchSystemWorkflows);
  const [search, setSearch] = useState('');
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  useEffect(() => {
    fetchSystemWorkflows();
  }, [fetchSystemWorkflows]);

  const workflowId = useMemo(() => {
    const match = systemWorkflows.find((sw) => sw.slug === templateSlug);
    return match?.id;
  }, [systemWorkflows, templateSlug]);

  const selectedProviders = useMemo(() => {
    const match = CLOUD_SCANS.find((scan) => scan.templateSlug === templateSlug);
    return match?.providers ?? ['aws'];
  }, [templateSlug]);

  const cloudConnections = useMemo(() => {
    const matches = connections.filter(
      (c: AwsConnection) => selectedProviders.includes(c.provider) && c.status !== 'disconnected',
    );
    if (!search.trim()) return matches;
    const q = search.toLowerCase();
    return matches.filter(
      (c: AwsConnection) =>
        (c.displayName ?? '').toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    );
  }, [connections, search, selectedProviders]);

  const handleTrigger = async (connection: AwsConnection) => {
    if (!workflowId) return;
    setTriggeringId(connection.id);
    try {
      const { executionId } = await api.executions.start(workflowId, {
        inputs: { connectionId: connection.id },
      });
      toast({ title: 'Scan started', description: `Execution ${executionId.slice(0, 8)}...` });
      onClose();
      if (executionId) {
        navigate(`/runs/${executionId}`);
      }
    } catch (err) {
      toast({
        title: 'Failed to start scan',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setTriggeringId(null);
    }
  };

  if (!isLoading && cloudConnections.length === 0 && !search.trim()) {
    return (
      <div className="py-4 text-center space-y-3 border-t pt-3">
        <p className="text-sm text-muted-foreground">
          {selectedProviders.includes('gcp')
            ? 'No GCP accounts connected'
            : 'No AWS accounts connected'}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onClose();
            navigate('/cloud/accounts');
          }}
        >
          {selectedProviders.includes('gcp') ? 'Connect GCP' : 'Connect AWS'}
        </Button>
      </div>
    );
  }

  if (!workflowId && !isLoading) {
    return (
      <div className="py-4 text-center border-t pt-3">
        <p className="text-sm text-destructive">
          System workflow not found. Please check your workflow templates.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="text-xs font-medium text-muted-foreground">
        Select {selectedProviders.includes('gcp') ? 'GCP account' : 'AWS account'}
      </div>
      <SearchableSelectionList
        items={cloudConnections}
        isLoading={isLoading}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search accounts..."
        emptyMessage="No accounts found"
        listClassName="max-h-48"
        getKey={(conn) => conn.id}
        renderItem={(conn: AwsConnection) => (
          <button
            onClick={() => handleTrigger(conn)}
            disabled={triggeringId !== null}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors disabled:opacity-50"
          >
            {triggeringId === conn.id ? (
              <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
            ) : (
              <Cloud className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {conn.displayName || (conn.provider === 'gcp' ? 'GCP Account' : 'AWS Account')}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {conn.provider === 'gcp'
                  ? conn.config?.defaultProjectId
                    ? `Project ${String(conn.config.defaultProjectId)}`
                    : conn.id.slice(0, 8)
                  : conn.config?.accountId
                    ? `Account ${String(conn.config.accountId)}`
                    : conn.id.slice(0, 8)}
                {conn.provider === 'aws' && conn.config?.region
                  ? ` · ${String(conn.config.region)}`
                  : ''}
              </div>
            </div>
          </button>
        )}
      />
    </div>
  );
}

// ── ASM Target (Domain Picker) ───────────────────────────────────────────────

function AsmTargetStep({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data: domains = [], isLoading } = useAsmDomains();
  const triggerScan = useTriggerDomainScan();
  const [search, setSearch] = useState('');
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  const filteredDomains = useMemo(() => {
    if (!search.trim()) return domains;
    const q = search.toLowerCase();
    return domains.filter((d) => d.domain.toLowerCase().includes(q));
  }, [domains, search]);

  const handleTrigger = async (domain: { id: string; domain: string }) => {
    setTriggeringId(domain.id);
    try {
      const result = await triggerScan.mutateAsync({ domainId: domain.id });
      toast({
        title: 'Scan started',
        description: `Running attack surface scan for ${domain.domain}`,
      });
      onClose();
      if (result.runId) {
        navigate(`/runs/${result.runId}`);
      }
    } catch (err) {
      toast({
        title: 'Failed to start scan',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setTriggeringId(null);
    }
  };

  if (!isLoading && domains.length === 0) {
    return (
      <div className="py-4 text-center space-y-3 border-t pt-3">
        <p className="text-sm text-muted-foreground">No domains configured</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onClose();
            navigate('/asm/domains');
          }}
        >
          Add Domain
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="text-xs font-medium text-muted-foreground">Select domain</div>
      <SearchableSelectionList
        items={filteredDomains}
        isLoading={isLoading}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search domains..."
        emptyMessage="No domains found"
        listClassName="max-h-48"
        getKey={(domain) => domain.id}
        renderItem={(domain) => (
          <button
            onClick={() => handleTrigger(domain)}
            disabled={triggeringId !== null}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-accent transition-colors disabled:opacity-50"
          >
            {triggeringId === domain.id ? (
              <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
            ) : (
              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{domain.domain}</div>
              <div className="text-xs text-muted-foreground truncate">
                {domain.assetCount} asset{domain.assetCount !== 1 ? 's' : ''}
                {domain.lastScanAt
                  ? ` · Last scan ${new Date(domain.lastScanAt).toLocaleDateString()}`
                  : ' · Never scanned'}
              </div>
            </div>
          </button>
        )}
      />
    </div>
  );
}

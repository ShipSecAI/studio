import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExternalLink, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { MarkdownView } from '@/components/ui/markdown';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useProwlerChecksMetadata } from '@/hooks/queries/useSecurityQueries';
import type { SecurityFinding, FindingLifecycle } from '@/lib/securityQueryHelpers';
import type { ProwlerCheckMetadata } from '@/services/api';
import { SeverityBadge, StatusBadge } from './SeverityBadge';

const SCANNER_LOGO: Record<string, { src?: string; emoji?: string; alt: string }> = {
  opengrep: { src: '/icons/opengrep.ico', alt: 'OpenGrep' },
  trufflehog: { emoji: '🔑', alt: 'TruffleHog' },
  prowler: { src: '/icons/prowler.svg', alt: 'Prowler' },
  nuclei: { src: '/icons/nuclei.svg', alt: 'Nuclei' },
  safedep: { src: '/icons/safedep.png', alt: 'SafeDep' },
};

interface FindingDetailSheetProps {
  finding: SecurityFinding | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lifecycle: FindingLifecycle | null;
  lifecycleLoading: boolean;
  accountNameMap?: Map<string, string>;
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 0) return 'just now';

  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function ScannerLabel({ scanner }: { scanner: string }) {
  const logo = SCANNER_LOGO[scanner];
  const icon = logo?.emoji ? (
    <span
      className="w-4 h-4 flex items-center justify-center text-sm"
      role="img"
      aria-label={logo.alt}
    >
      {logo.emoji}
    </span>
  ) : logo?.src ? (
    <img src={logo.src} alt={logo.alt} className="w-4 h-4 rounded object-contain" />
  ) : null;

  return (
    <span className="inline-flex items-center gap-1.5">
      {icon}
      {scanner}
    </span>
  );
}

function RemediationCodeBlock({ code, language }: { code: string; language: string }) {
  const trimmed = code.trim();

  // If the content is a URL, render as a link instead of a code block
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return (
      <a
        href={trimmed}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        View Documentation
        <ExternalLink className="h-3 w-3" />
      </a>
    );
  }

  // Some metadata fields (terraform, nativeIaC) already contain markdown code fences.
  // Detect this to avoid double-wrapping which breaks syntax highlighting.
  const alreadyFenced = trimmed.startsWith('```');
  const content = alreadyFenced ? code : `\`\`\`${language}\n${code}\n\`\`\``;
  return (
    <MarkdownView
      content={content}
      className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground [&_pre]:max-h-80 [&_pre]:overflow-auto"
    />
  );
}

function RemediationTabs({
  metadata,
  remediationText,
  recommendationUrl,
}: {
  metadata: ProwlerCheckMetadata;
  remediationText: string | null;
  recommendationUrl: string | null;
}) {
  const tabs = useMemo(() => {
    const t: { value: string; label: string; code: string; language: string }[] = [];
    // Manual first as the default tab
    if (metadata.other)
      t.push({ value: 'manual', label: 'Manual', code: metadata.other, language: 'text' });
    if (metadata.cli) t.push({ value: 'cli', label: 'CLI', code: metadata.cli, language: 'bash' });
    if (metadata.terraform)
      t.push({ value: 'terraform', label: 'Terraform', code: metadata.terraform, language: 'hcl' });
    if (metadata.nativeIaC)
      t.push({
        value: 'cloudformation',
        label: 'CloudFormation',
        code: metadata.nativeIaC,
        language: 'yaml',
      });
    return t;
  }, [metadata]);

  const defaultTab = tabs[0]?.value ?? 'manual';

  return (
    <div className="space-y-5">
      {(remediationText || recommendationUrl) && (
        <div>
          <h4 className="text-sm font-medium mb-2">Recommendation</h4>
          {remediationText && (
            <MarkdownView
              content={remediationText}
              className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground mb-2"
            />
          )}
          {recommendationUrl && (
            <a
              href={recommendationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View Recommendation
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
      <div>
        <h4 className="text-sm font-medium mb-2">Remediation</h4>
        <Tabs defaultValue={defaultTab}>
          <TabsList className="h-auto bg-transparent p-0 border-b rounded-none justify-start gap-0">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="text-xs rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-primary"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>
              <RemediationCodeBlock code={tab.code} language={tab.language} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

export function FindingDetailSheet({
  finding,
  open,
  onOpenChange,
  lifecycle,
  lifecycleLoading,
  accountNameMap,
}: FindingDetailSheetProps) {
  const [rawExpanded, setRawExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { data: prowlerMetadataMap } = useProwlerChecksMetadata();

  // Build a reverse lookup from checkTitle → metadata for Prowler findings
  const checkMetadata = useMemo((): ProwlerCheckMetadata | null => {
    if (!finding || finding.scanner !== 'prowler' || !prowlerMetadataMap) return null;
    // Try direct lookup by check_name (if available) then by title
    for (const meta of Object.values(prowlerMetadataMap)) {
      if (meta.checkTitle && meta.checkTitle === finding.title) return meta;
    }
    return null;
  }, [finding, prowlerMetadataMap]);

  if (!finding) return null;

  const handleCopy = async () => {
    const raw = JSON.stringify(finding, null, 2);
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const workflowId = finding.workflow_id;
  const runId = finding.run_id;
  const isCodeFinding = finding.scanner === 'opengrep' || finding.scanner === 'trufflehog';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="pr-8 leading-snug">
            {finding.title ?? 'Untitled Finding'}
          </SheetTitle>
          <SheetDescription>
            <span className="inline-flex gap-2 mt-1">
              <SeverityBadge severity={finding.severity} />
              <StatusBadge status={finding.status} />
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-4">
            {isCodeFinding ? (
              <>
                <DetailRow
                  label="File"
                  value={
                    finding.file ? (
                      <span className="break-all text-xs font-mono">
                        {finding.file}
                        {finding.line ? `:${finding.line}` : ''}
                      </span>
                    ) : null
                  }
                />
                <DetailRow label="Scanner" value={<ScannerLabel scanner={finding.scanner} />} />
                <DetailRow
                  label="Run"
                  value={
                    workflowId && runId ? (
                      <Link
                        to={`/workflows/${workflowId}/runs/${runId}`}
                        className="inline-flex items-center gap-1.5 hover:underline"
                      >
                        {finding.workflow_name ?? 'View Run'}
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </Link>
                    ) : null
                  }
                />
                <DetailRow label="Rule ID" value={finding.rule_id} />
                <DetailRow
                  label="Timestamp"
                  value={finding.timestamp ? new Date(finding.timestamp).toLocaleString() : null}
                />
                <DetailRow label="Repository" value={finding.trigger_source} />
              </>
            ) : (
              <>
                <DetailRow
                  label="Account"
                  value={
                    finding.account_id ? (
                      <div>
                        <div>{accountNameMap?.get(finding.account_id) ?? finding.account_id}</div>
                        {accountNameMap?.has(finding.account_id) && (
                          <div className="text-xs text-muted-foreground font-mono">
                            {finding.account_id}
                          </div>
                        )}
                      </div>
                    ) : null
                  }
                />
                <DetailRow label="Region" value={finding.region} />
                <DetailRow
                  label="Resource"
                  value={
                    finding.asset_key ? (
                      <span className="break-all text-xs font-mono">{finding.asset_key}</span>
                    ) : null
                  }
                />
                <DetailRow label="Scanner" value={<ScannerLabel scanner={finding.scanner} />} />
                <DetailRow
                  label="Run"
                  value={
                    workflowId && runId ? (
                      <Link
                        to={`/workflows/${workflowId}/runs/${runId}`}
                        className="inline-flex items-center gap-1.5 hover:underline"
                      >
                        {finding.workflow_name ?? 'View Run'}
                        <ExternalLink className="h-3 w-3 text-muted-foreground" />
                      </Link>
                    ) : null
                  }
                />
                <DetailRow label="Check" value={finding.check_name} />
                <DetailRow
                  label="Timestamp"
                  value={finding.timestamp ? new Date(finding.timestamp).toLocaleString() : null}
                />
              </>
            )}
          </div>

          {/* Code Snippet */}
          {isCodeFinding && finding.snippet && (
            <div>
              <h4 className="text-sm font-medium mb-2">Code Snippet</h4>
              <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-40 font-mono">
                {finding.snippet}
              </pre>
            </div>
          )}

          {/* Finding History */}
          {(lifecycleLoading || lifecycle) && (
            <div className="rounded-md border p-3 space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Finding History
              </h4>
              {lifecycleLoading ? (
                <div className="grid grid-cols-3 gap-3">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                </div>
              ) : lifecycle ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">First Seen</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-sm font-medium cursor-default">
                          {formatRelativeTime(lifecycle.firstSeen)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {new Date(lifecycle.firstSeen).toLocaleString()}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Last Seen</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-sm font-medium cursor-default">
                          {formatRelativeTime(lifecycle.lastSeen)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {new Date(lifecycle.lastSeen).toLocaleString()}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Observed</span>
                    <span className="text-sm font-medium">
                      {lifecycle.occurrences} {lifecycle.occurrences === 1 ? 'time' : 'times'}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Compliance */}
          {finding.compliance && finding.compliance.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Compliance</h4>
              <div className="flex flex-wrap gap-1">
                {finding.compliance.map((framework) => (
                  <Badge key={framework} variant="outline" className="text-xs">
                    {framework}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Finding Types */}
          {finding.finding_types && finding.finding_types.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Finding Types</h4>
              <div className="flex flex-wrap gap-1">
                {finding.finding_types.map((ft) => (
                  <Badge key={ft} variant="secondary" className="text-xs">
                    {ft}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {finding.description && (
            <div>
              <h4 className="text-sm font-medium mb-2">Description</h4>
              <MarkdownView
                content={finding.description}
                className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground"
              />
            </div>
          )}

          {/* Remediation */}
          {checkMetadata &&
          (checkMetadata.cli ||
            checkMetadata.terraform ||
            checkMetadata.nativeIaC ||
            checkMetadata.other) ? (
            <RemediationTabs
              metadata={checkMetadata}
              remediationText={finding.remediationText}
              recommendationUrl={finding.recommendationUrl}
            />
          ) : finding.remediationText || finding.recommendationUrl ? (
            <div>
              <h4 className="text-sm font-medium mb-2">Remediation</h4>
              {finding.remediationText && (
                <MarkdownView
                  content={finding.remediationText}
                  className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground mb-2"
                />
              )}
              {finding.recommendationUrl && (
                <a
                  href={finding.recommendationUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View Recommendation
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          ) : null}

          {/* Raw Data */}
          <div className="border-t pt-4">
            <button
              onClick={() => setRawExpanded(!rawExpanded)}
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {rawExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Raw Data
            </button>
            {rawExpanded && (
              <div className="mt-2 relative">
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-2 right-2 h-7 px-2"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                </Button>
                <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto max-h-80">
                  {JSON.stringify(finding, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

import { useState } from 'react';
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
import { ExternalLink, Copy, Check, ChevronDown, ChevronRight, Workflow } from 'lucide-react';
import type { SecurityFinding } from '@/store/securityDashboardStore';

interface FindingDetailSheetProps {
  finding: SecurityFinding | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SeverityBadge({ severity }: { severity: string }) {
  const s = severity.toLowerCase();
  const variant =
    s === 'critical'
      ? 'destructive'
      : s === 'high'
        ? 'warning'
        : s === 'medium'
          ? 'secondary'
          : 'outline';
  return <Badge variant={variant}>{severity}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'FAILED' ? 'destructive' : status === 'PASS' ? 'success' : 'secondary';
  return <Badge variant={variant}>{status}</Badge>;
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

export function FindingDetailSheet({ finding, open, onOpenChange }: FindingDetailSheetProps) {
  const [rawExpanded, setRawExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!finding) return null;

  const handleCopy = async () => {
    const raw = JSON.stringify(finding, null, 2);
    await navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const workflowId = finding.shipsec?.workflow_id;
  const runId = finding.shipsec?.run_id;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
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
            <DetailRow label="Account ID" value={finding.account_id} />
            <DetailRow label="Region" value={finding.region} />
            <DetailRow
              label="Resource"
              value={
                finding.asset_key ? (
                  <span className="break-all text-xs font-mono">{finding.asset_key}</span>
                ) : null
              }
            />
            <DetailRow label="Scanner" value={finding.scanner} />
            <DetailRow
              label="Timestamp"
              value={
                finding['@timestamp'] ? new Date(finding['@timestamp']).toLocaleString() : null
              }
            />
          </div>

          {/* Workflow Link */}
          {workflowId && runId && (
            <div className="rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Workflow className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {finding.shipsec?.workflow_name ?? 'Workflow'}
                </span>
              </div>
              <Link
                to={`/workflows/${workflowId}/runs/${runId}`}
                className="text-sm text-primary hover:underline mt-1 inline-block"
              >
                View Run
              </Link>
            </div>
          )}

          {/* Description */}
          {finding.description && (
            <div>
              <h4 className="text-sm font-medium mb-2">Description</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {finding.description}
              </p>
            </div>
          )}

          {/* Remediation */}
          {(finding.remediationText || finding.recommendationUrl) && (
            <div>
              <h4 className="text-sm font-medium mb-2">Remediation</h4>
              {finding.remediationText && (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap mb-2">
                  {finding.remediationText}
                </p>
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
          )}

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

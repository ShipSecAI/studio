import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, BarChart3, ShieldCheck, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FindingDetailSheet } from '@/components/security/FindingDetailSheet';
import { SeverityDonutChart } from './SeverityDonutChart';
import { SEVERITY_CONFIG, formatDuration, formatRelativeTime } from './scan-utils';
import { getStatusBadgeClassFromStatus } from '@/utils/statusBadgeStyles';
import { useExecutionRun } from '@/hooks/queries/useExecutionQueries';
import { normalizeRun } from '@/hooks/queries/useRunQueries';
import {
  CLOUD_SCAN_FINDINGS_LIMIT,
  useCloudScanFindings,
} from '@/hooks/queries/useCloudScanQueries';
import { useFindingLifecycle } from '@/hooks/queries/useSecurityQueries';
import type { SecurityFinding } from '@/lib/securityQueryHelpers';
import { cn } from '@/lib/utils';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
const LIVE_RUN_STATUSES = new Set(['QUEUED', 'RUNNING', 'AWAITING_INPUT']);

function PanelSkeleton() {
  return (
    <div className="p-5 space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-56" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-44 w-full rounded-lg" />
    </div>
  );
}

function SeveritySummaryCards({
  counts,
}: {
  counts: { critical: number; high: number; medium: number; low: number };
}) {
  const cards = [
    { label: 'Critical', count: counts.critical, severity: 'critical' },
    { label: 'High', count: counts.high, severity: 'high' },
    { label: 'Medium', count: counts.medium, severity: 'medium' },
    { label: 'Low', count: counts.low, severity: 'low' },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-2">
      {cards.map((card) => {
        const config = SEVERITY_CONFIG[card.severity];
        return (
          <Card key={card.label} className={`${config.bgClass} border-none`}>
            <CardContent className="p-2.5">
              <div className="space-y-1">
                <p className={cn('text-xs font-medium', config.textClass)}>{card.label}</p>
                <p className={cn('text-xl font-bold leading-none', config.textClass)}>
                  {card.count}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function getFindingTitle(finding: SecurityFinding): string {
  return finding.title ?? finding.check_name ?? finding.rule_id ?? 'Untitled finding';
}

export function CloudScanDetailPanel({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data: runData, isLoading: runLoading, error: runError } = useExecutionRun(runId);
  const {
    data: findingsData,
    isLoading: findingsLoading,
    error: findingsError,
  } = useCloudScanFindings(runId);
  const [selectedFinding, setSelectedFinding] = useState<SecurityFinding | null>(null);
  const selectedFindingHash = selectedFinding?.finding_hash ?? null;
  const { data: findingLifecycle = null, isLoading: findingLifecycleLoading } =
    useFindingLifecycle(selectedFindingHash);

  const run = useMemo(() => (runData ? normalizeRun(runData) : null), [runData]);
  const findings = findingsData?.findings ?? [];
  const severityCounts = findingsData?.severityCounts ?? {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  const groupedFindings = useMemo(() => {
    const groups: Record<string, SecurityFinding[]> = {
      critical: [],
      high: [],
      medium: [],
      low: [],
      info: [],
    };
    for (const finding of findings) {
      const severity = finding.severity.toLowerCase();
      if (severity in groups) {
        groups[severity].push(finding);
      } else {
        groups.info.push(finding);
      }
    }
    return groups;
  }, [findings]);

  const infoCount = Math.max(
    0,
    findings.length -
      (severityCounts.critical + severityCounts.high + severityCounts.medium + severityCounts.low),
  );
  const donutData = [
    { label: 'Critical', value: severityCounts.critical, color: SEVERITY_CONFIG.critical.color },
    { label: 'High', value: severityCounts.high, color: SEVERITY_CONFIG.high.color },
    { label: 'Medium', value: severityCounts.medium, color: SEVERITY_CONFIG.medium.color },
    { label: 'Low', value: severityCounts.low, color: SEVERITY_CONFIG.low.color },
    { label: 'Info', value: infoCount, color: SEVERITY_CONFIG.info.color },
  ];

  if (runLoading || findingsLoading) {
    return <PanelSkeleton />;
  }

  if (runError || !run) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Run Not Found</h3>
        <p className="text-muted-foreground mb-4">
          {runError instanceof Error ? runError.message : 'Could not load run details.'}
        </p>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  const runIsLive = LIVE_RUN_STATUSES.has(run.status);
  const duration = runIsLive
    ? formatDuration(run.startTime, new Date().toISOString())
    : formatDuration(run.startTime, run.endTime ?? null);
  const trigger = run.triggerLabel ?? run.triggerType;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="border-b px-5 py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold truncate">{run.workflowName}</h3>
              <Badge variant="outline" className={getStatusBadgeClassFromStatus(run.status)}>
                {run.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Trigger: {trigger} | Started {formatRelativeTime(run.startTime)}
              {duration ? ` | Duration ${duration}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button size="sm" variant="outline" asChild>
              <Link to={`/runs/${run.id}`}>Open Run</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose} className="-mr-2">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          {findingsError && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-300">
              {findingsError instanceof Error
                ? findingsError.message
                : 'Failed to load findings for this run.'}
            </div>
          )}

          <div className="flex items-center gap-2 text-sm font-medium">
            <BarChart3 className="h-4 w-4" />
            Findings Overview
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {findingsData?.total ?? findings.length}
            </Badge>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
            <SeveritySummaryCards counts={severityCounts} />
            <Card className="border bg-muted/20">
              <CardContent className="p-3 flex items-center justify-center">
                <SeverityDonutChart
                  data={donutData}
                  size={132}
                  strokeWidth={20}
                  showLegend={false}
                />
              </CardContent>
            </Card>
          </div>

          {findingsData?.isTruncated && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-3 text-sm text-amber-800 dark:text-amber-300">
              Showing {findings.length} of {findingsData.total} findings (limit{' '}
              {CLOUD_SCAN_FINDINGS_LIMIT}). Open Run for full details.
            </div>
          )}

          {findings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="rounded-full bg-green-100 dark:bg-green-950/30 p-3 mb-3">
                <ShieldCheck className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-lg font-medium mb-1">No Findings</h3>
              <p className="text-sm text-muted-foreground">
                {runIsLive
                  ? 'Scan is still in progress. Findings will appear here when complete.'
                  : 'No findings were detected for this run.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {SEVERITY_ORDER.map((severity) => {
                const severityFindings = groupedFindings[severity];
                if (!severityFindings || severityFindings.length === 0) return null;
                const config = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info;
                return (
                  <div key={severity} className="space-y-2">
                    <div className="text-sm font-medium">
                      <span className={config.textClass}>{config.label}</span>
                      <span className="text-muted-foreground"> ({severityFindings.length})</span>
                    </div>
                    <div className="space-y-2">
                      {severityFindings.map((finding) => (
                        <button
                          key={finding._id}
                          type="button"
                          onClick={() => setSelectedFinding(finding)}
                          className="w-full rounded-lg border p-3 text-left hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="space-y-1 min-w-0">
                              <div className="text-sm font-medium truncate">
                                {getFindingTitle(finding)}
                              </div>
                              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-1">
                                {finding.account_id && <span>Account {finding.account_id}</span>}
                                {finding.region && <span>Region {finding.region}</span>}
                                {finding.service_name && (
                                  <span>Service {finding.service_name}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <Badge className={`${config.badgeClass} border-none`}>
                                {config.label}
                              </Badge>
                              {finding.status && (
                                <Badge
                                  variant="outline"
                                  className={getStatusBadgeClassFromStatus(finding.status)}
                                >
                                  {finding.status}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <FindingDetailSheet
        finding={selectedFinding}
        open={selectedFinding !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedFinding(null);
        }}
        lifecycle={findingLifecycle}
        lifecycleLoading={findingLifecycleLoading}
      />
    </div>
  );
}

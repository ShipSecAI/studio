import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCode2,
  GitPullRequest,
  Link2,
  ShieldAlert,
} from 'lucide-react';
import { api, type SecurityFinding, type SecurityThreatStory } from '@/services/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const severityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
  unknown: 5,
};

const severityTone: Record<string, string> = {
  critical: 'bg-red-600 text-white border-red-600',
  high: 'bg-orange-500 text-white border-orange-500',
  medium: 'bg-amber-100 text-amber-900 border-amber-200',
  low: 'bg-blue-100 text-blue-900 border-blue-200',
  info: 'bg-slate-100 text-slate-800 border-slate-200',
};

function formatDate(value?: string | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString();
}

function statusLabel(finding: SecurityFinding) {
  if (finding.lifecycleHint === 'fixed_candidate' || finding.status === 'in_progress') {
    return 'Fix pending validation';
  }
  if (finding.status === 'false_positive') return 'False positive';
  if (finding.status === 'resolved') return 'Resolved';
  return 'Open';
}

function FindingStatusBadge({ finding }: { finding: SecurityFinding }) {
  const label = statusLabel(finding);
  const className =
    label === 'Open'
      ? 'border-red-200 bg-red-50 text-red-700'
      : label === 'Fix pending validation'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return (
    <Badge variant="outline" className={className}>
      {label}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const normalized = severity.toLowerCase();
  return (
    <Badge variant="outline" className={cn('capitalize', severityTone[normalized])}>
      {severity}
    </Badge>
  );
}

function highestSeverity(findings: SecurityFinding[]) {
  return findings
    .map((finding) => finding.severity.toLowerCase())
    .sort((a, b) => (severityOrder[a] ?? 5) - (severityOrder[b] ?? 5))[0];
}

function buildThreatGroups(findings: SecurityFinding[]) {
  const grouped = new Map<string, SecurityFinding[]>();
  const ungrouped: SecurityFinding[] = [];

  for (const finding of findings) {
    if (finding.threatRefs.length === 0) {
      ungrouped.push(finding);
      continue;
    }
    for (const threat of finding.threatRefs) {
      grouped.set(threat, [...(grouped.get(threat) ?? []), finding]);
    }
  }

  const groups = Array.from(grouped.entries()).map(([title, items]) => ({
    id: title,
    title,
    findings: items,
  }));

  if (ungrouped.length > 0) {
    groups.push({ id: '__ungrouped__', title: 'Unlinked findings', findings: ungrouped });
  }

  return groups.sort(
    (a, b) =>
      (severityOrder[highestSeverity(a.findings) ?? 'unknown'] ?? 5) -
      (severityOrder[highestSeverity(b.findings) ?? 'unknown'] ?? 5),
  );
}

function FindingRow({
  finding,
  active,
  onClick,
}: {
  finding: SecurityFinding;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full border text-left p-3 transition-colors hover:bg-muted/60',
        active ? 'border-primary bg-primary/5' : 'border-border bg-card',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <FindingStatusBadge finding={finding} />
            {finding.reviewMode === 'pr' && (
              <Badge variant="outline" className="gap-1">
                <GitPullRequest className="h-3 w-3" />
                PR {finding.prNumber ?? ''}
              </Badge>
            )}
          </div>
          <h3 className="mt-2 text-sm font-medium leading-snug">
            {finding.title ?? finding.findingKey}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground break-all">
            {finding.endpoint ?? finding.file ?? finding.asset?.displayName ?? finding.repository}
            {finding.line ? `:${finding.line}` : ''}
          </p>
        </div>
        <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </button>
  );
}

function FindingDetails({ finding }: { finding: SecurityFinding | null }) {
  if (!finding) {
    return (
      <Card className="h-full">
        <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Select a finding to inspect its evidence.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={finding.severity} />
          <FindingStatusBadge finding={finding} />
          <Badge variant="outline">{finding.sourceKind}</Badge>
        </div>
        <CardTitle className="pt-2 text-lg leading-snug">{finding.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase text-muted-foreground">Repository</div>
            <div className="font-medium">{finding.repository ?? 'Unknown'}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Location</div>
            <div className="break-all font-mono text-xs">
              {finding.endpoint ?? finding.file ?? finding.asset?.stableKey ?? finding.findingKey}
              {finding.line ? `:${finding.line}` : ''}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">First seen</div>
            <div>{formatDate(finding.firstSeenAt)}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-muted-foreground">Last updated</div>
            <div>{formatDate(finding.lastSeenAt)}</div>
          </div>
        </div>

        {finding.description && (
          <section>
            <h4 className="mb-1 text-sm font-medium">What is broken</h4>
            <p className="text-sm text-muted-foreground">{finding.description}</p>
          </section>
        )}

        {finding.impact && (
          <section>
            <h4 className="mb-1 text-sm font-medium">Impact</h4>
            <p className="text-sm text-muted-foreground">{finding.impact}</p>
          </section>
        )}

        {finding.fix && (
          <section>
            <h4 className="mb-1 text-sm font-medium">Resolution</h4>
            <p className="text-sm text-muted-foreground">{finding.fix}</p>
            {finding.verification && (
              <p className="mt-2 text-xs text-muted-foreground">
                Validation: {finding.verification}
              </p>
            )}
          </section>
        )}

        {finding.workflowId && finding.runId && (
          <Button variant="outline" size="sm" asChild>
            <Link to={`/workflows/${finding.workflowId}/runs/${finding.runId}`}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open agent run
            </Link>
          </Button>
        )}

        {finding.relatedLinks.length > 0 && (
          <>
            <Separator />
            <section>
              <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Link2 className="h-4 w-4" />
                Related findings
              </h4>
              <div className="space-y-2">
                {finding.relatedLinks.map((link) => (
                  <div key={link.id} className="border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{link.relationshipType.replaceAll('_', ' ')}</Badge>
                      <Badge variant="outline">{Math.round(link.confidence * 100)}%</Badge>
                    </div>
                    <div className="mt-2 font-medium">
                      {link.relatedFinding.title ?? link.relatedFinding.findingKey}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{link.rationale}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        <Separator />

        <section>
          <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Link2 className="h-4 w-4" />
            Evidence
          </h4>
          <div className="space-y-2">
            {finding.observations.map((observation) => (
              <div key={observation.id} className="border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{observation.reviewMode ?? 'run'}</Badge>
                  {observation.lifecycleHint && (
                    <Badge variant="outline">{observation.lifecycleHint}</Badge>
                  )}
                  {observation.prNumber && (
                    <Badge variant="outline">PR {observation.prNumber}</Badge>
                  )}
                </div>
                <div className="mt-2 font-medium">{observation.title}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDate(observation.observedAt)}
                </div>
              </div>
            ))}
            {finding.evidence.map((evidence) => (
              <div key={evidence.id} className="border p-3 text-xs text-muted-foreground">
                {evidence.summary ?? evidence.artifactUri}
              </div>
            ))}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function ThreatStoryCard({ story }: { story: SecurityThreatStory }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={story.severity} />
              <Badge variant="outline">{story.status}</Badge>
              <Badge variant="outline">{Math.round(story.confidence * 100)}%</Badge>
            </div>
            <CardTitle className="mt-3 text-base leading-snug">{story.title}</CardTitle>
          </div>
          <Badge variant="secondary">{story.findings.length} findings</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{story.summary}</p>
        <div>
          <h4 className="mb-1 text-sm font-medium">Impact</h4>
          <p className="text-sm text-muted-foreground">{story.impact}</p>
        </div>
        {story.attackPath && (
          <div>
            <h4 className="mb-1 text-sm font-medium">Attack path</h4>
            <p className="text-sm text-muted-foreground">{story.attackPath}</p>
          </div>
        )}
        {story.recommendedAction && (
          <div>
            <h4 className="mb-1 text-sm font-medium">Fix</h4>
            <p className="text-sm text-muted-foreground">{story.recommendedAction}</p>
          </div>
        )}
        <Separator />
        <div className="space-y-2">
          {story.findings.map((finding) => (
            <div key={finding.id} className="border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={finding.severity} />
                <Badge variant="outline">{finding.role}</Badge>
                <Badge variant="outline">{finding.sourceKind}</Badge>
              </div>
              <div className="mt-2 font-medium">{finding.title ?? finding.findingKey}</div>
              {finding.rationale && (
                <p className="mt-1 text-xs text-muted-foreground">{finding.rationale}</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function FindingsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['security-ingestion', 'findings'],
    queryFn: () => api.securityIngestion.findings({ limit: 100 }),
    refetchInterval: 20_000,
  });
  const {
    data: threatStoriesData,
    isLoading: threatStoriesLoading,
    error: threatStoriesError,
  } = useQuery({
    queryKey: ['security-ingestion', 'threat-stories'],
    queryFn: () => api.securityIngestion.threatStories({ limit: 50 }),
    refetchInterval: 20_000,
  });
  const findings = data?.findings ?? [];
  const threatStories = threatStoriesData?.stories ?? [];
  const groups = useMemo(() => buildThreatGroups(findings), [findings]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedFinding =
    findings.find((finding) => finding.id === selectedId) ?? findings[0] ?? null;
  const pendingFixCount = findings.filter(
    (finding) => statusLabel(finding) === 'Fix pending validation',
  ).length;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="h-4 w-4" />
                Durable security findings
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">What is broken</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Agent-written threat stories first, with raw scanner and code findings underneath as
                evidence you can inspect.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldAlert className="h-4 w-4" />
                    Stories
                  </div>
                  <div className="mt-1 text-2xl font-semibold">{threatStories.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    Findings
                  </div>
                  <div className="mt-1 text-2xl font-semibold">{findings.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4" />
                    Pending
                  </div>
                  <div className="mt-1 text-2xl font-semibold">{pendingFixCount}</div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          {threatStoriesLoading ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Loading threat stories...
              </CardContent>
            </Card>
          ) : threatStoriesError ? (
            <Card>
              <CardContent className="p-6 text-sm text-red-600">
                Failed to load threat stories.
              </CardContent>
            </Card>
          ) : threatStories.length > 0 ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Threat stories
                </h2>
                <Badge variant="outline">{threatStories.length}</Badge>
              </div>
              {threatStories.map((story) => (
                <ThreatStoryCard key={story.id} story={story} />
              ))}
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                Raw findings
              </h2>
              <Badge variant="outline">{findings.length}</Badge>
            </div>

            {isLoading ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Loading findings...
                </CardContent>
              </Card>
            ) : error ? (
              <Card>
                <CardContent className="p-6 text-sm text-red-600">
                  Failed to load security findings.
                </CardContent>
              </Card>
            ) : groups.length === 0 ? (
              <Card>
                <CardContent className="flex h-64 flex-col items-center justify-center text-center">
                  <FileCode2 className="mb-3 h-8 w-8 text-muted-foreground" />
                  <h2 className="text-base font-medium">No security findings yet</h2>
                  <p className="mt-1 max-w-md text-sm text-muted-foreground">
                    Run a cloud, attack-surface, Kubernetes, or agentic code review workflow and the
                    durable findings will appear here.
                  </p>
                </CardContent>
              </Card>
            ) : (
              groups.map((group) => (
                <Card key={group.id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle className="text-base">{group.title}</CardTitle>
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={highestSeverity(group.findings) ?? 'unknown'} />
                        <Badge variant="outline">{group.findings.length} findings</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {group.findings.map((finding) => (
                      <FindingRow
                        key={finding.id}
                        finding={finding}
                        active={selectedFinding?.id === finding.id}
                        onClick={() => setSelectedId(finding.id)}
                      />
                    ))}
                  </CardContent>
                </Card>
              ))
            )}
          </section>
        </div>

        <div className="lg:sticky lg:top-20 lg:self-start">
          <FindingDetails finding={selectedFinding} />
        </div>
      </main>
    </div>
  );
}

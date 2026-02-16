import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useGitHubStore } from '@/store/githubStore';
import { useScheduleStore } from '@/store/scheduleStore';
import { useIntegrationStore } from '@/store/integrationStore';
import { useSecurityDashboardStore } from '@/store/securityDashboardStore';
import { useSecurityViewStore } from '@/store/securityViewStore';
import { SecurityDashboardContent } from '@/pages/AwsSecurityDashboard';
import { api } from '@/services/api';
import { BUILT_IN_VIEWS } from '@/config/securityViews';
import { Clock } from 'lucide-react';

// Home components
import { HeroBanner } from '@/components/home/HeroBanner';
import { WhatYouWillUnlockSection } from '@/components/home/WhatYouWillUnlockSection';
import {
  GettingStartedChecklist,
  CHECKLIST_ICONS,
} from '@/components/home/GettingStartedChecklist';
import { QuickStatsRow } from '@/components/home/QuickStatsRow';
import { SecurityScoreRing } from '@/components/home/SecurityScoreRing';
import { NeedsAttentionCard } from '@/components/home/NeedsAttentionCard';
import { RecentActivityFeed } from '@/components/home/RecentActivityFeed';
import { CoverageDetailCard } from '@/components/home/CoverageDetailCard';
import { FindingsTrendChart } from '@/components/home/FindingsTrendChart';

/** Map scanner names to category key using the built-in view definitions */
const SCANNER_TO_CATEGORY: Record<string, string> = {};
for (const view of BUILT_IN_VIEWS) {
  if (view.id === 'home' || view.id === 'all-findings' || view.id === 'incidents') continue;
  const categoryKey = view.id;
  for (const scanner of view.baseFilter.scannerTerms ?? []) {
    SCANNER_TO_CATEGORY[scanner] = categoryKey;
  }
}

interface CategoryCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

const EMPTY_COUNTS: CategoryCounts = { critical: 0, high: 0, medium: 0, low: 0 };

type UserState = 'new' | 'partial' | 'complete';

export function HomePage() {
  const {
    installations,
    repositories,
    scanResults,
    triggerRules,
    fetchInstallations,
    fetchRepositories,
    fetchScanResults,
    fetchTriggerRules,
  } = useGitHubStore();
  const { schedules, fetchSchedules } = useScheduleStore();
  const { orgConnections, fetchOrgConnections } = useIntegrationStore();
  const fetchSummary = useSecurityDashboardStore((s) => s.fetchSummary);
  const activeViewId = useSecurityViewStore((s) => s.activeViewId);

  // Per-category severity counts from analytics
  const [categoryCounts, setCategoryCounts] = useState<Record<string, CategoryCounts>>({
    'cloud-security': { ...EMPTY_COUNTS },
    'code-security': { ...EMPTY_COUNTS },
    'dependency-security': { ...EMPTY_COUNTS },
  });

  useEffect(() => {
    fetchInstallations();
    fetchRepositories();
    fetchScanResults({ limit: 5 });
    fetchTriggerRules();
    fetchSchedules();
    fetchOrgConnections();
    fetchSummary();
  }, [
    fetchInstallations,
    fetchRepositories,
    fetchScanResults,
    fetchTriggerRules,
    fetchSchedules,
    fetchOrgConnections,
    fetchSummary,
  ]);

  // Fetch per-scanner severity breakdown for category grouping (all severities)
  useEffect(() => {
    let cancelled = false;
    api.analytics
      .query({
        query: { match_all: {} },
        size: 0,
        aggs: {
          by_scanner: {
            terms: { field: 'scanner.keyword', size: 20 },
            aggs: {
              by_severity: { terms: { field: 'severity.keyword' } },
            },
          },
        },
      })
      .then((result) => {
        if (cancelled) return;
        const counts: Record<string, CategoryCounts> = {
          'cloud-security': { ...EMPTY_COUNTS },
          'code-security': { ...EMPTY_COUNTS },
          'dependency-security': { ...EMPTY_COUNTS },
        };
        const scannerBuckets = result.aggregations?.by_scanner?.buckets ?? [];
        for (const bucket of scannerBuckets) {
          const category = SCANNER_TO_CATEGORY[bucket.key];
          if (!category || !counts[category]) continue;
          for (const sev of bucket.by_severity?.buckets ?? []) {
            const key = sev.key?.toLowerCase() as keyof CategoryCounts;
            if (key in EMPTY_COUNTS) {
              counts[category][key] += sev.doc_count;
            }
          }
        }
        setCategoryCounts(counts);
      })
      .catch(() => {
        // Silently ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Getting started checklist
  const checklist = useMemo(() => {
    const hasGitHub = installations.length > 0;
    const hasAws = orgConnections.some((c) => c.provider === 'aws');
    const hasScans = scanResults.length > 0;
    const hasTriggers = triggerRules.length > 0;
    return [
      {
        label: 'Connect GitHub',
        description: 'Link your repos',
        done: hasGitHub,
        href: '/integrations/github',
        icon: CHECKLIST_ICONS.github,
      },
      {
        label: 'Connect AWS',
        description: 'Audit your cloud',
        done: hasAws,
        href: '/integrations/aws',
        icon: CHECKLIST_ICONS.aws,
      },
      {
        label: 'Run first scan',
        description: 'Find vulnerabilities',
        done: hasScans,
        href: '/integrations/github',
        icon: CHECKLIST_ICONS.scan,
      },
      {
        label: 'Enable PR gate',
        description: 'Block risky PRs',
        done: hasTriggers,
        href: '/integrations/github?tab=triggers',
        icon: CHECKLIST_ICONS.prGate,
      },
      {
        label: 'Use a template',
        description: 'Quick start workflows',
        done: false,
        href: '/templates',
        icon: CHECKLIST_ICONS.template,
      },
    ];
  }, [installations, scanResults, triggerRules, orgConnections]);

  const completedCount = checklist.filter((s) => s.done).length;

  // DEV HACK: ?stage=new|partial|complete to force a specific onboarding state
  const [searchParams] = useSearchParams();
  const stageOverride = searchParams.get('stage') as UserState | null;

  // User state derivation
  const userState: UserState = useMemo(() => {
    if (stageOverride && ['new', 'partial', 'complete'].includes(stageOverride))
      return stageOverride;
    if (completedCount === 0) return 'new';
    if (completedCount >= 5) return 'complete';
    return 'partial';
  }, [completedCount, stageOverride]);

  // Derived stats — compute from our own independent query, not the shared dashboard store
  const totalFindings = useMemo(() => {
    let total = 0;
    for (const cat of Object.values(categoryCounts)) {
      total += cat.critical + cat.high + cat.medium + cat.low;
    }
    return total;
  }, [categoryCounts]);

  const integrationsConnected = useMemo(() => {
    return installations.length + orgConnections.length;
  }, [installations, orgConnections]);

  // Aggregate severity counts across all categories
  const allSeverityCounts = useMemo(() => {
    const totals = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const cat of Object.values(categoryCounts)) {
      totals.critical += cat.critical;
      totals.high += cat.high;
      totals.medium += cat.medium;
      totals.low += cat.low;
    }
    return totals;
  }, [categoryCounts]);

  // Security score: 100 minus deductions
  const securityScore = useMemo(() => {
    let score = 100;
    const totalRepos = repositories.length;
    const repoPatterns = new Set(triggerRules.map((r) => r.repositoryPattern));
    const hasWildcard = repoPatterns.has('*');
    const protectedRepos = hasWildcard
      ? totalRepos
      : repositories.filter((r) => repoPatterns.has(r.fullName)).length;
    const unprotectedRepos = totalRepos - protectedRepos;

    // Deduct for uncovered repos
    if (totalRepos > 0) {
      score -= Math.round((unprotectedRepos / totalRepos) * 30);
    }
    // Deduct for critical findings
    score -= Math.min(allSeverityCounts.critical * 5, 40);
    // Deduct for high findings
    score -= Math.min(allSeverityCounts.high * 2, 20);
    // Deduct if no integrations
    if (integrationsConnected === 0) score -= 10;

    return Math.max(0, Math.min(100, score));
  }, [repositories, triggerRules, allSeverityCounts, integrationsConnected]);

  // Attention categories for NeedsAttentionCard
  const attentionCategories = useMemo(() => {
    const cloud = categoryCounts['cloud-security'] ?? EMPTY_COUNTS;
    const code = categoryCounts['code-security'] ?? EMPTY_COUNTS;
    const dep = categoryCounts['dependency-security'] ?? EMPTY_COUNTS;
    return [
      {
        category: 'Cloud',
        critical: cloud.critical,
        high: cloud.high,
        href: '/?view=cloud-security',
      },
      { category: 'Code', critical: code.critical, high: code.high, href: '/?view=code-security' },
      {
        category: 'Dependencies',
        critical: dep.critical,
        high: dep.high,
        href: '/?view=dependency-security',
      },
    ];
  }, [categoryCounts]);

  // Upcoming schedules
  const upcomingSchedules = useMemo(() => {
    return schedules.filter((s) => s.status === 'active').slice(0, 3);
  }, [schedules]);

  // --- Home tab: adaptive layout ---
  if (activeViewId === 'home') {
    // ═══════════════════════════════════════════
    // STATE 1: New User (0/5 done)
    // ═══════════════════════════════════════════
    if (userState === 'new') {
      return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
          <HeroBanner />
          <GettingStartedChecklist
            checklist={checklist}
            completedCount={completedCount}
            mode="expanded"
          />
          <WhatYouWillUnlockSection />
        </div>
      );
    }

    // ═══════════════════════════════════════════
    // STATE 2: Partially Onboarded (1-4/5 done)
    // ═══════════════════════════════════════════
    if (userState === 'partial') {
      return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
          <QuickStatsRow
            totalFindings={totalFindings}
            totalRepos={repositories.length}
            totalScans={scanResults.length}
            integrationsConnected={integrationsConnected}
          />

          <GettingStartedChecklist
            checklist={checklist}
            completedCount={completedCount}
            mode="compact"
            defaultOpen={completedCount < 3}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <NeedsAttentionCard categories={attentionCategories} mode="normal" />
            </div>
            <RecentActivityFeed scanResults={scanResults} repositories={repositories} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <FindingsTrendChart />
            </div>
            <Card>
              <CardContent className="p-6 flex flex-col items-center justify-center h-full">
                <span className="text-sm text-muted-foreground mb-3">Security Score</span>
                <SecurityScoreRing score={securityScore} size={100} strokeWidth={8} />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <CoverageDetailCard repositories={repositories} triggerRules={triggerRules} />
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Upcoming Scans</CardTitle>
              </CardHeader>
              <CardContent>
                {upcomingSchedules.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No scheduled scans.</p>
                ) : (
                  <div className="space-y-2">
                    {upcomingSchedules.map((schedule) => (
                      <div key={schedule.id} className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{schedule.name}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {schedule.cronExpression}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      );
    }

    // ═══════════════════════════════════════════
    // STATE 3: Fully Onboarded (5/5 done)
    // ═══════════════════════════════════════════
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <QuickStatsRow
          totalFindings={totalFindings}
          totalRepos={repositories.length}
          totalScans={scanResults.length}
          integrationsConnected={integrationsConnected}
          securityScore={securityScore}
          showScore
        />

        <NeedsAttentionCard categories={attentionCategories} mode="prominent" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <FindingsTrendChart />
          </div>
          <RecentActivityFeed scanResults={scanResults} repositories={repositories} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <CoverageDetailCard repositories={repositories} triggerRules={triggerRules} />
          </div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Upcoming Scans</CardTitle>
            </CardHeader>
            <CardContent>
              {upcomingSchedules.length === 0 ? (
                <p className="text-sm text-muted-foreground">No scheduled scans.</p>
              ) : (
                <div className="space-y-2">
                  {upcomingSchedules.map((schedule) => (
                    <div key={schedule.id} className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="truncate">{schedule.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">
                        {schedule.cronExpression}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // --- Any other view: full Security Dashboard ---
  return <SecurityDashboardContent />;
}

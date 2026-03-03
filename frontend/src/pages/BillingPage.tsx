// @ts-nocheck
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, DollarSign, Zap, Workflow, Clock } from 'lucide-react';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';

interface BillingUsage {
  organizationId: string;
  subscriptionTier: string;
  plan: { id: string; displayName: string; priceUsdCents: number };
  period: { start: string; end: string };
  workflowRuns: { used: number; limit: number; remaining: number };
  ai: {
    spentUsd: number;
    budgetUsd: number;
    remainingUsd: number;
  };
  limits: {
    maxConcurrentRuns: number;
    maxWorkflows: number;
    analyticsRetentionDays: number;
  };
}

function formatLimit(value: number): string {
  if (value === -1) return 'Unlimited';
  return value.toLocaleString();
}

function getUsagePercentage(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min((used / limit) * 100, 100);
}

function getUsageColor(percentage: number): string {
  if (percentage >= 90) return 'text-destructive';
  if (percentage >= 75) return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}

function getProgressColor(percentage: number): string {
  if (percentage >= 90) return '[&>div]:bg-destructive';
  if (percentage >= 75) return '[&>div]:bg-amber-500';
  return '';
}

export function BillingPage() {
  const [usage, setUsage] = useState<BillingUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.billing
      .getUsage()
      .then(setUsage)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load billing data'),
      )
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex-1 bg-background">
        <div className="container mx-auto py-8 px-4 max-w-4xl">
          <h1 className="text-2xl font-semibold mb-8">Billing & Usage</h1>
          <div className="space-y-6">
            <div className="h-32 bg-muted animate-pulse rounded-lg" />
            <div className="h-48 bg-muted animate-pulse rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !usage) {
    return (
      <div className="flex-1 bg-background">
        <div className="container mx-auto py-8 px-4 max-w-4xl">
          <h1 className="text-2xl font-semibold mb-8">Billing & Usage</h1>
          <div className="rounded-md bg-destructive/10 p-4 text-destructive">
            {error || 'Failed to load billing data'}
          </div>
        </div>
      </div>
    );
  }

  const workflowPct = getUsagePercentage(usage.workflowRuns.used, usage.workflowRuns.limit);
  const aiPct = getUsagePercentage(usage.ai.spentUsd, usage.ai.budgetUsd);
  const isUnlimitedRuns = usage.workflowRuns.limit === -1;
  const isUnlimitedAi = usage.ai.budgetUsd === -1;

  return (
    <div className="flex-1 bg-background">
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Billing & Usage</h1>
            <p className="text-muted-foreground mt-1">
              Monitor your organization&apos;s usage and limits
            </p>
          </div>
          <Badge variant="secondary" className="text-sm px-3 py-1">
            {usage.plan.displayName} Plan
          </Badge>
        </div>

        {/* Period */}
        <p className="text-sm text-muted-foreground mb-6">
          Current period: {new Date(usage.period.start).toLocaleDateString()} &ndash;{' '}
          {new Date(usage.period.end).toLocaleDateString()}
        </p>

        {/* Usage Cards */}
        <div className="grid gap-6 md:grid-cols-2 mb-6">
          {/* Workflow Runs */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Workflow className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <CardTitle className="text-lg">Workflow Runs</CardTitle>
                  <CardDescription>Monthly execution count</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-bold">
                    {usage.workflowRuns.used.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground">
                    / {formatLimit(usage.workflowRuns.limit)}
                  </span>
                </div>
                {!isUnlimitedRuns && (
                  <>
                    <Progress
                      value={workflowPct}
                      className={cn('h-2', getProgressColor(workflowPct))}
                    />
                    <div className="flex items-center justify-between text-sm">
                      <span className={getUsageColor(workflowPct)}>
                        {workflowPct.toFixed(0)}% used
                      </span>
                      <span className="text-muted-foreground">
                        {formatLimit(usage.workflowRuns.remaining)} remaining
                      </span>
                    </div>
                  </>
                )}
                {!isUnlimitedRuns && workflowPct >= 90 && (
                  <Warning message="You're approaching your workflow run limit. Consider upgrading your plan." />
                )}
              </div>
            </CardContent>
          </Card>

          {/* AI Budget */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <DollarSign className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <CardTitle className="text-lg">AI Budget</CardTitle>
                  <CardDescription>Monthly AI spend limit</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-bold">${usage.ai.spentUsd.toFixed(2)}</span>
                  <span className="text-muted-foreground">
                    / {isUnlimitedAi ? 'Unlimited' : `$${usage.ai.budgetUsd.toFixed(2)}`}
                  </span>
                </div>
                {!isUnlimitedAi && (
                  <>
                    <Progress value={aiPct} className={cn('h-2', getProgressColor(aiPct))} />
                    <div className="flex items-center justify-between text-sm">
                      <span className={getUsageColor(aiPct)}>{aiPct.toFixed(0)}% used</span>
                      <span className="text-muted-foreground">
                        ${usage.ai.remainingUsd.toFixed(2)} remaining
                      </span>
                    </div>
                  </>
                )}
                {!isUnlimitedAi && aiPct >= 90 && (
                  <Warning message="You're approaching your AI budget limit. AI requests will be blocked when the budget is exhausted." />
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Plan Limits */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Plan Limits</CardTitle>
            <CardDescription>{usage.plan.displayName} tier resource limits</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <LimitItem
                icon={<Zap className="h-4 w-4" />}
                label="Max Concurrent Runs"
                value={formatLimit(usage.limits.maxConcurrentRuns)}
              />
              <LimitItem
                icon={<Workflow className="h-4 w-4" />}
                label="Max Workflows"
                value={formatLimit(usage.limits.maxWorkflows)}
              />
              <LimitItem
                icon={<Clock className="h-4 w-4" />}
                label="Analytics Retention"
                value={`${usage.limits.analyticsRetentionDays} days`}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function LimitItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2 rounded-lg bg-muted">{icon}</div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-bold">{value}</p>
      </div>
    </div>
  );
}

function Warning({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
      <p className="text-xs text-amber-600 dark:text-amber-400">{message}</p>
    </div>
  );
}

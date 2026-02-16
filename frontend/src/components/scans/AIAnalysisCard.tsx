import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles } from 'lucide-react';
import type { AIStats } from './ai-classification';

interface AIAnalysisCardProps {
  stats: AIStats;
}

export function AIAnalysisCard({ stats }: AIAnalysisCardProps) {
  const barWidth =
    stats.total > 0 ? Math.max(4, Math.round((stats.actionable / stats.total) * 100)) : 0;

  return (
    <Card className="border-purple-200 dark:border-purple-800/50 bg-purple-50/50 dark:bg-purple-950/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
          AI Impact
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats row */}
        <div className="flex items-center gap-4">
          <div className="text-sm">
            Raw findings: <span className="font-semibold">{stats.total}</span>
          </div>
          <span className="text-muted-foreground">→</span>
          <div className="text-sm">
            Actionable:{' '}
            <span className="font-semibold text-purple-700 dark:text-purple-400">
              {stats.actionable}
            </span>
          </div>
        </div>

        {/* Bar visualization */}
        <div className="space-y-1">
          <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-muted">
            <div
              className="bg-purple-600 dark:bg-purple-500 rounded-full transition-all"
              style={{ width: `${barWidth}%` }}
            />
            <div
              className="bg-muted-foreground/20 rounded-full transition-all"
              style={{ width: `${100 - barWidth}%` }}
            />
          </div>
          <div className="text-lg font-bold text-purple-700 dark:text-purple-400">
            Noise reduced: {stats.noiseReductionPercent}%
          </div>
        </div>

        {/* Breakdown */}
        <div className="space-y-1 text-sm text-muted-foreground">
          {stats.breakdown.testFiles > 0 && (
            <div>
              • {stats.breakdown.testFiles} in test/fixture files →{' '}
              <span className="italic">deprioritized</span>
            </div>
          )}
          {stats.breakdown.unverified > 0 && (
            <div>
              • {stats.breakdown.unverified} unverified secrets →{' '}
              <span className="italic">deprioritized</span>
            </div>
          )}
          {stats.breakdown.other > 0 && (
            <div>• {stats.breakdown.other} other deprioritized findings</div>
          )}
          <div className="font-medium text-foreground">
            • {stats.actionable} actionable findings → <span className="italic">shown below</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

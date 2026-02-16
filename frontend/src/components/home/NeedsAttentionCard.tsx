import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

interface AttentionCategory {
  category: string;
  critical: number;
  high: number;
  href: string;
}

interface NeedsAttentionCardProps {
  categories: AttentionCategory[];
  /** 'normal' = smaller card (State 2), 'prominent' = full-width with emphasis (State 3) */
  mode: 'normal' | 'prominent';
}

export function NeedsAttentionCard({ categories, mode }: NeedsAttentionCardProps) {
  const hasIssues = categories.some((c) => c.critical + c.high > 0);

  if (mode === 'prominent') {
    return (
      <Card className={hasIssues ? 'border-2 border-red-500/30 shadow-lg' : ''}>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className={`h-5 w-5 ${hasIssues ? 'text-red-500' : 'text-green-500'}`} />
            <CardTitle className="text-base">Needs Attention</CardTitle>
          </div>
          {hasIssues && (
            <Link to="/?view=all-findings" className="text-xs text-primary hover:underline">
              View all
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {!hasIssues ? (
            <div className="flex items-center gap-2 py-2">
              <ShieldCheck className="h-5 w-5 text-green-500" />
              <span className="text-sm text-muted-foreground">
                All clear! No critical or high findings.
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {categories.map((cat) => {
                const total = cat.critical + cat.high;
                if (total === 0) return null;
                return (
                  <Link
                    key={cat.category}
                    to={cat.href}
                    className="flex flex-col p-3 rounded-lg border border-red-500/10 bg-red-500/5 hover:bg-red-500/10 transition-colors"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      {cat.category}
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-red-500 text-sm font-medium">{cat.critical}c</span>
                      <span className="text-orange-500 text-sm font-medium">{cat.high}h</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Normal mode (State 2)
  return (
    <Card className={hasIssues ? 'border-orange-500/20' : ''}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Needs Attention</CardTitle>
        {hasIssues && (
          <Link to="/?view=all-findings" className="text-xs text-primary hover:underline">
            View all
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {!hasIssues ? (
          <div className="flex items-center gap-2 py-2">
            <ShieldCheck className="h-5 w-5 text-green-500" />
            <span className="text-xs text-muted-foreground">Looking good!</span>
          </div>
        ) : (
          <div className="space-y-2">
            {categories.map((cat) => {
              const total = cat.critical + cat.high;
              if (total === 0) return null;
              return (
                <Link
                  key={cat.category}
                  to={cat.href}
                  className="flex items-center justify-between text-xs hover:bg-muted/50 rounded p-1.5 -mx-1 transition-colors"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {cat.category}
                  </span>
                  <span>
                    <span className="text-red-500">{cat.critical}c</span>
                    {', '}
                    <span className="text-orange-500">{cat.high}h</span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

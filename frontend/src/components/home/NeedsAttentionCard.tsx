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
      <Card className={`h-full ${hasIssues ? 'border-destructive/25' : ''}`}>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert
              className={`h-5 w-5 ${hasIssues ? 'text-destructive' : 'text-muted-foreground'}`}
            />
            <CardTitle className="text-base">Needs Attention</CardTitle>
          </div>
          {hasIssues && (
            <Link to="/findings" className="text-xs text-primary hover:underline">
              Open Sentinel
            </Link>
          )}
        </CardHeader>
        <CardContent>
          {!hasIssues ? (
            <div className="flex items-center gap-2 py-2">
              <ShieldCheck className="h-5 w-5 text-success" />
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
                    className="flex flex-col rounded-lg border bg-muted/25 p-3 transition-[background-color,border-color] hover:border-destructive/25 hover:bg-muted/45"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      {cat.category}
                    </span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-destructive">{cat.critical}c</span>
                      <span className="text-sm font-medium text-warning">{cat.high}h</span>
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
    <Card className={`h-full ${hasIssues ? 'border-warning/25' : ''}`}>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Needs Attention</CardTitle>
        {hasIssues && (
          <Link to="/findings" className="text-xs text-primary hover:underline">
            Open Sentinel
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {!hasIssues ? (
          <div className="flex items-center gap-2 py-2">
            <ShieldCheck className="h-5 w-5 text-success" />
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
                    <span className="text-destructive">{cat.critical}c</span>
                    {', '}
                    <span className="text-warning">{cat.high}h</span>
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

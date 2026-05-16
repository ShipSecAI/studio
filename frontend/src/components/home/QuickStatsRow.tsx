import { Card, CardContent } from '@/components/ui/card';
import { ShieldAlert, GitBranch, Scan, Link2 } from 'lucide-react';
import { SecurityScoreRing } from './SecurityScoreRing';

interface QuickStatsRowProps {
  totalFindings: number;
  totalRepos: number;
  totalScans: number;
  integrationsConnected: number;
  securityScore?: number;
  showScore?: boolean;
}

const formatNumber = (n: number) => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
};

export function QuickStatsRow({
  totalFindings,
  totalRepos,
  totalScans,
  integrationsConnected,
  securityScore = 0,
  showScore = false,
}: QuickStatsRowProps) {
  const stats = [
    {
      label: 'Actionable Findings',
      value: totalFindings,
      icon: ShieldAlert,
    },
    {
      label: 'Repositories',
      value: totalRepos,
      icon: GitBranch,
    },
    { label: 'Scans', value: totalScans, icon: Scan },
    {
      label: 'Integrations',
      value: integrationsConnected,
      icon: Link2,
    },
  ];

  return (
    <div
      className={`grid gap-4 ${showScore ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}
    >
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border bg-muted/45 text-muted-foreground">
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <div className="text-xl font-semibold tabular-nums">{formatNumber(stat.value)}</div>
                <div className="text-[11px] text-muted-foreground">{stat.label}</div>
              </div>
            </CardContent>
          </Card>
        );
      })}
      {showScore && (
        <Card>
          <CardContent className="p-4 flex items-center justify-center">
            <SecurityScoreRing score={securityScore} size={64} strokeWidth={5} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

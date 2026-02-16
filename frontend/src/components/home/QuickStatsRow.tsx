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
      label: 'Findings',
      value: totalFindings,
      icon: ShieldAlert,
      color: 'text-red-500',
      bg: 'bg-red-500/10',
    },
    {
      label: 'Repositories',
      value: totalRepos,
      icon: GitBranch,
      color: 'text-purple-500',
      bg: 'bg-purple-500/10',
    },
    { label: 'Scans', value: totalScans, icon: Scan, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    {
      label: 'Integrations',
      value: integrationsConnected,
      icon: Link2,
      color: 'text-green-500',
      bg: 'bg-green-500/10',
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
              <div
                className={`w-9 h-9 rounded-lg ${stat.bg} flex items-center justify-center flex-shrink-0`}
              >
                <Icon className={`h-4.5 w-4.5 ${stat.color}`} />
              </div>
              <div className="min-w-0">
                <div className="text-xl font-bold">{formatNumber(stat.value)}</div>
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

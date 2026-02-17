import { useMemo, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SEVERITY_CONFIG, TIME_RANGES } from './constants';

const LazyAreaChart = lazy(() => import('recharts').then((m) => ({ default: m.AreaChart })));
const LazyArea = lazy(() => import('recharts').then((m) => ({ default: m.Area })));
const LazyXAxis = lazy(() => import('recharts').then((m) => ({ default: m.XAxis })));
const LazyYAxis = lazy(() => import('recharts').then((m) => ({ default: m.YAxis })));
const LazyTooltip = lazy(() => import('recharts').then((m) => ({ default: m.Tooltip })));
const LazyResponsiveContainer = lazy(() =>
  import('recharts').then((m) => ({ default: m.ResponsiveContainer })),
);

export function TimeSeriesChart({
  data,
  loading,
  timeRange,
  onTimeRangeChange,
}: {
  data: { date: string; critical: number; high: number; medium: number; low: number }[];
  loading: boolean;
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
}) {
  const chartData = useMemo(() => {
    const now = new Date();
    const range = TIME_RANGES.find((t) => t.key === timeRange);
    const days = range?.days ?? 30;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const formatOpts: Intl.DateTimeFormatOptions =
      days <= 1
        ? { hour: 'numeric', minute: '2-digit' }
        : days <= 7
          ? { month: 'short', day: 'numeric', hour: 'numeric' }
          : { month: 'short', day: 'numeric' };

    return data
      .filter((d) => new Date(d.date) >= cutoff)
      .map((d) => ({
        ...d,
        date: new Intl.DateTimeFormat('en-US', formatOpts).format(new Date(d.date)),
      }));
  }, [data, timeRange]);

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium">Findings Over Time</h3>
        <div className="flex gap-1">
          {TIME_RANGES.map((tr) => (
            <Button
              key={tr.key}
              variant={timeRange === tr.key ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onTimeRangeChange(tr.key)}
            >
              {tr.label}
            </Button>
          ))}
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
          No data for selected period
        </div>
      ) : (
        <Suspense fallback={<Skeleton className="h-48 w-full" />}>
          <LazyResponsiveContainer width="100%" height={192}>
            <LazyAreaChart data={chartData}>
              <LazyXAxis dataKey="date" tick={{ fontSize: 11 }} />
              <LazyYAxis tick={{ fontSize: 11 }} />
              <LazyTooltip />
              {SEVERITY_CONFIG.map((sev) => (
                <LazyArea
                  key={sev.key}
                  type="monotone"
                  dataKey={sev.key}
                  stackId="1"
                  stroke={sev.chartColor}
                  fill={sev.chartColor}
                  fillOpacity={0.6}
                />
              )).reverse()}
            </LazyAreaChart>
          </LazyResponsiveContainer>
        </Suspense>
      )}
    </div>
  );
}

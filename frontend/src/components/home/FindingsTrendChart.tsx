import { lazy, Suspense, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSecurityDashboardStore } from '@/store/securityDashboardStore';

const LazyChart = lazy(() =>
  import('./FindingsTrendChartInner').then((m) => ({ default: m.FindingsTrendChartInner })),
);

export function FindingsTrendChart() {
  const timeSeries = useSecurityDashboardStore((s) => s.timeSeries);
  const timeSeriesLoading = useSecurityDashboardStore((s) => s.timeSeriesLoading);
  const fetchTimeSeries = useSecurityDashboardStore((s) => s.fetchTimeSeries);

  useEffect(() => {
    fetchTimeSeries(undefined, 'day');
  }, [fetchTimeSeries]);

  // Only show last 7 days
  const last7Days = timeSeries.slice(-7);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Findings Trend (7d)</CardTitle>
      </CardHeader>
      <CardContent>
        {timeSeriesLoading ? (
          <div className="h-40 flex items-center justify-center">
            <span className="text-xs text-muted-foreground">Loading...</span>
          </div>
        ) : last7Days.length === 0 ? (
          <div className="h-40 flex items-center justify-center">
            <span className="text-xs text-muted-foreground">No data yet.</span>
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="h-40 flex items-center justify-center">
                <span className="text-xs text-muted-foreground">Loading chart...</span>
              </div>
            }
          >
            <LazyChart data={last7Days} />
          </Suspense>
        )}
      </CardContent>
    </Card>
  );
}

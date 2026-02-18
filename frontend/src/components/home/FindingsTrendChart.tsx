import { lazy, Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSecurityTimeSeries } from '@/hooks/queries/useSecurityQueries';
import { INITIAL_FILTERS } from '@/lib/securityQueryHelpers';

const LazyChart = lazy(() =>
  import('./FindingsTrendChartInner').then((m) => ({ default: m.FindingsTrendChartInner })),
);

export function FindingsTrendChart() {
  // Fetch time series with empty filters (all findings) for the home page trend
  const { data: timeSeries = [], isLoading: timeSeriesLoading } = useSecurityTimeSeries(
    INITIAL_FILTERS,
    {},
    'day',
  );

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

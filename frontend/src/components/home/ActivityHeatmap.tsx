import { useState, useMemo, Fragment } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRunActivity } from '@/hooks/queries/useRunQueries';
import { useSecurityTimeSeriesForHeatmap } from '@/hooks/queries/useSecurityQueries';
import { Skeleton } from '@/components/ui/skeleton';

type Mode = 'findings' | 'scans';

const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''] as const;

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const EMPTY_CELL = 'bg-[#ebedf0] dark:bg-[#161b22]';

const FINDINGS_COLORS = [
  EMPTY_CELL,
  'bg-orange-200 dark:bg-orange-900/40',
  'bg-orange-400 dark:bg-orange-700/60',
  'bg-red-500 dark:bg-red-700/70',
  'bg-red-700 dark:bg-red-500',
] as const;

const SCANS_COLORS = [
  EMPTY_CELL,
  'bg-green-200 dark:bg-green-900/40',
  'bg-green-400 dark:bg-green-700/60',
  'bg-green-600 dark:bg-green-600/70',
  'bg-green-800 dark:bg-green-400',
] as const;

function toUTCDateString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function getColorIndex(value: number, thresholds: number[]): number {
  if (value === 0) return 0;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (value >= thresholds[i]) return i + 1;
  }
  return 1;
}

function computeThresholds(values: number[]): number[] {
  const nonZero = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (nonZero.length === 0) return [1, 2, 3, 4];
  const q1 = nonZero[Math.floor(nonZero.length * 0.25)] ?? 1;
  const q2 = nonZero[Math.floor(nonZero.length * 0.5)] ?? 2;
  const q3 = nonZero[Math.floor(nonZero.length * 0.75)] ?? 3;
  const q4 = nonZero[nonZero.length - 1] ?? 4;
  // Ensure thresholds are strictly increasing
  return [Math.max(1, q1), Math.max(q1 + 1, q2), Math.max(q2 + 1, q3), Math.max(q3 + 1, q4)];
}

export function ActivityHeatmap() {
  const [mode, setMode] = useState<Mode>('findings');

  const { data: scanData, isLoading: scansLoading } = useRunActivity(365);
  const { data: findingsData = [], isLoading: findingsLoading } =
    useSecurityTimeSeriesForHeatmap(365);

  const isLoading = mode === 'findings' ? findingsLoading : scansLoading;

  // Build date → value maps
  const { findingsMap, scansMap } = useMemo(() => {
    const fMap = new Map<
      string,
      { total: number; critical: number; high: number; medium: number; low: number }
    >();
    for (const bucket of findingsData) {
      const dateStr = bucket.date.slice(0, 10); // YYYY-MM-DD
      const critical = bucket.critical ?? 0;
      const high = bucket.high ?? 0;
      const medium = bucket.medium ?? 0;
      const low = bucket.low ?? 0;
      const score = critical * 10 + high * 5 + medium * 2 + low * 1;
      fMap.set(dateStr, { total: score, critical, high, medium, low });
    }

    const sMap = new Map<string, number>();
    for (const entry of scanData?.activity ?? []) {
      if (!entry.date) continue;
      // Handle both date string and Date object formats
      const dateStr =
        typeof entry.date === 'string'
          ? entry.date.slice(0, 10)
          : toUTCDateString(new Date(entry.date));
      sMap.set(dateStr, entry.count ?? 0);
    }

    return { findingsMap: fMap, scansMap: sMap };
  }, [findingsData, scanData]);

  // Generate 365-day grid cells aligned to weeks
  const { cells, monthLabels, totalValue } = useMemo(() => {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - 364);

    // Align to start of week (Sunday)
    const dayOfWeek = startDate.getUTCDay();
    startDate.setUTCDate(startDate.getUTCDate() - dayOfWeek);

    const gridCells: {
      date: string;
      value: number;
      dayOfWeek: number;
      weekIndex: number;
      tooltip: string;
    }[] = [];
    const months: { label: string; weekIndex: number }[] = [];
    let lastMonth = -1;
    let total = 0;

    const current = new Date(startDate);
    let weekIndex = 0;

    while (current <= today || current.getUTCDay() !== 0) {
      if (current.getUTCDay() === 0 && current > startDate) weekIndex++;

      const dateStr = toUTCDateString(current);
      const isInRange = current >= startDate && current <= today;

      let value = 0;
      let tooltip = '';
      const formattedDate = `${MONTH_NAMES[current.getUTCMonth()]} ${current.getUTCDate()}`;

      if (isInRange) {
        if (mode === 'findings') {
          const entry = findingsMap.get(dateStr);
          value = entry?.total ?? 0;
          if (entry && value > 0) {
            const parts: string[] = [];
            if (entry.critical > 0) parts.push(`${entry.critical} critical`);
            if (entry.high > 0) parts.push(`${entry.high} high`);
            if (entry.medium > 0) parts.push(`${entry.medium} medium`);
            if (entry.low > 0) parts.push(`${entry.low} low`);
            tooltip = `${formattedDate}: ${parts.join(', ')}`;
          } else {
            tooltip = `${formattedDate}: No findings`;
          }
        } else {
          value = scansMap.get(dateStr) ?? 0;
          tooltip = `${formattedDate}: ${value} scan${value !== 1 ? 's' : ''}`;
        }
        total +=
          mode === 'findings'
            ? (findingsMap.get(dateStr)?.critical ?? 0) +
              (findingsMap.get(dateStr)?.high ?? 0) +
              (findingsMap.get(dateStr)?.medium ?? 0) +
              (findingsMap.get(dateStr)?.low ?? 0)
            : value;
      }

      // Track month labels
      const month = current.getUTCMonth();
      if (month !== lastMonth && current.getUTCDay() === 0) {
        months.push({ label: MONTH_NAMES[month], weekIndex });
        lastMonth = month;
      }

      gridCells.push({
        date: dateStr,
        value: isInRange ? value : -1, // -1 = out of range
        dayOfWeek: current.getUTCDay(),
        weekIndex,
        tooltip,
      });

      current.setUTCDate(current.getUTCDate() + 1);
      if (current > today && current.getUTCDay() === 0) break;
    }

    // Drop the first month label if it duplicates the last (year wrap-around)
    if (months.length >= 2 && months[0].label === months[months.length - 1].label) {
      months.shift();
    }

    return { cells: gridCells, monthLabels: months, totalValue: total };
  }, [mode, findingsMap, scansMap]);

  const totalWeeks = Math.max(1, ...cells.map((c) => c.weekIndex)) + 1;
  const colors = mode === 'findings' ? FINDINGS_COLORS : SCANS_COLORS;
  const thresholds = useMemo(
    () => computeThresholds(cells.filter((c) => c.value > 0).map((c) => c.value)),
    [cells],
  );

  // Aggregate severity totals across the 90-day window
  const severityTotals = useMemo(() => {
    let critical = 0,
      high = 0,
      medium = 0,
      low = 0;
    for (const entry of findingsMap.values()) {
      critical += entry.critical;
      high += entry.high;
      medium += entry.medium;
      low += entry.low;
    }
    return { critical, high, medium, low };
  }, [findingsMap]);

  // Scans stats
  const scansStats = useMemo(() => {
    const values = [...scansMap.values()];
    const peak = values.length > 0 ? Math.max(...values) : 0;
    const activeDays = values.filter((v) => v > 0).length;
    return { peak, activeDays, total: scanData?.totalRuns ?? 0 };
  }, [scansMap, scanData]);

  const headerText =
    mode === 'findings'
      ? `${totalValue} finding${totalValue !== 1 ? 's' : ''} in the last year`
      : `${scansStats.total} scan${scansStats.total !== 1 ? 's' : ''} in the last year`;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Activity</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{headerText}</p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border p-0.5">
            <button
              onClick={() => setMode('findings')}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                mode === 'findings'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Findings
            </button>
            <button
              onClick={() => setMode('scans')}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                mode === 'scans'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Scans
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isLoading ? (
          <Skeleton className="h-[120px] w-full rounded-md" />
        ) : (
          <TooltipProvider delayDuration={100}>
            <div className="min-w-0">
              {/* Month labels */}
              <div
                className="grid gap-[2px] mb-1"
                style={{
                  gridTemplateColumns: `24px repeat(${totalWeeks}, minmax(0, 1fr))`,
                }}
              >
                <div /> {/* Spacer for day labels */}
                {Array.from({ length: totalWeeks }, (_, i) => {
                  const monthLabel = monthLabels.find((m) => m.weekIndex === i);
                  return (
                    <div
                      key={i}
                      className="text-[10px] text-muted-foreground leading-none overflow-visible whitespace-nowrap"
                    >
                      {monthLabel?.label ?? ''}
                    </div>
                  );
                })}
              </div>

              {/* Heatmap grid: 7 rows (days) x N columns (weeks) */}
              <div
                className="grid gap-[2px]"
                style={{
                  gridTemplateColumns: `24px repeat(${totalWeeks}, minmax(0, 1fr))`,
                  gridTemplateRows: 'repeat(7, 12px)',
                }}
              >
                {Array.from({ length: 7 }, (_, dayIndex) => (
                  <Fragment key={`day-${dayIndex}`}>
                    {/* Day label */}
                    <div className="text-[10px] text-muted-foreground flex items-center">
                      {DAY_LABELS[dayIndex]}
                    </div>

                    {/* Cells for this day across all weeks */}
                    {Array.from({ length: totalWeeks }, (_, weekIdx) => {
                      const cell = cells.find(
                        (c) => c.dayOfWeek === dayIndex && c.weekIndex === weekIdx,
                      );

                      if (!cell || cell.value === -1) {
                        return <div key={`${dayIndex}-${weekIdx}`} className="rounded-sm" />;
                      }

                      const colorIdx = getColorIndex(cell.value, thresholds);

                      return (
                        <Tooltip key={`${dayIndex}-${weekIdx}`}>
                          <TooltipTrigger asChild>
                            <div
                              className={`rounded-sm ${colors[colorIdx]} cursor-default transition-colors`}
                            />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            {cell.tooltip}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </Fragment>
                ))}
              </div>

              {/* Legend */}
              <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-muted-foreground">
                <span>Less</span>
                {colors.map((color, i) => (
                  <div key={i} className={`w-3 h-3 rounded-sm ${color}`} />
                ))}
                <span>More</span>
              </div>
            </div>
          </TooltipProvider>
        )}

        {/* Stats summary */}
        {!isLoading && (
          <div className="border-t pt-4">
            {mode === 'findings' ? (
              <div className="grid grid-cols-4 gap-3">
                {[
                  {
                    label: 'Critical',
                    value: severityTotals.critical,
                    color: 'text-red-600 dark:text-red-400',
                  },
                  { label: 'High', value: severityTotals.high, color: 'text-orange-500' },
                  { label: 'Medium', value: severityTotals.medium, color: 'text-yellow-500' },
                  { label: 'Low', value: severityTotals.low, color: 'text-blue-500' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className={`text-xl font-semibold ${color}`}>{value}</span>
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Total Scans', value: scansStats.total },
                  { label: 'Active Days', value: scansStats.activeDays },
                  { label: 'Peak Day', value: scansStats.peak },
                ].map(({ label, value }) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-xl font-semibold text-foreground">{value}</span>
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

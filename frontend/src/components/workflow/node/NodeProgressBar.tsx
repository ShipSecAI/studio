import { cn } from '@/lib/utils';
import type { NodeProgressBarProps } from './types';

/**
 * Progress bar component showing execution progress and event counts
 */
export function NodeProgressBar({
  progress,
  events,
  totalEvents,
  isRunning,
  status,
}: NodeProgressBarProps) {
  const clampPercent = (value?: number) => {
    if (!Number.isFinite(value)) return undefined;
    return Math.max(0, Math.min(value!, 100));
  };

  const normalizedProgress = clampPercent(progress);
  const normalizedFromEvents =
    totalEvents > 0 && Number.isFinite(events) && Number.isFinite(totalEvents)
      ? clampPercent((events / totalEvents) * 100)
      : undefined;
  const fallbackWidth = isRunning ? 5 : 0;

  // Calculate width - prefer normalizedFromEvents for accurate event-based progress
  let calculatedWidth: number;
  if (status === 'success') {
    calculatedWidth = 100;
  } else if (normalizedFromEvents !== undefined && Number.isFinite(normalizedFromEvents)) {
    calculatedWidth = normalizedFromEvents;
  } else if (normalizedProgress !== undefined && Number.isFinite(normalizedProgress)) {
    calculatedWidth = normalizedProgress;
  } else if (totalEvents > 0 && events > 0) {
    calculatedWidth = Math.min(100, (events / totalEvents) * 100);
  } else {
    calculatedWidth = fallbackWidth;
  }

  const width = Number.isFinite(calculatedWidth) ? Math.max(0, Math.min(100, calculatedWidth)) : 0;

  const eventLabel =
    totalEvents > 0
      ? `${events}/${totalEvents} events`
      : `${events} ${events === 1 ? 'event' : 'events'}`;

  // Determine bar color based on status
  const getBarColor = () => {
    if (status === 'success') {
      return 'bg-green-500';
    }
    if (status === 'error') {
      return 'bg-red-600';
    }
    if (isRunning) {
      return 'bg-blue-500 animate-pulse';
    }
    return 'bg-blue-500';
  };

  const widthStyle = `${width}%`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Events observed</span>
        <span>{eventLabel}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden relative">
        <div
          className={cn(
            'absolute left-0 top-0 h-full rounded-full transition-all duration-500',
            getBarColor(),
          )}
          style={{
            width: widthStyle,
            minWidth: width > 0 ? '2px' : '0px',
          }}
        />
      </div>
    </div>
  );
}

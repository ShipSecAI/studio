import { cn } from '@/lib/utils';

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface SeverityDonutChartProps {
  data: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  className?: string;
  showLegend?: boolean;
}

export function SeverityDonutChart({
  data,
  size = 180,
  strokeWidth = 28,
  className,
  showLegend = true,
}: SeverityDonutChartProps) {
  const filtered = data.filter((d) => d.value > 0);
  const total = filtered.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) {
    return (
      <div className={cn('flex flex-col items-center gap-3', className)}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={(size - strokeWidth) / 2}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/30"
          />
          <text
            x={size / 2}
            y={size / 2}
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-muted-foreground text-sm"
          >
            No findings
          </text>
        </svg>
      </div>
    );
  }

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Build segments
  let cumulativeOffset = 0;
  const segments = filtered.map((segment) => {
    const segmentLength = (segment.value / total) * circumference;
    const gap = filtered.length > 1 ? 3 : 0; // gap between segments
    const dashArray = `${Math.max(0, segmentLength - gap)} ${circumference}`;
    const dashOffset = -cumulativeOffset;
    cumulativeOffset += segmentLength;

    return {
      ...segment,
      dashArray,
      dashOffset,
    };
  });

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      <div className="relative">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90"
        >
          {/* Background ring */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted/20"
          />
          {/* Segments */}
          {segments.map((segment, i) => (
            <circle
              key={segment.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeDasharray={segment.dashArray}
              strokeDashoffset={segment.dashOffset}
              strokeLinecap="round"
              className="transition-all duration-700 ease-out"
              style={{
                animationDelay: `${i * 100}ms`,
              }}
            />
          ))}
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold">{total}</span>
          <span className="text-xs text-muted-foreground">
            {total === 1 ? 'finding' : 'findings'}
          </span>
        </div>
      </div>

      {showLegend && (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          {filtered.map((segment) => (
            <div key={segment.label} className="flex items-center gap-1.5 text-xs">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: segment.color }}
              />
              <span className="text-muted-foreground">{segment.label}</span>
              <span className="font-medium">{segment.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

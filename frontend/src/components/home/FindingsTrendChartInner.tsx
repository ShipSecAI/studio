import type { ReactNode } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface TrendData {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface FindingsTrendChartInnerProps {
  data: TrendData[];
}

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const formatLabel = (label: ReactNode) => {
  if (typeof label === 'string') return formatDate(label);
  return String(label);
};

// Only render a dot when the value is non-zero
const makeDot = (color: string) => (props: Record<string, unknown>) => {
  const value = props.value as number;
  if (value === 0 || value == null)
    return (
      <circle
        key={`dot-${props.cx}-${props.cy}`}
        cx={props.cx as number}
        cy={props.cy as number}
        r={0}
      />
    );
  return (
    <circle
      key={`dot-${props.cx}-${props.cy}`}
      cx={props.cx as number}
      cy={props.cy as number}
      r={3}
      fill={color}
      stroke="white"
      strokeWidth={1}
    />
  );
};

const SERIES = [
  { key: 'low', stroke: '#22c55e', fillOpacity: 0.12 },
  { key: 'medium', stroke: '#f59e0b', fillOpacity: 0.15 },
  { key: 'high', stroke: '#8b5cf6', fillOpacity: 0.18 },
  { key: 'critical', stroke: '#dc2626', fillOpacity: 0.2 },
] as const;

export function FindingsTrendChartInner({ data }: FindingsTrendChartInnerProps) {
  // Only render a series if it has at least one non-zero data point
  const activeSeries = SERIES.filter((s) => data.some((d) => (d[s.key] ?? 0) > 0));

  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 16 }}>
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            className="text-muted-foreground"
            label={{ value: 'Date', position: 'insideBottom', offset: -10, fontSize: 10 }}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            className="text-muted-foreground"
            label={{
              value: 'Findings',
              angle: -90,
              position: 'insideLeft',
              offset: 10,
              fontSize: 10,
            }}
            width={45}
          />
          <Tooltip
            labelFormatter={formatLabel}
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize: '11px',
            }}
          />
          {activeSeries.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.stroke}
              fill={s.stroke}
              fillOpacity={s.fillOpacity}
              dot={makeDot(s.stroke)}
              activeDot={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

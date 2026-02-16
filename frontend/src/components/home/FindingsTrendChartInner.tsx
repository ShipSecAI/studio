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

export function FindingsTrendChartInner({ data }: FindingsTrendChartInnerProps) {
  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            className="text-muted-foreground"
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            className="text-muted-foreground"
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
          <Area
            type="monotone"
            dataKey="critical"
            stackId="1"
            stroke="#dc2626"
            fill="#dc2626"
            fillOpacity={0.6}
          />
          <Area
            type="monotone"
            dataKey="high"
            stackId="1"
            stroke="#ea580c"
            fill="#ea580c"
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="medium"
            stackId="1"
            stroke="#ca8a04"
            fill="#ca8a04"
            fillOpacity={0.4}
          />
          <Area
            type="monotone"
            dataKey="low"
            stackId="1"
            stroke="#2563eb"
            fill="#2563eb"
            fillOpacity={0.3}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

'use client';

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface SparklineProps {
  readonly data: ReadonlyArray<{ readonly x: number | string; readonly y: number }>;
  readonly height?: number;
  readonly tone?: 'amber' | 'green' | 'red';
  readonly tooltipFormatter?: (value: number) => string;
  readonly showAxes?: boolean;
}

const TONE_TO_COLOR: Record<NonNullable<SparklineProps['tone']>, string> = {
  amber: 'hsl(var(--warning))',
  green: 'hsl(var(--success))',
  red: 'hsl(var(--destructive))',
};

/**
 * Tiny area chart used in cards. Tokens map to the design-system CSS
 * variables so no hex literals leak into screens.
 */
export function Sparkline({
  data,
  height = 64,
  tone = 'amber',
  tooltipFormatter,
  showAxes = false,
}: SparklineProps) {
  const color = TONE_TO_COLOR[tone];
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...data]} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${tone}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showAxes ? <XAxis dataKey="x" hide /> : null}
          {showAxes ? <YAxis hide /> : null}
          <Tooltip
            cursor={{ stroke: color, strokeOpacity: 0.4 }}
            contentStyle={{
              background: 'hsl(var(--surface))',
              border: '1px solid hsl(var(--border))',
              fontSize: 11,
            }}
            formatter={(value: number) =>
              tooltipFormatter ? tooltipFormatter(value) : value
            }
          />
          <Area
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#spark-${tone})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

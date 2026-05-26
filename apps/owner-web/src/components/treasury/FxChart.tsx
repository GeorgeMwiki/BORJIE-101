'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';
// TODO(api-gateway): no live FX/gold series endpoint yet. Once the
// gateway exposes `/api/v1/mining/cockpit/fx-history` (or similar),
// swap this import for a TanStack Query fetcher with mock fallback.
import { FX_HISTORY } from '@/lib/mocks/treasury';

const TZS_COLOR = 'hsl(var(--warning))';
const GOLD_COLOR = 'hsl(var(--success))';

export function FxChart() {
  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">
        Live FX & gold · 30 days
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={[...FX_HISTORY]} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.4} vertical={false} />
            <XAxis
              dataKey="day"
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
            />
            <YAxis
              yAxisId="tzs"
              stroke={TZS_COLOR}
              fontSize={10}
              tickLine={false}
              domain={['auto', 'auto']}
            />
            <YAxis
              yAxisId="gold"
              orientation="right"
              stroke={GOLD_COLOR}
              fontSize={10}
              tickLine={false}
              domain={['auto', 'auto']}
            />
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--surface))',
                border: '1px solid hsl(var(--border))',
                fontSize: 11,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              yAxisId="tzs"
              type="monotone"
              dataKey="tzsUsd"
              name="TZS / USD"
              stroke={TZS_COLOR}
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              yAxisId="gold"
              type="monotone"
              dataKey="goldUsdOz"
              name="Gold USD / oz"
              stroke={GOLD_COLOR}
              strokeWidth={1.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

'use client';

/**
 * ChartElement — bar / line / donut renderer over recharts.
 *
 * Recharts is already a dependency (used by cockpit panels and the
 * Sparkline shared component) so we get full chart rendering with
 * zero added bundle cost. Color band maps Borjie's design tokens
 * onto a hex palette known to recharts.
 */

import type { ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { z } from 'zod';
import type { boardElementSchema, Bilingual } from '../types';

type ChartPayload = Extract<z.infer<typeof boardElementSchema>, { type: 'chart' }>;
type SeriesColor = NonNullable<ChartPayload['series'][number]['color']>;

const COLOR_HEX: Record<SeriesColor, string> = {
  gold: '#FFC857',
  success: '#2EBD85',
  warning: '#F5B23E',
  danger: '#E14B4B',
  info: '#5BA9F2',
};

function pick(b: Bilingual, lang: 'sw' | 'en'): string {
  return lang === 'sw' ? b.sw : b.en;
}

export interface ChartElementProps {
  readonly payload: ChartPayload;
  readonly languagePreference: 'sw' | 'en';
}

export function ChartElement({ payload, languagePreference }: ChartElementProps): ReactElement {
  const title = pick(payload.title, languagePreference);
  const height = payload.height ?? 220;

  return (
    <article
      data-testid="board-element-chart"
      data-chart-kind={payload.kind}
      data-element-id={payload.id}
      className="rounded-xl border border-border bg-surface/60 px-4 py-3"
    >
      <p className="mb-2 text-tiny font-semibold uppercase tracking-wide text-warning">
        {title}
      </p>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          {payload.kind === 'bar' ? (
            <BarChartView payload={payload} />
          ) : payload.kind === 'line' ? (
            <LineChartView payload={payload} />
          ) : (
            <DonutChartView payload={payload} />
          )}
        </ResponsiveContainer>
      </div>
    </article>
  );
}

// ─── Bar ────────────────────────────────────────────────────────────

function BarChartView({ payload }: { readonly payload: ChartPayload }): ReactElement {
  // Pivot series into a recharts-friendly per-x row.
  const xKeys = new Set<string>();
  for (const s of payload.series) for (const p of s.points) xKeys.add(p.x);
  const rows = Array.from(xKeys).map((x) => {
    const row: Record<string, string | number> = { x };
    for (const s of payload.series) {
      const found = s.points.find((p) => p.x === x);
      row[s.name] = found?.y ?? 0;
    }
    return row;
  });
  return (
    <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.6)" />
      <XAxis dataKey="x" stroke="hsl(var(--muted-foreground))" fontSize={11} />
      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
      <Tooltip
        contentStyle={{
          background: 'hsl(var(--surface))',
          border: '1px solid hsl(var(--border))',
          fontSize: 12,
        }}
      />
      {payload.series.map((s) => (
        <Bar key={s.name} dataKey={s.name} fill={COLOR_HEX[s.color ?? 'gold']} radius={4} />
      ))}
    </BarChart>
  );
}

// ─── Line ───────────────────────────────────────────────────────────

function LineChartView({ payload }: { readonly payload: ChartPayload }): ReactElement {
  const xKeys = new Set<string>();
  for (const s of payload.series) for (const p of s.points) xKeys.add(p.x);
  const rows = Array.from(xKeys).map((x) => {
    const row: Record<string, string | number> = { x };
    for (const s of payload.series) {
      const found = s.points.find((p) => p.x === x);
      row[s.name] = found?.y ?? 0;
    }
    return row;
  });
  return (
    <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.6)" />
      <XAxis dataKey="x" stroke="hsl(var(--muted-foreground))" fontSize={11} />
      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
      <Tooltip
        contentStyle={{
          background: 'hsl(var(--surface))',
          border: '1px solid hsl(var(--border))',
          fontSize: 12,
        }}
      />
      {payload.series.map((s) => (
        <Line
          key={s.name}
          dataKey={s.name}
          type="monotone"
          stroke={COLOR_HEX[s.color ?? 'gold']}
          strokeWidth={2}
          dot={{ r: 2.5 }}
        />
      ))}
    </LineChart>
  );
}

// ─── Donut ──────────────────────────────────────────────────────────

function DonutChartView({ payload }: { readonly payload: ChartPayload }): ReactElement {
  const first = payload.series[0];
  if (!first) return <PieChart />;
  const data = first.points.map((p) => ({ name: p.x, value: p.y }));
  const fallbackColor = COLOR_HEX[first.color ?? 'gold'];
  // Spread color stops by rotating through the palette for variety.
  const palette: ReadonlyArray<string> = ['#FFC857', '#5BA9F2', '#2EBD85', '#E14B4B', '#F5B23E', '#8b5cf6'];
  return (
    <PieChart>
      <Pie data={data} dataKey="value" innerRadius={40} outerRadius={70} paddingAngle={2}>
        {data.map((_, i) => (
          <Cell key={i} fill={palette[i % palette.length] ?? fallbackColor} />
        ))}
      </Pie>
      <Tooltip
        contentStyle={{
          background: 'hsl(var(--surface))',
          border: '1px solid hsl(var(--border))',
          fontSize: 12,
        }}
      />
    </PieChart>
  );
}

'use client';

/**
 * InlineChartBlock — inline bar / line / sparkline / area / donut.
 *
 * Schema source: `packages/owner-os-tabs/src/rich-inline-blocks.ts` →
 * `inlineChartSchema`. Hand-rolled SVG renderer (no external chart lib)
 * so the inline footprint stays tiny. Annotations render as either a
 * dashed vertical line or a circular marker at the given x.
 *
 * Multi-series allowed (up to 5). Default height 220px.
 */

import type { ReactElement } from 'react';

interface ChartPoint {
  readonly x?: string | number;
  readonly y?: number;
}

interface ChartSeries {
  readonly name?: string;
  readonly color?: string;
  readonly points?: ReadonlyArray<ChartPoint>;
}

interface ChartAnnotation {
  readonly at?: string | number;
  readonly label?: { readonly en?: string; readonly sw?: string };
  readonly kind?: 'line' | 'marker';
}

export interface InlineChartBlock {
  readonly type: 'inline_chart';
  readonly kind?: 'bar' | 'line' | 'sparkline' | 'area' | 'donut';
  readonly title?: { readonly en?: string; readonly sw?: string };
  readonly series?: ReadonlyArray<ChartSeries>;
  readonly height?: number;
  readonly annotations?: ReadonlyArray<ChartAnnotation>;
  readonly [extra: string]: unknown;
}

export interface InlineChartBlockProps {
  readonly block: InlineChartBlock;
  readonly locale: 'sw' | 'en';
}

function localised(
  value: { readonly en?: string; readonly sw?: string } | undefined,
  locale: 'sw' | 'en',
  fallback: string,
): string {
  if (!value) return fallback;
  return (locale === 'sw' ? value.sw : value.en) ?? value.en ?? value.sw ?? fallback;
}

function collectYs(series: ReadonlyArray<ChartSeries>): ReadonlyArray<number> {
  const out: number[] = [];
  for (const s of series) {
    if (!Array.isArray(s.points)) continue;
    for (const p of s.points) {
      if (typeof p.y === 'number' && Number.isFinite(p.y)) out.push(p.y);
    }
  }
  return out;
}

export function InlineChartBlock({
  block,
  locale,
}: InlineChartBlockProps): ReactElement {
  const kind = block.kind ?? 'line';
  const height =
    typeof block.height === 'number' && block.height >= 80
      ? Math.min(block.height, 480)
      : 220;
  const width = 320;
  const padding = { top: 12, right: 8, bottom: 18, left: 32 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const title = localised(
    block.title,
    locale,
    locale === 'sw' ? 'Chati' : 'Chart',
  );

  const series = Array.isArray(block.series)
    ? block.series.filter((s): s is ChartSeries => Boolean(s)).slice(0, 5)
    : [];
  const ys = collectYs(series);
  const minY = ys.length > 0 ? Math.min(0, ...ys) : 0;
  const maxY = ys.length > 0 ? Math.max(...ys, minY + 1) : 1;
  const rangeY = maxY - minY || 1;

  const allX: ReadonlyArray<string | number> = (() => {
    const set = new Set<string | number>();
    for (const s of series) {
      if (!Array.isArray(s.points)) continue;
      for (const p of s.points) {
        if (typeof p.x === 'string' || typeof p.x === 'number') set.add(p.x);
      }
    }
    return Array.from(set);
  })();

  const xIndex = (val: string | number | undefined): number => {
    if (val === undefined) return 0;
    const idx = allX.indexOf(val);
    return idx >= 0 ? idx : 0;
  };
  const xCount = Math.max(1, allX.length);
  const stepX = innerW / Math.max(xCount - 1, 1);

  if (kind === 'donut') {
    const total = ys.reduce((s, v) => s + v, 0) || 1;
    let acc = 0;
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(innerW, innerH) / 2 - 8;
    return (
      <figure
        data-testid="inline-block-inline-chart"
        className="rounded-xl border border-border bg-surface/60 p-3"
      >
        <figcaption className="mb-2 text-tiny font-semibold uppercase tracking-wide text-foreground/70">
          {title}
        </figcaption>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {series.map((s, i) => {
            const points = Array.isArray(s.points) ? s.points : [];
            const sum = points.reduce((acc2, p) => acc2 + (p.y ?? 0), 0);
            const slice = (sum / total) * Math.PI * 2;
            const startA = acc;
            const endA = acc + slice;
            acc = endA;
            const x0 = cx + Math.cos(startA) * r;
            const y0 = cy + Math.sin(startA) * r;
            const x1 = cx + Math.cos(endA) * r;
            const y1 = cy + Math.sin(endA) * r;
            const largeArc = slice > Math.PI ? 1 : 0;
            return (
              <path
                key={i}
                d={`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`}
                fill={s.color ?? '#d4af37'}
                opacity={0.8}
              />
            );
          })}
        </svg>
      </figure>
    );
  }

  return (
    <figure
      data-testid="inline-block-inline-chart"
      className="rounded-xl border border-border bg-surface/60 p-3"
    >
      <figcaption className="mb-2 text-tiny font-semibold uppercase tracking-wide text-foreground/70">
        {title}
      </figcaption>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line
          x1={padding.left}
          y1={padding.top + innerH}
          x2={padding.left + innerW}
          y2={padding.top + innerH}
          stroke="currentColor"
          strokeOpacity="0.15"
        />
        {series.map((s, si) => {
          const points = Array.isArray(s.points) ? s.points : [];
          const coords = points.map((p) => {
            const px = padding.left + xIndex(p.x) * stepX;
            const yVal = typeof p.y === 'number' ? p.y : 0;
            const py = padding.top + innerH - ((yVal - minY) / rangeY) * innerH;
            return { px, py };
          });
          const color = s.color ?? '#d4af37';
          if (kind === 'bar') {
            const barW = Math.max(2, stepX * 0.6);
            return (
              <g key={si}>
                {coords.map((c, i) => (
                  <rect
                    key={i}
                    x={c.px - barW / 2}
                    y={c.py}
                    width={barW}
                    height={padding.top + innerH - c.py}
                    fill={color}
                    opacity={0.7}
                  />
                ))}
              </g>
            );
          }
          const path = coords
            .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.px.toFixed(1)} ${c.py.toFixed(1)}`)
            .join(' ');
          if (kind === 'area') {
            const areaPath = `${path} L ${coords[coords.length - 1]?.px ?? 0} ${padding.top + innerH} L ${coords[0]?.px ?? 0} ${padding.top + innerH} Z`;
            return (
              <g key={si}>
                <path d={areaPath} fill={color} opacity={0.18} />
                <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
              </g>
            );
          }
          // line / sparkline
          return (
            <path
              key={si}
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={kind === 'sparkline' ? 1.25 : 1.75}
            />
          );
        })}
        {Array.isArray(block.annotations)
          ? block.annotations.slice(0, 6).map((a, i) => {
              const ax = padding.left + xIndex(a.at) * stepX;
              if (a.kind === 'marker') {
                return (
                  <circle
                    key={i}
                    cx={ax}
                    cy={padding.top + innerH / 2}
                    r={3}
                    fill="#d4af37"
                  />
                );
              }
              return (
                <line
                  key={i}
                  x1={ax}
                  y1={padding.top}
                  x2={ax}
                  y2={padding.top + innerH}
                  stroke="#d4af37"
                  strokeDasharray="3,3"
                  strokeOpacity={0.5}
                />
              );
            })
          : null}
      </svg>
      {series.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-3">
          {series.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-tiny text-foreground/70">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color ?? '#d4af37' }}
                aria-hidden="true"
              />
              <span>{s.name ?? `Series ${i + 1}`}</span>
            </div>
          ))}
        </div>
      ) : null}
    </figure>
  );
}

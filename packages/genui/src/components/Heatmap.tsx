'use client';

/**
 * 13. heatmap — 2D matrix viewer.
 *
 * No-dep canvas/SVG-free implementation using CSS grid + per-cell
 * background colour. Colour scale: linear / log / diverging.
 */

import { useMemo } from 'react';

import type { AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { HeatmapPartSchema } from '../schemas';
import { formatCurrency, formatNumber, formatPercent } from '../format';

export type HeatmapProps = AgUiUiPartByKind<'heatmap'>;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function colorFor(
  v: number,
  min: number,
  max: number,
  scale: 'linear' | 'log' | 'diverging',
): string {
  if (max === min) return 'rgba(59, 130, 246, 0.2)';
  let t: number;
  if (scale === 'log') {
    const offset = Math.max(0, -min) + 1;
    t = (Math.log(v + offset) - Math.log(min + offset)) /
      (Math.log(max + offset) - Math.log(min + offset));
  } else if (scale === 'diverging') {
    // Centre around 0; negatives go red, positives go blue.
    const mid = 0;
    if (v < mid) {
      const t2 = clamp((v - min) / (mid - min), 0, 1);
      return `rgba(220, 38, 38, ${(1 - t2).toFixed(2)})`;
    }
    const t2 = clamp((v - mid) / (max - mid), 0, 1);
    return `rgba(59, 130, 246, ${t2.toFixed(2)})`;
  } else {
    t = (v - min) / (max - min);
  }
  t = clamp(t, 0, 1);
  return `rgba(59, 130, 246, ${t.toFixed(2)})`;
}

function formatCellValue(props: HeatmapProps, v: number): string {
  if (props.format === 'currency' && props.currency) {
    // ISO-4217 — pass through Intl directly so the formatter accepts any code.
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: props.currency,
        maximumFractionDigits: 0,
      }).format(v);
    } catch {
      return formatCurrency(v, 'USD');
    }
  }
  if (props.format === 'percent') return formatPercent(v);
  return `${formatNumber(v)}${props.unit ? ` ${props.unit}` : ''}`;
}

export function Heatmap(props: HeatmapProps): JSX.Element {
  const parsed = HeatmapPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="heatmap"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }
  const { effMin, effMax } = useMemo(() => {
    const flat = props.cells.flatMap((r) => [...r]);
    return {
      effMin: props.minValue ?? Math.min(...flat),
      effMax: props.maxValue ?? Math.max(...flat),
    };
  }, [props.cells, props.minValue, props.maxValue]);

  return (
    <Frame kind="heatmap" {...(props.title ? { title: props.title } : {})}>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-muted-foreground" />
              {props.xAxis.map((x) => (
                <th key={x} className="px-2 py-1 text-left font-normal text-muted-foreground">
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.yAxis.map((y, yi) => (
              <tr key={y}>
                <td className="px-2 py-1 text-muted-foreground">{y}</td>
                {(props.cells[yi] ?? []).map((v, xi) => (
                  <td
                    key={xi}
                    title={formatCellValue(props, v)}
                    className="border border-border px-2 py-1 text-foreground"
                    style={{ backgroundColor: colorFor(v, effMin, effMax, props.colorScale) }}
                  >
                    {formatCellValue(props, v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  );
}

'use client';

/**
 * 20. metric-sparkline — single KPI + inline mini-trend.
 *
 * Tighter than kpi-grid (one metric at a time, with sparkline history).
 * SVG only — no charting library needed for so few data points.
 */

import { useMemo } from 'react';

import type { AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { MetricSparklinePartSchema } from '../schemas';
import { formatNumber, formatPercent } from '../format';

export type MetricSparklineProps = AgUiUiPartByKind<'metric-sparkline'>;

const W = 120;
const H = 28;

function formatMetricValue(props: MetricSparklineProps, v: number): string {
  if (props.format === 'percent') return formatPercent(v);
  if (props.format === 'currency' && props.currency) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: props.currency,
        maximumFractionDigits: 0,
      }).format(v);
    } catch {
      return `${props.currency} ${formatNumber(v)}`;
    }
  }
  return formatNumber(v);
}

export function MetricSparkline(props: MetricSparklineProps): JSX.Element {
  const parsed = MetricSparklinePartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="metric-sparkline"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }
  const pathD = useMemo(() => {
    const xs = props.sparkline;
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const range = max - min || 1;
    const step = W / Math.max(1, xs.length - 1);
    return xs
      .map((y, i) => {
        const cx = i * step;
        const cy = H - ((y - min) / range) * H;
        return `${i === 0 ? 'M' : 'L'} ${cx.toFixed(1)} ${cy.toFixed(1)}`;
      })
      .join(' ');
  }, [props.sparkline]);

  const deltaSign = props.delta === undefined ? '' : props.delta >= 0 ? '+' : '';
  const deltaColor =
    props.deltaIsPositive === undefined
      ? 'text-muted-foreground'
      : props.deltaIsPositive
        ? 'text-green-600'
        : 'text-red-600';

  return (
    <Frame kind="metric-sparkline" {...(props.title ? { title: props.title } : {})}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {props.label}
          </div>
          <div className="mt-0.5 text-xl font-semibold text-foreground">
            {formatMetricValue(props, props.value)}
          </div>
          {props.delta !== undefined ? (
            <div className={`text-[11px] ${deltaColor}`}>
              {deltaSign}
              {formatNumber(props.delta)}
            </div>
          ) : null}
        </div>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
          <path d={pathD} fill="none" stroke="currentColor" strokeWidth={1.5} />
        </svg>
      </div>
    </Frame>
  );
}

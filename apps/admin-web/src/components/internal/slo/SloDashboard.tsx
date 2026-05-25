'use client';

import { DataSourceBadge } from '../DataSourceBadge';
import { SloCard } from './SloCard';
import { useSloQuery } from '@/lib/internal/queries/slo';

function p99Tone(p99: number): 'neutral' | 'warn' | 'danger' {
  if (p99 >= 3000) return 'danger';
  if (p99 >= 1500) return 'warn';
  return 'neutral';
}

function errorTone(pct: number): 'neutral' | 'warn' | 'danger' {
  if (pct >= 1) return 'danger';
  if (pct >= 0.5) return 'warn';
  return 'neutral';
}

export function SloDashboard(): JSX.Element {
  const query = useSloQuery();
  if (query.isPending) return <p className="text-sm text-neutral-500">Loading SLOs…</p>;
  if (query.isError) return <p className="text-sm text-danger">{query.error.message}</p>;

  const rows = query.data?.rows ?? [];

  return (
    <div className="space-y-6">
      {rows.map((row) => (
        <section key={row.juniorId} className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">{row.junior}</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <SloCard
              label="Latency p50 / p95 / p99"
              value={`${row.p50ms} / ${row.p95ms} / ${row.p99ms} ms`}
              tone={p99Tone(row.p99ms)}
              sparkline={row.sparkline}
            />
            <SloCard
              label="Error rate"
              value={`${row.errorRatePct.toFixed(2)}%`}
              tone={errorTone(row.errorRatePct)}
            />
            <SloCard label="Model spend (mo)" value={`$${row.spendUsd.toFixed(2)}`} />
            <SloCard label="Requests (24h)" value={row.requestVolume24h.toLocaleString()} />
          </div>
        </section>
      ))}
      <DataSourceBadge source={query.data?.source ?? 'mock'} />
    </div>
  );
}

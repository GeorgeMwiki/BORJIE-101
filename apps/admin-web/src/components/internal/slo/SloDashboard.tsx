'use client';

import { Activity } from 'lucide-react';
import { Skeleton, Alert, Empty } from '@borjie/design-system';
import { DataSourceBadge } from '../DataSourceBadge';
import { SloCard } from './SloCard';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { useSloQuery } from '@/lib/internal/queries/slo';
import { localizeApiError } from '@borjie/error-catalog';

const S = {
  loading: { en: 'Loading SLOs…', sw: 'Inapakia SLO…' },
  emptyTitle: { en: 'No SLO data yet', sw: 'Hakuna data ya SLO bado' },
  emptyBody: {
    en: 'Latency, error-rate, spend and request-volume metrics appear here once juniors start serving traffic.',
    sw: 'Vipimo vya ucheleweshaji, kiwango cha makosa, matumizi na kiasi cha maombi huonekana hapa mara wasaidizi wanapoanza kuhudumia trafiki.',
  },
  latency: { en: 'Latency p50 / p95 / p99', sw: 'Ucheleweshaji p50 / p95 / p99' },
  errorRate: { en: 'Error rate', sw: 'Kiwango cha makosa' },
  spend: { en: 'Model spend (mo)', sw: 'Matumizi ya modeli (mwezi)' },
  requests: { en: 'Requests (24h)', sw: 'Maombi (saa 24)' },
} as const;

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

export function SloDashboard({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
} = {}): JSX.Element {
  const locale = useLocale(initialLocale);
  const query = useSloQuery();

  if (query.isPending) {
    return (
      <Skeleton
        className="h-48 w-full rounded-lg"
        aria-label={pickByLocale(locale, S.loading)}
      />
    );
  }
  if (query.isError) {
    return <Alert variant="error">{localizeApiError(query.error, locale)}</Alert>;
  }

  const rows = query.data?.rows ?? [];

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <Empty
          icon={<Activity className="h-8 w-8" />}
          title={pickByLocale(locale, S.emptyTitle)}
          description={pickByLocale(locale, S.emptyBody)}
        />
        <DataSourceBadge source={query.data?.source ?? 'live'} locale={locale} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {rows.map((row) => (
        <section key={row.juniorId} className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">{row.junior}</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <SloCard
              label={pickByLocale(locale, S.latency)}
              value={`${row.p50ms} / ${row.p95ms} / ${row.p99ms} ms`}
              tone={p99Tone(row.p99ms)}
              sparkline={row.sparkline}
            />
            <SloCard
              label={pickByLocale(locale, S.errorRate)}
              value={`${row.errorRatePct.toFixed(2)}%`}
              tone={errorTone(row.errorRatePct)}
            />
            <SloCard label={pickByLocale(locale, S.spend)} value={`$${row.spendUsd.toFixed(2)}`} />
            <SloCard label={pickByLocale(locale, S.requests)} value={row.requestVolume24h.toLocaleString()} />
          </div>
        </section>
      ))}
      <DataSourceBadge source={query.data?.source ?? 'live'} locale={locale} />
    </div>
  );
}

'use client';

/**
 * Market-intelligence panel — owner market surface.
 *
 * Surfaces the real `@borjie/market-intelligence` via the mining BFF:
 * latest commodity price, a buy/sell/hold signal with causal reasoning,
 * a 90-day demand-forecast band summary, and active disruption alerts.
 *
 * REAL price source: gold is priced + forecast from the LBMA fix stored
 * in `fx_rates`. Copper + tanzanite have no live feed yet, so the panel
 * renders an honest "feed not wired" state for them (never a fabricated
 * number).
 *
 * Price currency is DATA (USD for the gold fix) threaded into
 * `formatCurrency` — never hardcoded. Every signal shows its non-empty
 * reasoning chain (evidence-required).
 */

import { useState } from 'react';
import { Skeleton } from '@borjie/design-system';
import { formatCurrency } from '@borjie/api-client';
import { marketIntelligencePanelStrings as T } from '@/i18n/strings/market-intelligence-panel';
import { enumLabel } from '@/components/owner-os/panels/enum-label';
import {
  useCommodityForecast,
  useCommodityPrice,
  useDisruptionAlerts,
  useSellSignals,
  isFeedUnavailable,
  MARKET_COMMODITIES,
  type DemandForecast,
  type DisruptionAlert,
  type MarketCommodity,
  type SellSignal,
} from '@/lib/queries/market-intelligence';

interface MarketIntelligencePanelProps {
  readonly locale: 'sw' | 'en';
}

const ACTION_TONE: Record<SellSignal['action'], string> = {
  buy: 'border-success/40 bg-success-subtle/20 text-success',
  sell: 'border-danger/40 bg-danger-subtle/20 text-danger',
  hold: 'border-border bg-background text-foreground',
};

const DISRUPTION_TONE: Record<DisruptionAlert['severity'], string> = {
  low: 'border-border bg-background text-foreground',
  medium: 'border-warning/40 bg-warning-subtle/20 text-warning',
  high: 'border-warning/40 bg-warning-subtle/20 text-warning',
  critical: 'border-danger/40 bg-danger-subtle/20 text-danger',
};

export function MarketIntelligencePanel({ locale }: MarketIntelligencePanelProps) {
  const tr = (k: keyof typeof T) => T[k][locale];
  const [commodity, setCommodity] = useState<MarketCommodity>('gold');

  const price = useCommodityPrice(commodity);
  const signals = useSellSignals(commodity);
  const forecast = useCommodityForecast(commodity);
  const disruptions = useDisruptionAlerts();

  const numLocale = locale === 'sw' ? 'sw-TZ' : 'en-US';
  const priceFeedDown = isFeedUnavailable(price.error);

  return (
    <article className="rounded-md border border-border bg-surface px-4 py-4">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{tr('title')}</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tr('subtitle')}</p>
        </div>
        <label className="block text-xs">
          <span className="mb-1 block text-muted-foreground">{tr('commodity')}</span>
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
            value={commodity}
            onChange={(e) => setCommodity(e.target.value as MarketCommodity)}
          >
            {MARKET_COMMODITIES.map((cmd) => (
              <option key={cmd} value={cmd}>
                {cmd}
              </option>
            ))}
          </select>
        </label>
      </header>

      {priceFeedDown ? (
        <p className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
          {tr('feedUnavailable')}
        </p>
      ) : (
        <div className="space-y-4">
          {/* Price */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {price.isLoading ? (
              <SkeletonMetric />
            ) : price.isError ? (
              <Metric label={tr('latestPrice')} value={tr('error')} />
            ) : price.data ? (
              <>
                <Metric
                  label={tr('latestPrice')}
                  value={formatCurrency(price.data.price, price.data.currency, { locale: numLocale })}
                />
                <Metric label={tr('source')} value={price.data.source} />
                <Metric label={tr('asOf')} value={new Date(price.data.asOfISO).toLocaleString(numLocale)} />
              </>
            ) : null}
          </div>

          {/* Sell signal */}
          <SignalBlock locale={locale} loading={signals.isLoading} error={signals.isError} signal={signals.data?.[0]} />

          {/* Forecast band */}
          <ForecastBlock
            locale={locale}
            loading={forecast.isLoading}
            insufficient={isFeedUnavailable(forecast.error)}
            error={forecast.isError}
            forecast={forecast.data}
            currency={price.data?.currency ?? 'USD'}
            numLocale={numLocale}
          />
        </div>
      )}

      {/* Disruptions (tenant-wide, not commodity-gated) */}
      <div className="mt-5">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{tr('disruptions')}</h4>
        {disruptions.isLoading ? (
          <p className="text-xs text-muted-foreground">{tr('loading')}</p>
        ) : disruptions.isError ? (
          <p className="text-xs text-danger">{tr('error')}</p>
        ) : !disruptions.data || disruptions.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">{tr('noDisruptions')}</p>
        ) : (
          <ul className="space-y-2">
            {disruptions.data.map((d) => (
              <li key={d.id} className={`rounded-md border px-3 py-2 ${DISRUPTION_TONE[d.severity]}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{d.headline}</span>
                  <span className="text-tiny uppercase tracking-wide opacity-70">
                    {enumLabel('disruptionKind', d.kind, locale)} ·{' '}
                    {enumLabel('alertSeverity', d.severity, locale)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed opacity-90">{d.rationale}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

// ─── Sub-blocks ───────────────────────────────────────────────────────

function SignalBlock({
  locale,
  loading,
  error,
  signal,
}: {
  readonly locale: 'sw' | 'en';
  readonly loading: boolean;
  readonly error: boolean;
  readonly signal?: SellSignal | undefined;
}) {
  const tr = (k: keyof typeof T) => T[k][locale];
  if (loading) return <p className="text-xs text-muted-foreground">{tr('loading')}</p>;
  if (error) return <p className="text-xs text-danger">{tr('error')}</p>;
  if (!signal) return null;
  return (
    <div className={`rounded-md border px-3 py-2 ${ACTION_TONE[signal.action]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold uppercase">
          {tr('signal')}: {signal.action}
        </span>
        <span className="text-tiny opacity-80">
          {(signal.confidence * 100).toFixed(0)}% {tr('confidence')}
        </span>
      </div>
      <div className="mt-1.5 text-tiny uppercase tracking-wide opacity-70">{tr('reasoning')}</div>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs opacity-90">
        {signal.reasoning.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

function ForecastBlock({
  locale,
  loading,
  insufficient,
  error,
  forecast,
  currency,
  numLocale,
}: {
  readonly locale: 'sw' | 'en';
  readonly loading: boolean;
  readonly insufficient: boolean;
  readonly error: boolean;
  readonly forecast?: DemandForecast | undefined;
  readonly currency: string;
  readonly numLocale: string;
}) {
  const tr = (k: keyof typeof T) => T[k][locale];
  if (insufficient) {
    return (
      <p className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
        {tr('insufficientHistory')}
      </p>
    );
  }
  if (loading) return <p className="text-xs text-muted-foreground">{tr('loading')}</p>;
  if (error) return <p className="text-xs text-danger">{tr('error')}</p>;
  if (!forecast || forecast.points.length === 0) return null;

  const first = forecast.points[0]!;
  const last = forecast.points[forecast.points.length - 1]!;
  const fmt = (v: number) => formatCurrency(v, currency, { locale: numLocale });

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-tiny uppercase tracking-wide text-muted-foreground">{tr('forecast')}</span>
        <span className="text-tiny text-muted-foreground">
          {tr('forecastConfidence')}: {(forecast.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <BandCol label={tr('now')} p5={fmt(first.p5)} p50={fmt(first.p50)} p95={fmt(first.p95)} />
        <BandCol label={tr('day90')} p5={fmt(last.p5)} p50={fmt(last.p50)} p95={fmt(last.p95)} />
      </div>
      <div className="mt-2 text-tiny uppercase tracking-wide text-muted-foreground">{tr('drivers')}</div>
      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
        {forecast.drivers.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
    </div>
  );
}

function BandCol({
  label,
  p5,
  p50,
  p95,
}: {
  readonly label: string;
  readonly p5: string;
  readonly p50: string;
  readonly p95: string;
}) {
  return (
    <div className="rounded-md border border-border bg-surface px-2 py-1">
      <div className="text-tiny uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-tiny text-muted-foreground">p5 {p5}</div>
      <div className="font-mono text-xs text-foreground">p50 {p50}</div>
      <div className="font-mono text-tiny text-muted-foreground">p95 {p95}</div>
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-tiny uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}

function SkeletonMetric() {
  return <Skeleton className="h-14 rounded-md border border-border" />;
}

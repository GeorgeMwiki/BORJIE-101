'use client';

import { useState, type ReactElement } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@borjie/api-client';
import { Skeleton, Alert } from '@borjie/design-system';
import {
  useCommodityAdvice,
  COMMODITIES,
  type Commodity,
  type IntelRecommendation,
  type TrendWindow,
} from '@/lib/queries/commodity-intelligence';
import { useLocale, pickByLocale } from '@/lib/locale';
import { bcp47For } from '@/lib/format';
import type { Locale } from '@/lib/locale-shared';
import {
  commodityTrendPanelStrings as S,
} from '@/i18n/strings/commodity-trend-panel';

/**
 * Commodity-intelligence trend panel (O-W-17 companion).
 *
 * Surfaces the REAL `@borjie/mining-commodity-intelligence` output —
 * 1d/7d/30d/90d price-trend windows + lock / delay-sale recommendations
 * computed server-side from the global `mineral_prices` ticker (see
 * services/api-gateway/src/routes/mining/commodity-intelligence.hono.ts).
 * The owner picks a commodity; the panel renders the trend windows and
 * each recommendation with its evidence chain (CLAUDE.md
 * evidence-required).
 *
 * Mounted alongside the existing FxChart / SellSimulator — it does NOT
 * touch the page nav. Prices render through `formatCurrency` with the
 * snapshot's own benchmark currency (never hard-coded). All states render
 * real copy; nothing is fabricated.
 */

const SEVERITY_TONE: Record<IntelRecommendation['severity'], string> = {
  info: 'border-info/40 text-info bg-info/10',
  low: 'border-info/40 text-info bg-info/10',
  medium: 'border-warning/40 text-warning bg-warning/10',
  high: 'border-destructive/40 text-destructive bg-destructive/10',
  critical: 'border-destructive/60 text-destructive bg-destructive/15',
};

function DirectionIcon({ d }: { d: TrendWindow['direction'] }): ReactElement {
  if (d === 'up') return <TrendingUp className="h-4 w-4 text-success" />;
  if (d === 'down') return <TrendingDown className="h-4 w-4 text-destructive" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

interface CommodityTrendPanelProps {
  readonly initialLocale?: Locale | undefined;
}

export function CommodityTrendPanel({
  initialLocale,
}: CommodityTrendPanelProps = {}): ReactElement {
  const locale = useLocale(initialLocale);
  const [commodity, setCommodity] = useState<Commodity>('gold');
  const adviceQ = useCommodityAdvice({ commodity });

  return (
    <section className="rounded-2xl border border-border bg-surface/40 p-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {pickByLocale(locale, S.title)}
          </h2>
          <p className="text-xs text-muted-foreground">
            {pickByLocale(locale, S.subtitle)}
          </p>
        </div>
        <select
          value={commodity}
          onChange={(e) => setCommodity(e.target.value as Commodity)}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
          aria-label={pickByLocale(locale, S.selectCommodity)}
        >
          {COMMODITIES.map((cmd) => (
            <option key={cmd} value={cmd}>
              {pickByLocale(locale, S.commodity[cmd])}
            </option>
          ))}
        </select>
      </header>

      {adviceQ.isLoading && (
        <Skeleton className="h-20 rounded-md border border-border" />
      )}
      {adviceQ.isError && (
        <Alert variant="error" size="sm">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {pickByLocale(locale, S.unavailable)}
          </span>
        </Alert>
      )}

      {adviceQ.data && (
        <div className="space-y-4">
          {adviceQ.data.snapshot ? (
            <>
              <p className="text-xs text-muted-foreground">
                {pickByLocale(locale, S.latest)}:{' '}
                <span className="font-semibold text-foreground">
                  {formatCurrency(
                    Math.round(adviceQ.data.snapshot.latestPrice),
                    adviceQ.data.snapshot.baseCurrency,
                    { locale: bcp47For(locale) },
                  )}
                </span>{' '}
                {pickByLocale(locale, S.perTonne)} ·{' '}
                {pickByLocale(
                  locale,
                  S.sources(adviceQ.data.snapshot.sources.join(', ') || '—'),
                )}
              </p>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {adviceQ.data.snapshot.windows.map((w) => (
                  <li
                    key={w.label}
                    className="rounded-xl border border-border bg-background/60 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {w.label}
                      </span>
                      <DirectionIcon d={w.direction} />
                    </div>
                    <p
                      className={`mt-1 text-sm font-semibold ${
                        w.direction === 'up'
                          ? 'text-success'
                          : w.direction === 'down'
                            ? 'text-destructive'
                            : 'text-foreground'
                      }`}
                    >
                      {w.percentChange >= 0 ? '+' : ''}
                      {w.percentChange.toFixed(1)}%
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {adviceQ.data.note ?? pickByLocale(locale, S.noTickerData)}
            </p>
          )}

          {adviceQ.data.recommendations.length > 0 && (
            <ul className="space-y-2">
              {adviceQ.data.recommendations.map((r) => (
                <li
                  key={r.id}
                  className={`rounded-xl border p-3 text-xs ${SEVERITY_TONE[r.severity]}`}
                >
                  <p className="font-semibold">{r.title}</p>
                  <p className="mt-1 text-muted-foreground">{r.rationale}</p>
                  <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {pickByLocale(
                      locale,
                      S.evidence(r.evidence.map((e) => e.id).join(', ')),
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {adviceQ.data.snapshot &&
            adviceQ.data.recommendations.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {pickByLocale(locale, S.noSignals)}
              </p>
            )}
        </div>
      )}
    </section>
  );
}

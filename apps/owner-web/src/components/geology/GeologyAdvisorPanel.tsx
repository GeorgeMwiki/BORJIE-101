'use client';

import { useState, type ReactElement } from 'react';
import { Microscope, AlertTriangle } from 'lucide-react';
import { Card } from '@borjie/design-system';
import { useSitesList } from '@/lib/queries/sites';
import { useLocale, pickByLocale } from '@/lib/locale';
import { bcp47For } from '@/lib/format';
import type { Locale } from '@/lib/locale-shared';
import {
  useGeologyAdvice,
  type GeologyRecommendation,
} from '@/lib/queries/geology-advisor';
import { geologyAdvisorStrings as S } from '@/i18n/strings/geology-advisor';

/**
 * Geology-advisor recommendations panel (O-W-11 companion).
 *
 * Surfaces the REAL `@borjie/geology-advisor` output — orebody stats +
 * policy-driven recommendations computed server-side from the tenant's
 * live `samples` + vein-intersect layers (see
 * services/api-gateway/src/routes/mining/geology-advisor.hono.ts). The
 * owner picks a site; the panel renders contained-metal stats and each
 * recommendation with its evidence chain (CLAUDE.md evidence-required).
 *
 * This is a standalone panel mounted alongside the existing drill-holes
 * GeologyPanel — it does NOT touch the page nav. All states (loading /
 * empty / degraded / error) render real per-locale copy; nothing is
 * fabricated. The locale is SEEDED from the server-resolved session so
 * SSR + the client's first paint render the SAME language (zero-mix
 * canon) — numbers go through `bcp47For(locale)` so grouping/decimals
 * match the active locale.
 */

const SEVERITY_TONE: Record<GeologyRecommendation['severity'], string> = {
  info: 'border-info/40 text-info bg-info/10',
  low: 'border-info/40 text-info bg-info/10',
  medium: 'border-warning/40 text-warning bg-warning/10',
  high: 'border-destructive/40 text-destructive bg-destructive/10',
  critical: 'border-destructive/60 text-destructive bg-destructive/15',
};

function fmt(n: number, locale: Locale, digits = 2): string {
  return Number.isFinite(n)
    ? n.toLocaleString(bcp47For(locale), { maximumFractionDigits: digits })
    : '—';
}

interface GeologyAdvisorPanelProps {
  /** Seeded by the server-resolved session so SSR + first paint agree. */
  readonly locale?: Locale;
}

export function GeologyAdvisorPanel({
  locale: seeded,
}: GeologyAdvisorPanelProps): ReactElement {
  const locale = useLocale(seeded);
  const sitesQ = useSitesList();
  const sites = sitesQ.data ?? [];
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const activeSiteId = siteId ?? sites[0]?.id;
  const adviceQ = useGeologyAdvice({ siteId: activeSiteId });

  return (
    <Card className="rounded-2xl p-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl border border-info/40 bg-info/10 p-2 text-info">
            <Microscope className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {pickByLocale(locale, S.title)}
            </h2>
            <p className="text-xs text-neutral-400">
              {pickByLocale(locale, S.subtitle)}
            </p>
          </div>
        </div>
        {sites.length > 0 && (
          <select
            value={activeSiteId ?? ''}
            onChange={(e) => setSiteId(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground"
            aria-label={pickByLocale(locale, S.selectSite)}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {sitesQ.isLoading && (
        <p className="text-xs text-neutral-400">
          {pickByLocale(locale, S.loadingSites)}
        </p>
      )}
      {!sitesQ.isLoading && sites.length === 0 && (
        <p className="text-xs text-neutral-400">
          {pickByLocale(locale, S.noSites)}
        </p>
      )}

      {activeSiteId && adviceQ.isLoading && (
        <p className="text-xs text-neutral-400">
          {pickByLocale(locale, S.computing)}
        </p>
      )}
      {activeSiteId && adviceQ.isError && (
        <p className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4" />
          {pickByLocale(locale, S.advisorUnavailable)}
        </p>
      )}

      {adviceQ.data && (
        <div className="space-y-4">
          {adviceQ.data.analysis ? (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label={pickByLocale(locale, S.statTotalTonnes)}
                value={fmt(adviceQ.data.analysis.stats.totalTonnes, locale, 0)}
              />
              <Stat
                label={pickByLocale(locale, S.statAvgGrade)}
                value={fmt(adviceQ.data.analysis.stats.weightedAverageGrade, locale)}
              />
              <Stat
                label={pickByLocale(locale, S.statContainedMetal)}
                value={fmt(adviceQ.data.analysis.stats.containedMetalTonnes, locale, 4)}
              />
              <Stat
                label={pickByLocale(locale, S.statIntervals)}
                value={fmt(adviceQ.data.analysis.stats.intervalCount, locale, 0)}
              />
            </dl>
          ) : adviceQ.data.note ? (
            // The backend degraded-note is an English diagnostic string; mark
            // it `lang="en"` so it is attributed honestly until the advisor
            // pins output to the active locale (see residual).
            <p lang="en" className="text-xs text-neutral-400">
              {adviceQ.data.note}
            </p>
          ) : (
            <p className="text-xs text-neutral-400">
              {pickByLocale(locale, S.noAssay)}
            </p>
          )}

          {adviceQ.data.recommendations.length > 0 && (
            <ul className="space-y-2">
              {adviceQ.data.recommendations.map((r) => (
                <li
                  key={r.id}
                  className={`rounded-xl border p-3 text-xs ${SEVERITY_TONE[r.severity]}`}
                >
                  {/* Advisor-engine recommendation strings are English; mark
                      them `lang="en"` for honest attribution until the engine
                      pins output to the active locale (see residual). */}
                  <p lang="en" className="font-semibold">{r.title}</p>
                  <p lang="en" className="mt-1 text-neutral-300">{r.rationale}</p>
                  <p className="mt-2 text-[10px] uppercase tracking-wide text-neutral-500">
                    {pickByLocale(locale, S.evidence)}:{' '}
                    {r.evidence.map((e) => e.id).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {adviceQ.data.analysis &&
            adviceQ.data.recommendations.length === 0 && (
              <p className="text-xs text-success">
                {pickByLocale(locale, S.noRecommendations)}
              </p>
            )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <dt className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

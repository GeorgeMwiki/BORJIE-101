'use client';

import { useState, type ReactElement } from 'react';
import { CalendarClock, AlertTriangle } from 'lucide-react';
import {
  Card,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@borjie/design-system';
import { formatCurrency } from '@borjie/genui';
import { useSitesList } from '@/lib/queries/sites';
import { useLocale, pickByLocale } from '@/lib/locale';
import { bcp47For } from '@/lib/format';
import type { Locale } from '@/lib/locale-shared';
import {
  useMinePlannerAdvice,
  type PlanRecommendation,
} from '@/lib/queries/mine-planner-advisor';
import { minePlannerAdvisorStrings as S } from '@/i18n/strings/mine-planner-advisor';

/**
 * Mine-planner-advisor recommendations panel (O-W-09 companion).
 *
 * Surfaces the REAL `@borjie/mine-planner-advisor` output — a 24h shift
 * plan (per-shift tonnage / hours / opex) + skill-gap recommendations
 * computed server-side from the tenant's live `ore_parcels` + `assets`.
 * The owner picks a site; the panel renders plan totals and each
 * recommendation with its evidence chain (CLAUDE.md evidence-required).
 *
 * Opex is rendered through `formatCurrency` with the tenant's display
 * currency (passed in by the page); never hard-coded. All states
 * (loading / empty / degraded / error) render real per-locale copy.
 */

const SEVERITY_TONE: Record<PlanRecommendation['severity'], string> = {
  info: 'border-info/40 text-info bg-info-subtle',
  low: 'border-info/40 text-info bg-info-subtle',
  medium: 'border-warning/40 text-warning bg-warning-subtle',
  high: 'border-danger/40 text-danger bg-danger-subtle',
  critical: 'border-danger/60 text-danger bg-danger-subtle',
};

function fmt(n: number, locale: Locale, digits = 1): string {
  return Number.isFinite(n)
    ? n.toLocaleString(bcp47For(locale), { maximumFractionDigits: digits })
    : '—';
}

interface MinePlannerAdvisorPanelProps {
  /**
   * Tenant display currency (ISO-4217), supplied by the page so KE/UG/NG
   * tenants render their own currency — never hard-coded here.
   */
  readonly currencyCode?: string;
  /** Seeded by the server-resolved session so SSR + first paint agree. */
  readonly locale?: Locale;
}

function formatOpex(value: number, locale: Locale, currencyCode?: string): string {
  const rounded = Math.round(value);
  return currencyCode
    ? formatCurrency(rounded, currencyCode)
    : rounded.toLocaleString(bcp47For(locale));
}

export function MinePlannerAdvisorPanel({
  currencyCode,
  locale: seeded,
}: MinePlannerAdvisorPanelProps): ReactElement {
  const locale = useLocale(seeded);
  const sitesQ = useSitesList();
  const sites = sitesQ.data ?? [];
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const activeSiteId = siteId ?? sites[0]?.id;
  const adviceQ = useMinePlannerAdvice({ siteId: activeSiteId });

  return (
    <Card className="rounded-2xl p-6">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl border border-info/40 bg-info-subtle p-2 text-info">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {pickByLocale(locale, S.title)}
            </h2>
            <p className="text-xs text-muted-foreground">{pickByLocale(locale, S.subtitle)}</p>
          </div>
        </div>
        {sites.length > 0 && (
          <Select
            value={activeSiteId ?? ''}
            onValueChange={(value) => setSiteId(value)}
          >
            <SelectTrigger className="h-8 w-44 text-xs" aria-label={pickByLocale(locale, S.selectSite)}>
              <SelectValue placeholder={pickByLocale(locale, S.selectSite)} />
            </SelectTrigger>
            <SelectContent>
              {sites.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </header>

      {sitesQ.isLoading && (
        <p className="text-xs text-muted-foreground">{pickByLocale(locale, S.loadingSites)}</p>
      )}
      {!sitesQ.isLoading && sites.length === 0 && (
        <p className="text-xs text-muted-foreground">{pickByLocale(locale, S.noSites)}</p>
      )}

      {activeSiteId && adviceQ.isLoading && (
        <p className="text-xs text-muted-foreground">{pickByLocale(locale, S.computing)}</p>
      )}
      {activeSiteId && adviceQ.isError && (
        <p className="flex items-center gap-2 text-xs text-danger">
          <AlertTriangle className="h-4 w-4" />
          {pickByLocale(locale, S.advisorUnavailable)}
        </p>
      )}

      {adviceQ.data && (
        <div className="space-y-4">
          {adviceQ.data.plan ? (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label={pickByLocale(locale, S.statPlannedTonnes)}
                value={fmt(adviceQ.data.plan.totalEstimatedTonnes, locale, 0)}
              />
              <Stat
                label={pickByLocale(locale, S.statUnmetTonnes)}
                value={fmt(adviceQ.data.plan.unmetTonnes, locale, 0)}
              />
              <Stat
                label={pickByLocale(locale, S.statAssignments)}
                value={fmt(adviceQ.data.plan.assignments.length, locale, 0)}
              />
              <Stat
                label={pickByLocale(locale, S.statPlanOpex)}
                value={formatOpex(adviceQ.data.plan.totalEstimatedOpex, locale, currencyCode)}
              />
            </dl>
          ) : adviceQ.data.note ? (
            // The backend degraded-note is an English diagnostic string; mark
            // the run as `en` so it is attributed honestly until the advisor
            // pins output to the active locale (see residual). When there is
            // no note we render the localized parity copy instead.
            <p lang="en" className="text-xs text-muted-foreground">
              {adviceQ.data.note}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {pickByLocale(locale, S.noParcels)}
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
                      the run as `en` for honest attribution until the engine
                      pins output to the active locale (see residual). */}
                  <p lang="en" className="font-semibold">{r.title}</p>
                  <p lang="en" className="mt-1 text-muted-foreground">{r.rationale}</p>
                  <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                    {pickByLocale(locale, S.evidence)}: {r.evidence.map((e) => e.id).join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {adviceQ.data.plan && adviceQ.data.recommendations.length === 0 && (
            <p className="text-xs text-success">{pickByLocale(locale, S.noGaps)}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-foreground">{value}</dd>
    </div>
  );
}

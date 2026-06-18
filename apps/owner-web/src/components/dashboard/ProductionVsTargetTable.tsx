'use client';

import { Sparkline } from '@/components/shared/Sparkline';
import { fmtNum } from '@/lib/format';
import { useLocale, pickByLocale } from '@/lib/locale';
import type { ProductionSlot } from '@/lib/queries/owner-brief';
import { dataAStrings as S } from '@/i18n/strings/data-a';

interface ProductionVsTargetTableProps {
  readonly production: ProductionSlot;
}

/**
 * Per-site production table with a recharts sparkline per row.
 *
 * Tonnes, fuel litres, and shifts logged are the three numbers the
 * cron computes for the rolling 30-day window. A sparkline is drawn
 * only when at least three sites contribute — fewer points would be
 * misleading.
 *
 * Single-language per active locale: header, columns, and empty state
 * resolve from the cockpit locale cookie. The header italic previously
 * hardcoded a Swahili subtitle under an English title (EN/SW mixing).
 */
export function ProductionVsTargetTable({
  production,
}: ProductionVsTargetTableProps): JSX.Element {
  const locale = useLocale();
  const P = S.productionVsTarget;
  const sparkData = production.perSite.map((s, i) => ({
    x: s.siteId ?? `site-${i}`,
    y: Number(s.tonnes ?? 0),
  }));

  return (
    <article
      className="cockpit-card flex h-full flex-col gap-4"
      data-testid="dashboard-production-table"
    >
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="cockpit-card-title">{pickByLocale(locale, P.title)}</h2>
          <p className="text-xs italic text-neutral-500">
            {pickByLocale(locale, P.subtitle)} · {production.window}
          </p>
        </div>
        <span className="pill border-border text-neutral-400">
          {pickByLocale(locale, P.sites(production.perSite.length))}
        </span>
      </header>

      {production.perSite.length === 0 ? (
        <p
          className="text-sm text-neutral-400"
          data-testid="dashboard-production-empty"
        >
          {pickByLocale(locale, P.empty)}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="py-2 pr-4">{pickByLocale(locale, P.colSite)}</th>
                  <th className="py-2 pr-4 text-right">
                    {pickByLocale(locale, P.colTonnes)}
                  </th>
                  <th className="py-2 pr-4 text-right">
                    {pickByLocale(locale, P.colFuel)}
                  </th>
                  <th className="py-2 text-right">
                    {pickByLocale(locale, P.colShifts)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {production.perSite.map((row, i) => (
                  <tr
                    key={row.siteId ?? `unassigned-${i}`}
                    className="border-b border-border/40"
                    data-testid="dashboard-production-row"
                  >
                    <td className="py-2 pr-4 text-foreground">
                      {row.siteId ?? pickByLocale(locale, P.unassigned)}
                    </td>
                    <td className="py-2 pr-4 text-right text-foreground">
                      {fmtNum(Number(row.tonnes ?? 0))}
                    </td>
                    <td className="py-2 pr-4 text-right text-neutral-300">
                      {fmtNum(Number(row.fuel ?? 0))}
                    </td>
                    <td className="py-2 text-right text-neutral-300">
                      {row.shifts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sparkData.length >= 3 ? (
            <div
              className="mt-2"
              data-testid="dashboard-production-spark"
              aria-label="Per-site tonnes sparkline"
            >
              <Sparkline
                data={sparkData}
                tone="green"
                height={56}
                tooltipFormatter={(v) => `${fmtNum(v)} t`}
              />
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}

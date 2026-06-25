'use client';

import { RefreshCw } from 'lucide-react';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { fmtNum, formatMoney, LAUNCH_CURRENCY } from '@/lib/format';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { inventorySurfaceStrings as S } from '@/i18n/strings/inventory-surface';
import {
  useInventoryReorder,
  useInventoryOnHandValue,
  type ReorderCandidate,
} from '@/lib/queries/inventory';

/**
 * Inventory surface — REAL consumables / spares replenishment computed by
 * `@borjie/inventory-management` over the live `inventory_skus` +
 * `inventory_stock_movements` tables.
 *
 * Surfaces the two highest-signal outputs:
 *   - Reorder candidates: SKUs at/below their minimum, with ABC band,
 *     shortfall, suggested order qty, and lead time
 *     (GET /api/v1/mining/inventory/reorder).
 *   - On-hand value by category (GET .../analytics/on-hand-value).
 *
 * On-hand is DERIVED by replaying the append-only movement log — never a
 * fabricated balance. Money figures are integer minor-units rendered in the
 * tenant's reporting currency (no hard-coded symbol). Real loading / empty /
 * error states throughout. Every label is single-locale (zero-mix canon)
 * via `pickByLocale`; the locale is SEEDED from the server so the first
 * paint matches the SSR chrome.
 */

/**
 * Render integer minor-units (cents) as a currency-canon money string. The
 * on-hand-value payload carries no currency code, so we self-label with the
 * tenant LAUNCH_CURRENCY constant the other owner surfaces use — never a bare
 * number or hardcoded symbol. (See residual: the gateway payload should carry
 * an explicit ISO currency field for non-TZS tenants.)
 */
function fmtMajor(cents: number, locale: Locale): string {
  return formatMoney(Math.round(cents) / 100, LAUNCH_CURRENCY, locale);
}

const BAND_STYLES: Readonly<Record<'A' | 'B' | 'C', string>> = {
  A: 'bg-red-500/10 text-red-600',
  B: 'bg-amber-500/10 text-amber-600',
  C: 'bg-neutral-500/10 text-neutral-500',
};

function ReorderTable({
  rows,
  locale,
}: {
  readonly rows: ReadonlyArray<ReorderCandidate>;
  readonly locale: Locale;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-3 py-2 font-medium">{pickByLocale(locale, S.colSku)}</th>
            <th className="px-3 py-2 font-medium">{pickByLocale(locale, S.colBand)}</th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colOnHand)}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colMinimum)}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colShortfall)}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colSuggestedQty)}
            </th>
            <th className="px-3 py-2 text-right font-medium">
              {pickByLocale(locale, S.colLeadDays)}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.skuId}:${r.locationId}`} className="border-b border-border/60">
              <td className="px-3 py-2 font-mono text-xs text-foreground">{r.skuId}</td>
              <td className="px-3 py-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${BAND_STYLES[r.abcBand]}`}
                >
                  {r.abcBand}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r.onHand)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtNum(r.minimumStockLevel)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-red-600">
                {fmtNum(r.shortfall)}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {fmtNum(r.suggestedQty)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {fmtNum(r.leadTimeDays)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventorySurface({
  initialLocale,
}: {
  readonly initialLocale?: Locale;
}) {
  const locale = useLocale(initialLocale);
  const reorder = useInventoryReorder();
  const onHand = useInventoryOnHandValue();

  return (
    <div className="space-y-6">
      <SectionCard
        title={pickByLocale(locale, S.reorderTitle)}
        subtitle={pickByLocale(locale, S.reorderSubtitle)}
        actions={
          <button
            type="button"
            aria-label={pickByLocale(locale, S.refresh)}
            onClick={() => void reorder.refetch()}
            className="text-neutral-500 hover:text-foreground"
          >
            <RefreshCw
              className={`h-4 w-4 ${reorder.isFetching ? 'animate-spin' : ''}`}
            />
          </button>
        }
      >
        {reorder.isLoading ? (
          <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
        ) : reorder.isError ? (
          <EmptyState
            title={pickByLocale(locale, S.reorderLoadFailedTitle)}
            description={
              (reorder.error as Error)?.message ?? pickByLocale(locale, S.unknownError)
            }
            hint="GET /api/v1/mining/inventory/reorder"
          />
        ) : (reorder.data?.candidates ?? []).length === 0 ? (
          <EmptyState
            title={pickByLocale(locale, S.reorderEmptyTitle)}
            description={pickByLocale(locale, S.reorderEmptyBody)}
            hint="POST /api/v1/mining/inventory/skus + /movements"
          />
        ) : (
          <ReorderTable rows={reorder.data?.candidates ?? []} locale={locale} />
        )}
      </SectionCard>

      <SectionCard
        title={pickByLocale(locale, S.onHandTitle)}
        subtitle={pickByLocale(locale, S.onHandSubtitle)}
        actions={
          <button
            type="button"
            aria-label={pickByLocale(locale, S.refresh)}
            onClick={() => void onHand.refetch()}
            className="text-neutral-500 hover:text-foreground"
          >
            <RefreshCw
              className={`h-4 w-4 ${onHand.isFetching ? 'animate-spin' : ''}`}
            />
          </button>
        }
      >
        {onHand.isLoading ? (
          <div className="h-chart-sm animate-pulse rounded-lg border border-border bg-surface/40" />
        ) : onHand.isError ? (
          <EmptyState
            title={pickByLocale(locale, S.onHandLoadFailedTitle)}
            description={
              (onHand.error as Error)?.message ?? pickByLocale(locale, S.unknownError)
            }
            hint="GET /api/v1/mining/inventory/analytics/on-hand-value"
          />
        ) : Object.keys(onHand.data?.byCategoryValueCents ?? {}).length === 0 ? (
          <EmptyState
            title={pickByLocale(locale, S.onHandEmptyTitle)}
            description={pickByLocale(locale, S.onHandEmptyBody)}
          />
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-400">
                    <th className="px-3 py-2 font-medium">
                      {pickByLocale(locale, S.colCategory)}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {pickByLocale(locale, S.colReportingValue)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(onHand.data?.byCategoryValueCents ?? {}).map(
                    ([category, cents]) => (
                      <tr key={category} className="border-b border-border/60">
                        <td className="px-3 py-2 text-foreground">{category}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtMajor(cents, locale)}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="px-3 py-2">{pickByLocale(locale, S.total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtMajor(onHand.data?.totalValueCents ?? 0, locale)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

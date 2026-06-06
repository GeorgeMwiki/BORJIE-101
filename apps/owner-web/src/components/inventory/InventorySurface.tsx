'use client';

import { RefreshCw } from 'lucide-react';
import { SectionCard } from '@/components/shared/SectionCard';
import { EmptyState } from '@/components/shared/EmptyState';
import { fmtNum } from '@/lib/format';
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
 * error states throughout.
 */

function fmtMajor(cents: number): string {
  return fmtNum(Math.round(cents) / 100);
}

const BAND_STYLES: Readonly<Record<'A' | 'B' | 'C', string>> = {
  A: 'bg-red-500/10 text-red-600',
  B: 'bg-amber-500/10 text-amber-600',
  C: 'bg-neutral-500/10 text-neutral-500',
};

function ReorderTable({ rows }: { readonly rows: ReadonlyArray<ReorderCandidate> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-400">
            <th className="px-3 py-2 font-medium">SKU</th>
            <th className="px-3 py-2 font-medium">Band</th>
            <th className="px-3 py-2 text-right font-medium">On hand</th>
            <th className="px-3 py-2 text-right font-medium">Minimum</th>
            <th className="px-3 py-2 text-right font-medium">Shortfall</th>
            <th className="px-3 py-2 text-right font-medium">Suggested qty</th>
            <th className="px-3 py-2 text-right font-medium">Lead (days)</th>
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

export function InventorySurface() {
  const reorder = useInventoryReorder();
  const onHand = useInventoryOnHandValue();

  return (
    <div className="space-y-6">
      <SectionCard
        title="Reorder candidates"
        subtitle="SKUs at or below their minimum, banded by value (ABC) with suggested order quantities."
        actions={
          <button
            type="button"
            aria-label="Refresh"
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
            title="Could not load reorder candidates"
            description={(reorder.error as Error)?.message ?? 'unknown error'}
            hint="GET /api/v1/mining/inventory/reorder"
          />
        ) : (reorder.data?.candidates ?? []).length === 0 ? (
          <EmptyState
            title="Nothing to reorder"
            description="No SKU is at or below its minimum stock level. Add SKUs and record stock movements to drive replenishment."
            hint="POST /api/v1/mining/inventory/skus + /movements"
          />
        ) : (
          <ReorderTable rows={reorder.data?.candidates ?? []} />
        )}
      </SectionCard>

      <SectionCard
        title="Stock on-hand value"
        subtitle="Σ quantity × unit cost by category — replayed from the movement log."
        actions={
          <button
            type="button"
            aria-label="Refresh"
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
            title="Could not load on-hand value"
            description={(onHand.error as Error)?.message ?? 'unknown error'}
            hint="GET /api/v1/mining/inventory/analytics/on-hand-value"
          />
        ) : Object.keys(onHand.data?.byCategoryValueCents ?? {}).length === 0 ? (
          <EmptyState
            title="No stock on hand"
            description="Recorded receipts will accumulate on-hand value here, grouped by category and valued at unit cost."
          />
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-neutral-400">
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Value (reporting ccy)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(onHand.data?.byCategoryValueCents ?? {}).map(
                    ([category, cents]) => (
                      <tr key={category} className="border-b border-border/60">
                        <td className="px-3 py-2 text-foreground">{category}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtMajor(cents)}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtMajor(onHand.data?.totalValueCents ?? 0)}
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

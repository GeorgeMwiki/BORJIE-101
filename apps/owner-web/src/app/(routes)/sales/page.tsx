'use client';

/**
 * O-W-13 — Sales & pipeline.
 *
 * Live data from:
 *   GET /api/v1/mining/sales — ore-parcel sale transactions.
 *
 * Renders a KPI strip (total sales count, total net revenue, pending
 * payments, most recent sale date) followed by a transaction table.
 * Empty state is shown when no sales exist yet — never fabricated data.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Coins,
  Loader2,
  Package,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest, ApiError } from '@/lib/api-client';
import { formatMoney, fmtDateForLocale, LAUNCH_CURRENCY } from '@/lib/format';
import { useLocale } from '@/lib/locale';
import { salesPageStrings as S } from '@/i18n/strings/sales-page';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const SaleRowSchema = z.object({
  id: z.string(),
  parcelId: z.string(),
  buyerId: z.string().nullable(),
  route: z.string(),
  grossPriceTzs: z.number().nullable(),
  netTzs: z.number().nullable(),
  paymentStatus: z.string(),
  ts: z.string(),
  vehiclePlate: z.string().nullable().optional(),
});

type SaleRow = z.infer<typeof SaleRowSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function paymentStatusTone(status: string): string {
  if (status === 'paid') return 'border-success/40 bg-success/10 text-success';
  if (status === 'pending') return 'border-warning/40 bg-warning/10 text-warning';
  if (status === 'overdue') return 'border-destructive/40 bg-destructive/10 text-destructive';
  return 'border-border bg-surface text-neutral-300';
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

function useSales(limit = 100) {
  return useQuery({
    queryKey: ['mining', 'sales', 'list', limit],
    queryFn: ({ signal }) =>
      apiRequest<unknown>(
        `/api/v1/mining/sales?limit=${limit}`,
        { signal },
      ),
    select: (raw): ReadonlyArray<SaleRow> => {
      if (Array.isArray(raw)) {
        return z.array(SaleRowSchema).parse(raw);
      }
      const env = z
        .object({ success: z.literal(true), data: z.array(SaleRowSchema) })
        .safeParse(raw);
      return env.success ? env.data.data : [];
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SalesPage() {
  const locale = useLocale();
  const { data, isLoading, isError, error } = useSales();
  const sales = data ?? [];

  const metrics = useMemo<readonly MetricTile[]>(() => {
    const totalNet = sales.reduce((sum, s) => sum + (s.netTzs ?? 0), 0);
    const totalGross = sales.reduce((sum, s) => sum + (s.grossPriceTzs ?? 0), 0);
    const pending = sales.filter((s) => s.paymentStatus === 'pending').length;
    return [
      {
        label: S.totalSalesLabel[locale],
        value: String(sales.length),
        sub: S.totalSalesSub[locale],
        icon: Package,
      },
      {
        label: S.grossLabel(LAUNCH_CURRENCY)[locale],
        value:
          totalGross > 0
            ? formatMoney(totalGross, LAUNCH_CURRENCY, locale)
            : '—',
        sub: S.grossSub[locale],
        icon: TrendingUp,
      },
      {
        label: S.netLabel(LAUNCH_CURRENCY)[locale],
        value:
          totalNet > 0 ? formatMoney(totalNet, LAUNCH_CURRENCY, locale) : '—',
        sub: S.netSub[locale],
        icon: Coins,
        tone: totalNet > 0 ? 'success' : 'default',
      },
      {
        label: S.pendingLabel[locale],
        value: String(pending),
        sub: S.pendingSub[locale],
        icon: ArrowRight,
        tone: pending > 0 ? 'warning' : 'default',
      },
    ];
  }, [sales, locale]);

  return (
    <div className="space-y-8 px-8 py-8">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 font-mono text-tiny uppercase tracking-eyebrow-wide text-signal-500">
            <Coins className="h-3.5 w-3.5" />
            <span>{S.eyebrow[locale]}</span>
          </div>
          <h1 className="font-display text-2xl font-medium text-foreground">
            {S.title[locale]}
          </h1>
          <p className="text-sm text-neutral-400">{S.subtitle[locale]}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/treasury"
            className="inline-flex items-center gap-1.5 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
          >
            <Coins className="h-3.5 w-3.5" />
            {S.fxTreasuryCta[locale]}
          </Link>
          <Link
            href="/ask?prompt=sales"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {S.askCta[locale]}
          </Link>
        </div>
      </header>

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          {S.loading[locale]}
        </div>
      ) : null}

      {/* Error */}
      {isError ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-xs text-destructive">
            {error instanceof ApiError ? error.message : S.loadFailed[locale]}
          </p>
        </div>
      ) : null}

      {/* Metrics (always render if data present) */}
      {!isLoading && !isError && sales.length > 0 ? (
        <MetricStrip tiles={metrics} cols={4} />
      ) : null}

      {/* Empty state */}
      {!isLoading && !isError && sales.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface/40 p-10 text-center">
          <Package className="mx-auto h-10 w-10 text-neutral-500" />
          <p className="mt-3 text-sm font-medium text-foreground">
            {S.emptyTitle[locale]}
          </p>
          <p className="mt-1 text-xs text-neutral-400">{S.emptyBody[locale]}</p>
          <Link
            href="/marketplace"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-medium text-foreground hover:bg-surface"
          >
            <ArrowRight className="h-3 w-3" />
            {S.openMarketplace[locale]}
          </Link>
        </div>
      ) : null}

      {/* Transactions table */}
      {sales.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            {S.allTransactions[locale]}
          </h2>
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="hidden grid-cols-12 gap-4 border-b border-border bg-surface/60 px-5 py-3 text-tiny font-semibold uppercase tracking-eyebrow-wide text-neutral-500 md:grid">
              <div className="col-span-2">{S.colDate[locale]}</div>
              <div className="col-span-3">{S.colParcel[locale]}</div>
              <div className="col-span-2">{S.colRoute[locale]}</div>
              <div className="col-span-2 text-right">
                {S.colGross(LAUNCH_CURRENCY)[locale]}
              </div>
              <div className="col-span-2 text-right">
                {S.colNet(LAUNCH_CURRENCY)[locale]}
              </div>
              <div className="col-span-1 text-right">{S.colStatus[locale]}</div>
            </div>
            <ul className="divide-y divide-border/60">
              {sales.map((row) => (
                <li
                  key={row.id}
                  className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-12 md:items-center md:gap-4"
                >
                  <div className="col-span-2 text-xs text-neutral-400">
                    {fmtDateForLocale(row.ts, locale)}
                  </div>
                  <div className="col-span-3">
                    <p className="font-mono text-xs text-foreground">
                      {row.parcelId.slice(0, 12)}…
                    </p>
                    {row.buyerId ? (
                      <p className="mt-0.5 font-mono text-tiny text-neutral-500">
                        {S.buyerPrefix[locale]}: {row.buyerId.slice(0, 8)}…
                      </p>
                    ) : null}
                  </div>
                  <div className="col-span-2 text-xs capitalize text-neutral-400">
                    {row.route}
                  </div>
                  <div className="col-span-2 text-right font-mono text-sm text-neutral-300">
                    {row.grossPriceTzs !== null
                      ? formatMoney(row.grossPriceTzs, LAUNCH_CURRENCY, locale)
                      : '—'}
                  </div>
                  <div className="col-span-2 text-right font-mono text-sm font-medium text-foreground">
                    {row.netTzs !== null
                      ? formatMoney(row.netTzs, LAUNCH_CURRENCY, locale)
                      : '—'}
                  </div>
                  <div className="col-span-1 flex justify-start md:justify-end">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-badge font-medium ${paymentStatusTone(row.paymentStatus)}`}
                    >
                      {row.paymentStatus}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}

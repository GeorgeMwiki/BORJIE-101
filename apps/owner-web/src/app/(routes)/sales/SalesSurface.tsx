'use client';

/**
 * O-W-13 — Sales & pipeline (client surface).
 *
 * Live data from:
 *   GET /api/v1/mining/sales         — paged ore-parcel sale rows (the table).
 *   GET /api/v1/mining/sales/summary — whole-book KPI aggregate (net/gross
 *     SUM, count, pending) folded in SQL over EVERY sale, so the KPI strip
 *     reports true revenue instead of folding the paged rows (which
 *     under-reports once a tenant crosses the page size).
 *
 * Renders a KPI strip (total sales count, total net revenue, pending
 * payments) followed by a transaction table. Empty state is shown when no
 * sales exist yet — never fabricated data.
 *
 * Client island seeded with `initialLocale` (resolved server-side in
 * page.tsx) so the first paint matches the SSR `<html lang>` chrome and
 * never flashes EN under an SW header (zero-mix canon).
 */

import { useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Coins,
  Package,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  Skeleton,
  Alert,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Button,
  StatusBadge,
  type StatusType,
} from '@borjie/design-system';
import { localizeApiError } from '@borjie/error-catalog';

import { apiRequest, ApiError } from '@/lib/api-client';
import { formatMoney, fmtDateForLocale, LAUNCH_CURRENCY } from '@/lib/format';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import {
  salesPageStrings as S,
  salesPaymentStatusLabels,
  saleRouteLabels,
  salesUnknownLabel,
} from '@/i18n/strings/sales-page';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';

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

/**
 * Whole-book aggregate the backend folds in SQL over EVERY matching sale
 * (not the paged ≤100/≤500 rows the table renders), served by the sibling
 * `GET /api/v1/mining/sales/summary`. The KPI strip reads these totals so
 * revenue never under-reports past the page size. numeric SUMs ride the wire
 * as strings; coerced to numbers here for formatting.
 */
const SalesSummarySchema = z.object({
  totalNetTzs: z.coerce.number(),
  totalGrossTzs: z.coerce.number(),
  count: z.coerce.number(),
  pendingCount: z.coerce.number(),
});

type SalesSummary = z.infer<typeof SalesSummarySchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function paymentStatusType(status: string): StatusType {
  if (status === 'paid') return 'success';
  if (status === 'pending') return 'pending';
  if (status === 'overdue') return 'error';
  return 'inactive';
}

/**
 * Resolve the wire `payment_status` token to a localized label — never the
 * raw enum token. An unrecognised value reads as a localized "Unknown".
 */
function paymentStatusLabel(status: string, locale: Locale): string {
  const entry =
    status in salesPaymentStatusLabels
      ? salesPaymentStatusLabels[status as keyof typeof salesPaymentStatusLabels]
      : salesUnknownLabel;
  return pickByLocale(locale, entry);
}

/**
 * Resolve the wire `route` token to a localized label — never the raw enum
 * token. An unrecognised value reads as a localized "Unknown".
 */
function saleRouteLabel(route: string, locale: Locale): string {
  const entry =
    route in saleRouteLabels
      ? saleRouteLabels[route as keyof typeof saleRouteLabels]
      : salesUnknownLabel;
  return pickByLocale(locale, entry);
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
      // `apiRequest` unwraps `{ success, data }` → the rows array. An
      // already-unwrapped array is honoured directly.
      const payload = Array.isArray(raw)
        ? raw
        : (raw as { data?: unknown })?.data;
      const parsed = z.array(SaleRowSchema).safeParse(payload);
      return parsed.success ? parsed.data : [];
    },
    staleTime: 60_000,
  });
}

/**
 * Whole-book KPI aggregate — a SEPARATE query so the SQL-folded totals survive
 * `apiRequest`'s envelope-unwrap (a `summary` sibling on the list envelope
 * would be stripped). The KPI strip reads these instead of folding the paged
 * rows, which under-reports revenue once a tenant crosses the page size.
 */
function useSalesSummary() {
  return useQuery({
    queryKey: ['mining', 'sales', 'summary'],
    queryFn: ({ signal }) =>
      apiRequest<unknown>('/api/v1/mining/sales/summary', { signal }),
    select: (raw): SalesSummary | null => {
      const payload =
        raw && typeof raw === 'object' && 'data' in raw
          ? (raw as { data: unknown }).data
          : raw;
      const parsed = SalesSummarySchema.safeParse(payload);
      return parsed.success ? parsed.data : null;
    },
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

interface SalesSurfaceProps {
  readonly initialLocale?: Locale;
}

export function SalesSurface({ initialLocale }: SalesSurfaceProps) {
  const locale = useLocale(initialLocale);
  const { data, isLoading, isError, error } = useSales();
  const { data: summaryData } = useSalesSummary();
  const sales = data ?? [];
  const summary = summaryData ?? null;

  const metrics = useMemo<readonly MetricTile[]>(() => {
    // KPI totals come from the SERVER aggregate (whole-book SUM over every
    // matching sale), NOT a fold over the paged rows — folding the ≤100/≤500
    // fetched rows under-reports revenue once a tenant crosses the page size.
    // When the aggregate is absent (legacy array response) fall back to the
    // paged fold so the strip still renders rather than showing nothing.
    const totalNet =
      summary?.totalNetTzs ??
      sales.reduce((sum, s) => sum + (s.netTzs ?? 0), 0);
    const totalGross =
      summary?.totalGrossTzs ??
      sales.reduce((sum, s) => sum + (s.grossPriceTzs ?? 0), 0);
    const totalCount = summary?.count ?? sales.length;
    const pending =
      summary?.pendingCount ??
      sales.filter((s) => s.paymentStatus === 'pending').length;
    return [
      {
        label: S.totalSalesLabel[locale],
        value: String(totalCount),
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
  }, [sales, summary, locale]);

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
          <p className="text-sm text-muted-foreground">{S.subtitle[locale]}</p>
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
        <div
          className="space-y-3"
          role="status"
          aria-label={S.loading[locale]}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl border border-border" />
          ))}
        </div>
      ) : null}

      {/* Error */}
      {isError ? (
        <Alert variant="error">
          {error instanceof ApiError
            ? localizeApiError(error, locale)
            : S.loadFailed[locale]}
        </Alert>
      ) : null}

      {/* Metrics (always render if data present) */}
      {!isLoading && !isError && sales.length > 0 ? (
        <MetricStrip tiles={metrics} cols={4} />
      ) : null}

      {/* Empty state */}
      {!isLoading && !isError && sales.length === 0 ? (
        <ScreenEmptyState
          icon={<Package className="h-6 w-6" />}
          title={S.emptyTitle[locale]}
          description={S.emptyBody[locale]}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/marketplace">
                <ArrowRight className="mr-1.5 h-3 w-3" />
                {S.openMarketplace[locale]}
              </Link>
            </Button>
          }
        />
      ) : null}

      {/* Transactions table */}
      {sales.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">
            {S.allTransactions[locale]}
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{S.colDate[locale]}</TableHead>
                <TableHead>{S.colParcel[locale]}</TableHead>
                <TableHead>{S.colRoute[locale]}</TableHead>
                <TableHead className="text-right">
                  {S.colGross(LAUNCH_CURRENCY)[locale]}
                </TableHead>
                <TableHead className="text-right">
                  {S.colNet(LAUNCH_CURRENCY)[locale]}
                </TableHead>
                <TableHead className="text-right">{S.colStatus[locale]}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtDateForLocale(row.ts, locale)}
                  </TableCell>
                  <TableCell>
                    <p className="font-mono text-xs text-foreground">
                      {row.parcelId.slice(0, 12)}…
                    </p>
                    {row.buyerId ? (
                      <p className="mt-0.5 font-mono text-tiny text-muted-foreground">
                        {S.buyerPrefix[locale]}: {row.buyerId.slice(0, 8)}…
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {saleRouteLabel(row.route, locale)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm text-muted-foreground">
                    {row.grossPriceTzs !== null
                      ? formatMoney(row.grossPriceTzs, LAUNCH_CURRENCY, locale)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm font-medium text-foreground">
                    {row.netTzs !== null
                      ? formatMoney(row.netTzs, LAUNCH_CURRENCY, locale)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge status={paymentStatusType(row.paymentStatus)}>
                      {paymentStatusLabel(row.paymentStatus, locale)}
                    </StatusBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}

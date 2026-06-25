'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Clock,
  Inbox,
  Star,
  TrendingUp,
} from 'lucide-react';
import { Skeleton, StatusBadge } from '@borjie/design-system';
import {
  useInboundRfbs,
  useMarketplaceListings,
} from '@/lib/queries/marketplace';
import { formatMoney, LAUNCH_CURRENCY } from '@/lib/format';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { BidsInbox } from '@/components/marketplace/BidsInbox';
import { dataBStrings as S } from '@/i18n/strings/data-b';
import { marketplaceBoardStrings as B } from '@/i18n/strings/marketplace-board';

interface MarketplaceBoardProps {
  readonly locale?: 'sw' | 'en';
  /**
   * Owner's REAL active-site coordinates. The inbound buyer-RFB column is
   * a geo-radius query keyed on the seller's centroid, so these MUST be
   * threaded from the resolved site (PostGIS POINT) — never defaulted to a
   * fabricated town centroid. When absent (no site location on record) the
   * inbound query stays disabled and the column renders an HONEST
   * "location not set" empty state rather than a made-up geofence.
   */
  readonly siteLat?: number;
  readonly siteLon?: number;
}

/**
 * Marketplace board — outbound (sell) + inbound (buy) twin columns
 * with a KPI strip on top.
 *
 * Outbound rows come from the live
 * `/api/v1/mining/marketplace/listings` endpoint via the
 * `useMarketplaceListings` query and surface LBMA grade + match
 * clock for each open parcel. Inbound rows come from the cross-tenant
 * geo-nearby RFB endpoint, keyed on the owner's real site coordinates.
 */
export function MarketplaceBoard({
  locale = 'en',
  siteLat,
  siteLon,
}: MarketplaceBoardProps): JSX.Element {
  const isSw = locale === 'sw';
  const query = useMarketplaceListings();
  const hasSiteLocation =
    siteLat != null &&
    siteLon != null &&
    Number.isFinite(siteLat) &&
    Number.isFinite(siteLon);
  // Pass NaN when no real coordinate is known so the hook's
  // `enabled: Number.isFinite(...)` guard keeps the inbound query OFF —
  // we never fabricate a centroid to force a result.
  const inboundQuery = useInboundRfbs(
    hasSiteLocation ? siteLat : Number.NaN,
    hasSiteLocation ? siteLon : Number.NaN,
  );
  const data = query.data;
  const inboundRfbs = inboundQuery.data ?? [];

  const metrics = useMemo<readonly MetricTile[]>(() => {
    if (!data) return [];
    const open = data.outbound.filter((o) => o.status === 'open').length;
    const matched = data.outbound.filter((o) => o.status === 'matched').length;
    const counters = data.outbound.filter((o) => o.status === 'counter').length;
    const avgUsd =
      data.outbound.length > 0
        ? data.outbound.reduce((acc, o) => acc + o.priceUsd, 0) /
          data.outbound.length
        : 0;
    return [
      {
        label: isSw ? S.mktMetricOpenLabel.sw : S.mktMetricOpenLabel.en,
        value: String(open),
        sub: isSw ? S.mktMetricOpenSub.sw : S.mktMetricOpenSub.en,
        icon: TrendingUp,
        tone: 'default' as const,
      },
      {
        label: isSw ? S.mktMetricMatchedLabel.sw : S.mktMetricMatchedLabel.en,
        value: String(matched),
        sub: isSw ? S.mktMetricMatchedSub.sw : S.mktMetricMatchedSub.en,
        icon: CheckCircle2,
        tone: matched > 0 ? ('success' as const) : ('default' as const),
      },
      {
        label: isSw ? S.mktMetricCounterLabel.sw : S.mktMetricCounterLabel.en,
        value: String(counters),
        sub: isSw ? S.mktMetricCounterSub.sw : S.mktMetricCounterSub.en,
        icon: Clock,
        tone: counters > 0 ? ('warning' as const) : ('default' as const),
      },
      {
        label: isSw ? S.mktMetricAvgLabel.sw : S.mktMetricAvgLabel.en,
        value: formatMoney(avgUsd, 'USD', locale),
        sub: isSw ? S.mktMetricAvgSub.sw : S.mktMetricAvgSub.en,
        icon: Star,
      },
    ];
  }, [data, isSw]);

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl border border-border" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-48 rounded-2xl border border-border" />
          <Skeleton className="h-48 rounded-2xl border border-border" />
        </div>
      </div>
    );
  }

  if (query.isError || !data) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        {isSw ? S.mktLoadError.sw : S.mktLoadError.en}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MetricStrip tiles={metrics} cols={4} />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {isSw ? S.mktOutboundTitle.sw : S.mktOutboundTitle.en}
              </h2>
              <p className="text-xs text-muted-foreground">
                {data.outbound.length}{' '}
                {isSw ? S.mktOutboundSubtitle.sw : S.mktOutboundSubtitle.en}
              </p>
            </div>
          </header>
          {data.outbound.length === 0 ? (
            <div className="px-5 py-6">
              <ScreenEmptyState
                icon={<TrendingUp className="h-6 w-6" />}
                title={isSw ? S.mktOutboundTitle.sw : S.mktOutboundTitle.en}
                description={isSw ? S.mktOutboundEmpty.sw : S.mktOutboundEmpty.en}
              />
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.outbound.map((o) => (
                <li
                  key={o.listing}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {o.listing}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{formatMoney(o.priceUsd, 'USD', locale)}</span>
                      <span className="rounded-full border border-border bg-background px-1.5 text-tiny">
                        LBMA
                      </span>
                    </div>
                  </div>
                  <StatusChip status={o.status} isSw={isSw} />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
          <header className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Inbox className="h-4 w-4 text-signal-500" />
                {isSw ? S.mktInboundTitle.sw : S.mktInboundTitle.en}
              </h2>
              <p className="text-xs text-muted-foreground">
                {inboundRfbs.length}{' '}
                {isSw ? S.mktInboundSubtitle.sw : S.mktInboundSubtitle.en}
              </p>
            </div>
          </header>
          {!hasSiteLocation ? (
            <div className="px-5 py-6">
              <ScreenEmptyState
                icon={<Inbox className="h-6 w-6" />}
                title={isSw ? B.inboundNoLocationTitle.sw : B.inboundNoLocationTitle.en}
                description={
                  isSw ? B.inboundNoLocationBody.sw : B.inboundNoLocationBody.en
                }
              />
            </div>
          ) : inboundQuery.isPending ? (
            <div className="space-y-3 px-5 py-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl border border-border" />
              ))}
            </div>
          ) : inboundQuery.isError ? (
            <p className="px-5 py-6 text-sm text-destructive">
              {isSw ? S.mktInboundError.sw : S.mktInboundError.en}
            </p>
          ) : inboundRfbs.length === 0 ? (
            <div className="px-5 py-6">
              <ScreenEmptyState
                icon={<Inbox className="h-6 w-6" />}
                title={isSw ? S.mktInboundTitle.sw : S.mktInboundTitle.en}
                description={isSw ? S.mktInboundEmpty.sw : S.mktInboundEmpty.en}
              />
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {inboundRfbs.map((rfb) => {
                const tonnage = Number(rfb.tonnageMin);
                const unitTzs = Number(rfb.unitPriceTzs);
                // The RFB row is TZS-denominated by schema (the `unit_price_tzs`
                // column), so the launch-primary code is passed as the currency
                // ARGUMENT — never a hardcoded `'TZS'` literal the regime can't
                // move. A future per-row currency would thread through here.
                const total =
                  Number.isFinite(tonnage) && Number.isFinite(unitTzs)
                    ? tonnage * unitTzs
                    : 0;
                const distance =
                  rfb.distanceKm != null && Number.isFinite(rfb.distanceKm)
                    ? `${rfb.distanceKm.toFixed(0)} km`
                    : isSw
                      ? S.mktDistanceUnknown.sw
                      : S.mktDistanceUnknown.en;
                return (
                  <li key={rfb.id}>
                    <Link
                      href={`/marketplace/inbound/${rfb.id}`}
                      className="flex items-start justify-between gap-3 px-5 py-3 transition-colors hover:bg-background/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {rfb.mineralKind} · {tonnage} t
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{formatMoney(total, LAUNCH_CURRENCY, locale)}</span>
                          <span className="rounded-full border border-border bg-background px-1.5 text-tiny">
                            {distance}
                          </span>
                        </div>
                        {rfb.notes ? (
                          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                            {rfb.notes}
                          </p>
                        ) : null}
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/40 bg-signal-500/10 px-2.5 py-0.5 text-badge font-medium text-signal-500">
                        <Clock className="h-3 w-3" />
                        {isSw ? S.mktChipNew.sw : S.mktChipNew.en}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Seller leg — the incoming-bids inbox. Buyers bid on the outbound
          listings above; those bids land here for the owner to accept (which
          crystallizes the binding offtake contract) or decline. */}
      <BidsInbox locale={locale} />
    </div>
  );
}

interface StatusChipProps {
  readonly status: string;
  readonly isSw: boolean;
}

function StatusChip({ status, isSw }: StatusChipProps) {
  const lower = status.toLowerCase();
  if (lower === 'matched') {
    return (
      <StatusBadge status="success">
        {isSw ? S.mktChipMatched.sw : S.mktChipMatched.en}
      </StatusBadge>
    );
  }
  if (lower === 'counter') {
    return (
      <StatusBadge status="warning">
        {isSw ? S.mktChipCounter.sw : S.mktChipCounter.en}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge status="pending">
      {isSw ? S.mktChipOpen.sw : S.mktChipOpen.en}
    </StatusBadge>
  );
}

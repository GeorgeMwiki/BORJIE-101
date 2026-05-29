'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Inbox,
  Star,
  TrendingUp,
} from 'lucide-react';
import {
  useInboundRfbs,
  useMarketplaceListings,
} from '@/lib/queries/marketplace';
import { fmtUsd } from '@/lib/format';
import { MetricStrip, type MetricTile } from '@/components/shared/MetricStrip';

interface MarketplaceBoardProps {
  readonly locale?: 'sw' | 'en';
  /**
   * Owner's site coordinates — RFBs within the seller's geo-radius
   * land in the inbound column. Defaults to Geita town centroid for
   * the mock session; the real owner-shell threads the active site's
   * coordinates here once the session shim is replaced.
   */
  readonly siteLat?: number;
  readonly siteLon?: number;
}

const GEITA_DEFAULT_LAT = -2.872;
const GEITA_DEFAULT_LON = 32.158;

function formatTzs(amount: number, isSw: boolean): string {
  const fmt = new Intl.NumberFormat(isSw ? 'sw-TZ' : 'en-US', {
    maximumFractionDigits: 0,
  });
  return `${fmt.format(amount)} TZS`;
}

/**
 * Marketplace board — outbound (sell) + inbound (buy) twin columns
 * with a KPI strip on top.
 *
 * Outbound rows come from the live
 * `/api/v1/mining/marketplace/listings` endpoint via the
 * `useMarketplaceListings` query and surface LBMA grade + match
 * clock for each open parcel. Inbound stays mock-only (no gateway
 * endpoint yet — LATER(#20), see KI-DEBT-003).
 */
export function MarketplaceBoard({
  locale = 'en',
  siteLat = GEITA_DEFAULT_LAT,
  siteLon = GEITA_DEFAULT_LON,
}: MarketplaceBoardProps): JSX.Element {
  const isSw = locale === 'sw';
  const query = useMarketplaceListings();
  const inboundQuery = useInboundRfbs(siteLat, siteLon);
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
        label: isSw ? 'Parcel zilizo wazi' : 'Open parcels',
        value: String(open),
        sub: isSw ? 'Zinatangaziwa kwenye soko' : 'Live on the board',
        icon: TrendingUp,
        tone: 'default' as const,
      },
      {
        label: isSw ? 'Imepatikana mnunuzi' : 'Matched buyers',
        value: String(matched),
        sub: isSw ? 'Tayari kwa malipo' : 'Ready for settlement',
        icon: CheckCircle2,
        tone: matched > 0 ? ('success' as const) : ('default' as const),
      },
      {
        label: isSw ? 'Counter zinasubiri' : 'Counter offers',
        value: String(counters),
        sub: isSw ? 'Zinahitaji uamuzi wako' : 'Need your call',
        icon: Clock,
        tone: counters > 0 ? ('warning' as const) : ('default' as const),
      },
      {
        label: isSw ? 'Wastani wa bei' : 'Average offer',
        value: fmtUsd(avgUsd),
        sub: isSw ? 'Per parcel ya leo' : 'Per parcel today',
        icon: Star,
      },
    ];
  }, [data, isSw]);

  if (query.isPending) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-border bg-surface/40"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-48 animate-pulse rounded-2xl border border-border bg-surface/40" />
          <div className="h-48 animate-pulse rounded-2xl border border-border bg-surface/40" />
        </div>
      </div>
    );
  }

  if (query.isError || !data) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        {isSw
          ? 'Imeshindwa kupakia orodha za soko. Geuza muunganisho au jaribu tena.'
          : 'Failed to load marketplace listings. Check the gateway and retry.'}
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
                {isSw ? 'Outbound — uuzaji' : 'Outbound (sell)'}
              </h2>
              <p className="text-xs text-neutral-400">
                {isSw
                  ? `${data.outbound.length} parcel zinazoangaliwa na wanunuzi`
                  : `${data.outbound.length} parcels visible to buyers`}
              </p>
            </div>
          </header>
          {data.outbound.length === 0 ? (
            <p className="px-5 py-6 text-sm text-neutral-500">
              {isSw ? 'Hakuna parcel iliyowekwa.' : 'No active outbound listings.'}
            </p>
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
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
                      <span className="font-mono">{fmtUsd(o.priceUsd)}</span>
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
                {isSw ? 'RFB za wanunuzi' : 'Inbound buyer RFBs'}
              </h2>
              <p className="text-xs text-neutral-400">
                {isSw
                  ? `${inboundRfbs.length} maombi ya wanunuzi karibu nawe`
                  : `${inboundRfbs.length} buyer requests within radius`}
              </p>
            </div>
          </header>
          {inboundQuery.isPending ? (
            <p className="px-5 py-6 text-sm text-neutral-500">
              {isSw ? 'Inapakia RFB…' : 'Loading RFBs…'}
            </p>
          ) : inboundQuery.isError ? (
            <p className="px-5 py-6 text-sm text-destructive">
              {isSw
                ? 'Imeshindwa kupata RFB za wanunuzi.'
                : 'Failed to load buyer RFBs.'}
            </p>
          ) : inboundRfbs.length === 0 ? (
            <p className="px-5 py-6 text-sm text-neutral-500">
              {isSw
                ? 'Hakuna maombi mapya ya wanunuzi sasa hivi.'
                : 'No new buyer requests right now.'}
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {inboundRfbs.map((rfb) => {
                const tonnage = Number(rfb.tonnageMin);
                const unitTzs = Number(rfb.unitPriceTzs);
                const totalTzs = Number.isFinite(tonnage * unitTzs)
                  ? tonnage * unitTzs
                  : 0;
                const distance =
                  rfb.distanceKm != null && Number.isFinite(rfb.distanceKm)
                    ? `${rfb.distanceKm.toFixed(0)} km`
                    : isSw
                      ? 'Mbali isiyojulikana'
                      : 'Distance unknown';
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
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-neutral-400">
                          <span className="font-mono">{formatTzs(totalTzs, isSw)}</span>
                          <span className="rounded-full border border-border bg-background px-1.5 text-tiny">
                            {distance}
                          </span>
                        </div>
                        {rfb.notes ? (
                          <p className="mt-1 line-clamp-1 text-xs text-neutral-500">
                            {rfb.notes}
                          </p>
                        ) : null}
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/40 bg-signal-500/10 px-2.5 py-0.5 text-badge font-medium text-signal-500">
                        <Clock className="h-3 w-3" />
                        {isSw ? 'Mpya' : 'New'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
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
      <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-badge font-medium text-success">
        <CheckCircle2 className="h-3 w-3" />
        {isSw ? 'Imepatana' : 'Matched'}
      </span>
    );
  }
  if (lower === 'counter') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-badge font-medium text-warning">
        <ArrowRight className="h-3 w-3" />
        Counter
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-info/40 bg-info/10 px-2.5 py-0.5 text-badge font-medium text-info">
      <Clock className="h-3 w-3" />
      {isSw ? 'Inasubiri' : 'Open'}
    </span>
  );
}

'use client';

import { SectionCard } from '@/components/shared/SectionCard';
import { useMarketplaceListings } from '@/lib/queries/marketplace';
import { fmtUsd } from '@/lib/format';

/**
 * Outbound listings + inbound services. Outbound rows come from the
 * live `/api/v1/mining/marketplace/listings` endpoint via the
 * `useMarketplaceListings` query; inbound stays mock-only (no
 * gateway endpoint yet — TODO).
 */
export function MarketplaceBoard(): JSX.Element {
  const query = useMarketplaceListings();
  const data = query.data;

  if (query.isPending) {
    return (
      <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
        <div className="h-32 animate-pulse rounded-lg border border-border bg-surface/40" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-surface/40" />
      </div>
    );
  }
  if (query.isError || !data) {
    return (
      <p className="px-8 py-6 text-sm text-destructive">
        Failed to load marketplace listings.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 px-8 py-6 md:grid-cols-2">
      <SectionCard title="Outbound (sell)">
        {data.outbound.length === 0 ? (
          <p className="text-xs text-neutral-500">No active outbound listings.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.outbound.map((o) => (
              <li
                key={o.listing}
                className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
              >
                <div>
                  <div className="text-foreground">{o.listing}</div>
                  <div className="text-xs text-neutral-500">{fmtUsd(o.priceUsd)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`pill ${o.status === 'open' ? 'pill-green' : 'pill-amber'}`}
                  >
                    {o.status}
                  </span>
                  {o.status === 'counter' ? (
                    <button
                      type="button"
                      className="rounded-md border border-warning bg-warning-subtle/30 px-2 py-0.5 text-xs text-warning hover:bg-warning-subtle/50"
                    >
                      Counter
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Inbound (buy)">
        <ul className="space-y-2 text-sm">
          {data.inbound.map((i) => (
            <li
              key={i.partner}
              className="rounded-md border border-border bg-background px-3 py-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-foreground">{i.partner}</span>
                <span className="text-xs text-neutral-400">{i.rating}</span>
              </div>
              <div className="text-xs text-neutral-500">{i.service}</div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

export const marketplaceKeys = {
  listings: () => ['marketplace', 'listings'] as const,
};

/**
 * Front-end shape for a marketplace listing.
 */
export interface OutboundListing {
  readonly listing: string;
  readonly priceUsd: number;
  readonly status: string;
}

export interface InboundPartner {
  readonly partner: string;
  readonly service: string;
  readonly rating: number;
}

export interface MarketplaceResult {
  readonly outbound: ReadonlyArray<OutboundListing>;
  readonly inbound: ReadonlyArray<InboundPartner>;
}

interface RawListing {
  readonly id?: string;
  readonly title?: string;
  readonly attributes?: Record<string, unknown>;
  readonly price?: { readonly currency?: string; readonly amount?: number };
  readonly status?: string;
}

function adaptListings(raw: unknown): MarketplaceResult {
  if (!Array.isArray(raw)) {
    return { outbound: [], inbound: [] };
  }
  const outbound: OutboundListing[] = [];
  for (const item of raw as ReadonlyArray<RawListing>) {
    const attrs = item.attributes ?? {};
    outbound.push({
      listing: item.title ?? (typeof attrs.mineral === 'string' ? attrs.mineral : item.id ?? '—'),
      priceUsd:
        item.price?.currency === 'USD' && typeof item.price.amount === 'number'
          ? item.price.amount
          : 0,
      status: item.status ?? 'open',
    });
  }
  // Inbound (services we buy) is not yet exposed by the gateway.
  return { outbound, inbound: [] };
}

/**
 * Marketplace listings.
 *
 * Live endpoint: GET /api/v1/mining/marketplace/listings
 * (services/api-gateway/src/routes/mining/marketplace.hono.ts).
 */
export function useMarketplaceListings() {
  return useQuery({
    queryKey: marketplaceKeys.listings(),
    queryFn: async ({ signal }): Promise<MarketplaceResult> => {
      const raw = await apiRequest<unknown>(
        '/api/v1/mining/marketplace/listings',
        { signal },
      );
      return adaptListings(raw);
    },
    staleTime: 60_000,
  });
}

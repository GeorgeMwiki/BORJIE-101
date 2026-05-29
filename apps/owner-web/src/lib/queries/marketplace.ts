'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';

export const marketplaceKeys = {
  listings: () => ['marketplace', 'listings'] as const,
  inboundRfbs: (lat: number, lon: number) =>
    ['marketplace', 'inbound-rfbs', lat, lon] as const,
  rfbDetail: (rfbId: string) => ['marketplace', 'rfb', rfbId] as const,
  rfbMine: () => ['marketplace', 'rfb', 'mine'] as const,
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

/**
 * Buyer-initiated RFB visible to the owner's tenant via the geo-nearby
 * predicate. Surfaces in the marketplace board's inbound column so the
 * owner can see fresh buyer demand and decide whether to respond.
 *
 * Backing endpoint: GET /api/v1/marketplace/rfb/nearby — see
 * services/api-gateway/src/routes/marketplace/rfb.hono.ts.
 */
export interface InboundRfb {
  readonly id: string;
  readonly mineralKind: string;
  readonly tonnageMin: string;
  readonly tonnageMax: string | null;
  readonly unitPriceTzs: string;
  readonly deliveryBy: string;
  readonly distanceKm: number | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
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

interface RawRfbRow {
  readonly id?: string;
  readonly mineral_kind?: string;
  readonly tonnage_min?: string;
  readonly tonnage_max?: string | null;
  readonly unit_price_tzs?: string;
  readonly delivery_by?: string;
  readonly distance_km?: number | null;
  readonly notes?: string | null;
  readonly created_at?: string;
  readonly expires_at?: string;
}

interface NearbyRfbsResponse {
  readonly success: boolean;
  readonly data?: { readonly rfbs?: ReadonlyArray<RawRfbRow> };
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

function adaptInboundRfbs(raw: NearbyRfbsResponse): ReadonlyArray<InboundRfb> {
  const rows = raw.data?.rfbs ?? [];
  return rows
    .filter((r): r is RawRfbRow & { id: string } => typeof r.id === 'string')
    .map((r) => ({
      id: r.id,
      mineralKind: r.mineral_kind ?? 'unknown',
      tonnageMin: r.tonnage_min ?? '0',
      tonnageMax: r.tonnage_max ?? null,
      unitPriceTzs: r.unit_price_tzs ?? '0',
      deliveryBy: r.delivery_by ?? '',
      distanceKm: r.distance_km ?? null,
      notes: r.notes ?? null,
      createdAt: r.created_at ?? '',
      expiresAt: r.expires_at ?? '',
    }));
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

/**
 * Buyer-initiated RFBs within the owner's geographic radius. Hits the
 * cross-tenant RFB nearby endpoint — buyers in any tenant looking for
 * minerals near the seller's coordinates land here.
 *
 * Note: the geo predicate is server-side; the owner's coordinates are
 * passed as query params. Roadmap: surface a tenant-level default
 * coordinate from the active site so this hook auto-resolves.
 */
export function useInboundRfbs(lat: number, lon: number) {
  return useQuery({
    queryKey: marketplaceKeys.inboundRfbs(lat, lon),
    queryFn: async ({ signal }): Promise<ReadonlyArray<InboundRfb>> => {
      const raw = await apiRequest<NearbyRfbsResponse>(
        `/api/v1/marketplace/rfb/nearby?lat=${lat}&lon=${lon}&limit=20`,
        { signal },
      );
      return adaptInboundRfbs(raw);
    },
    // Inbound demand changes faster than outbound listings — keep the
    // cache tight so a new RFB from the cockpit SSE feed re-fetches
    // promptly on next focus.
    staleTime: 15_000,
    enabled: Number.isFinite(lat) && Number.isFinite(lon),
  });
}

// ─────────────────────────────────────────────────────────────────────
// Commercial chain L3 — owner dispatches a buyer RFB to a manager.
// ─────────────────────────────────────────────────────────────────────

export interface DispatchRfbInput {
  readonly rfbId: string;
  readonly managerId: string;
  readonly siteId: string;
  readonly dueAt?: string | null;
  readonly titleEn?: string | null;
  readonly titleSw?: string | null;
}

export interface DispatchRfbResult {
  readonly taskId: string;
  readonly rfbId: string;
  readonly managerId: string;
  readonly siteId: string;
  readonly createdAt: string;
}

interface DispatchResponse {
  readonly success: boolean;
  readonly data?: {
    readonly taskId?: string;
    readonly rfbId?: string;
    readonly managerId?: string;
    readonly siteId?: string;
    readonly createdAt?: string;
  };
}

/**
 * Dispatch an inbound buyer RFB to a manager at a site.
 *
 * Hits POST /api/v1/marketplace/rfb/:id/dispatch which atomically:
 *   - re-confirms the RFB belongs to the owner's tenant and is `open`,
 *   - INSERTs a `mining_tasks` row with kind='rfb_fulfill' +
 *     parent_rfb_id pointing back at the RFB,
 *   - emits a cockpit SSE event.
 *
 * On success the inbound RFB list is invalidated so the marketplace
 * board reflects the moved row immediately.
 */
export function useDispatchRfbToManager() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DispatchRfbInput): Promise<DispatchRfbResult> => {
      const res = await apiRequest<DispatchResponse>(
        `/api/v1/marketplace/rfb/${encodeURIComponent(input.rfbId)}/dispatch`,
        {
          method: 'POST',
          body: {
            managerId: input.managerId,
            siteId: input.siteId,
            ...(input.dueAt ? { dueAt: input.dueAt } : {}),
            ...(input.titleEn ? { titleEn: input.titleEn } : {}),
            ...(input.titleSw ? { titleSw: input.titleSw } : {}),
          },
        },
      );
      const data = res.data ?? {};
      return {
        taskId: String(data.taskId ?? ''),
        rfbId: String(data.rfbId ?? input.rfbId),
        managerId: String(data.managerId ?? input.managerId),
        siteId: String(data.siteId ?? input.siteId),
        createdAt: String(data.createdAt ?? ''),
      };
    },
    onSuccess: () => {
      // Refresh the inbound RFB column + marketplace listings.
      queryClient.invalidateQueries({ queryKey: ['marketplace'] });
    },
  });
}

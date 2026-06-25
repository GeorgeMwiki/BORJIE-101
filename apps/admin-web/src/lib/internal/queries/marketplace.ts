/**
 * react-query bindings for /api/v1/mining/internal/marketplace (AD-3).
 *
 * Live endpoints (services/api-gateway/src/routes/mining/internal/marketplace.hono.ts):
 *   GET  /              moderation queue — real `marketplace_listings` rows
 *   POST /:id/hide      active|paused → removed   (take down)
 *   POST /:id/restore   removed       → active    (reinstate)
 *
 * Live-only: failures propagate to react-query's `error` channel. There is
 * no mock fallback — the admin surface renders an empty state when the
 * gateway is unreachable.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, toApiError, unwrap } from '@/lib/api-client';

const MARKETPLACE_KEY = ['internal', 'marketplace-listings'] as const;

/** UI-facing moderation status. `removed` listings render as Hidden. */
export type ListingStatus = 'Live' | 'Paused' | 'Hidden' | 'Sold' | 'Expired';

export interface ModerationListing {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly category: string;
  readonly status: ListingStatus;
  readonly visibility: string;
  readonly createdAt: string;
}

interface MarketplaceResult {
  readonly rows: ReadonlyArray<ModerationListing>;
  readonly source: 'live';
}

interface RawListing {
  readonly id?: string;
  readonly tenantId?: string;
  readonly title?: string;
  readonly category?: string;
  readonly status?: string;
  readonly visibility?: string;
  readonly createdAt?: string;
}

function statusFromRaw(raw: string | undefined): ListingStatus {
  switch (raw) {
    case 'active':
      return 'Live';
    case 'paused':
      return 'Paused';
    case 'removed':
      return 'Hidden';
    case 'sold':
      return 'Sold';
    case 'expired':
      return 'Expired';
    default:
      return 'Live';
  }
}

function adaptListing(raw: RawListing): ModerationListing {
  return {
    id: raw.id ?? '',
    tenantId: raw.tenantId ?? '',
    title: raw.title ?? '(untitled listing)',
    category: raw.category ?? 'unknown',
    status: statusFromRaw(raw.status),
    visibility: raw.visibility ?? 'tanzania',
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
  };
}

export function useMarketplaceListingsQuery() {
  return useQuery({
    queryKey: MARKETPLACE_KEY,
    queryFn: async (): Promise<MarketplaceResult> => {
      const res = await apiClient.get<ReadonlyArray<RawListing>>('/marketplace');
      if (!res.ok) throw toApiError(res);
      return { rows: res.data.map(adaptListing), source: 'live' };
    },
  });
}

interface ModerateInput {
  readonly id: string;
  /** 'hide' → removed; 'restore' → active. */
  readonly action: 'hide' | 'restore';
}

export function useModerateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: ModerateInput): Promise<ModerationListing> => {
      const res = await apiClient.post<RawListing>(`/marketplace/${id}/${action}`, {});
      return adaptListing(unwrap(res));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: MARKETPLACE_KEY }),
  });
}

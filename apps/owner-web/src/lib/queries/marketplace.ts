'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api-client';
import { LAUNCH_CURRENCY } from '@/lib/format';

export const marketplaceKeys = {
  listings: () => ['marketplace', 'listings'] as const,
  inboundRfbs: (lat: number, lon: number) =>
    ['marketplace', 'inbound-rfbs', lat, lon] as const,
  rfbDetail: (rfbId: string) => ['marketplace', 'rfb', rfbId] as const,
  rfbMine: () => ['marketplace', 'rfb', 'mine'] as const,
  incomingBids: (status?: string) =>
    ['marketplace', 'bids', 'incoming', status ?? 'all'] as const,
  offtakeAgreements: (status?: string) =>
    ['marketplace', 'offtake-agreements', status ?? 'all'] as const,
};

/**
 * Front-end shape for a marketplace listing.
 *
 * MONEY CANON: the `marketplace_listings` row is TZS-denominated by schema
 * (the `price_tzs` numeric column → a numeric STRING on the wire) and carries
 * NO per-row ISO currency code. So the adapter parses that string into
 * `price` and carries a `currencyCode` that defaults to the launch-primary
 * code (`LAUNCH_CURRENCY`) — the code is DATA threaded to `formatMoney`, never
 * a hardcoded `'USD'`/`'TZS'` display literal. A future per-row currency
 * column threads through this same field with zero render change.
 */
export interface OutboundListing {
  readonly listing: string;
  readonly price: number;
  readonly currencyCode: string;
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

/**
 * Raw listing row as the gateway returns it (GET
 * /api/v1/mining/marketplace/listings → `{ ...marketplaceListings, ... }`
 * spread flat). The price arrives as `priceTzs`: a numeric STRING (Drizzle
 * `numeric` column) or null. There is NO nested `price` object and NO ISO
 * currency-code column on the row — the schema is TZS-denominated.
 */
interface RawListing {
  readonly id?: string;
  readonly title?: string;
  readonly attributes?: Record<string, unknown>;
  readonly priceTzs?: string | number | null;
  readonly currencyCode?: string | null;
  readonly status?: string;
}

/** Parse a numeric wire value (string | number | null) to a finite number. */
function toFinitePrice(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
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
    // The row carries no ISO currency code (TZS-denominated by schema), so
    // default to the launch-primary code as DATA — a KE/UG/NG tenant threading
    // an explicit `currencyCode` renders its own currency with zero change.
    const currencyCode =
      typeof item.currencyCode === 'string' && item.currencyCode.length > 0
        ? item.currencyCode
        : LAUNCH_CURRENCY;
    outbound.push({
      listing: item.title ?? (typeof attrs.mineral === 'string' ? attrs.mineral : item.id ?? '—'),
      price: toFinitePrice(item.priceTzs),
      currencyCode,
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

// ─────────────────────────────────────────────────────────────────────
// SELLER LEG — incoming bids inbox + accept / reject + offtake ledger.
//
// COMPLETION-LAW: the gateway already exposes the seller-side surface;
// these hooks wire the owner cockpit to it.
//   - GET  /api/v1/mining/bids/incoming               (bids on my listings)
//   - POST /api/v1/mining/bids/:id/accept             (seller accepts)
//   - POST /api/v1/mining/bids/:id/reject             (seller rejects)
//   - GET  /api/v1/mining/bids/offtake-agreements     (binding contracts)
// See services/api-gateway/src/routes/mining/bids.hono.ts.
// ─────────────────────────────────────────────────────────────────────

/** A bid placed by a buyer on one of the owner's listings (seller view). */
export interface IncomingBid {
  readonly id: string;
  readonly listingId: string;
  readonly buyerId: string;
  /** Bid price in TZS (the `bid_price_tzs` column — numeric string on wire). */
  readonly bidPriceTzs: number;
  readonly status:
    | 'pending'
    | 'accepted'
    | 'rejected'
    | 'countered'
    | 'withdrawn';
  readonly paymentTerms: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
}

/** Raw seller-bid row as the gateway returns it (snake_case DB columns). */
// camelCase = canonical: GET /mining/bids/incoming returns raw Drizzle rows
// (db.select().from(marketplaceBids)) which serialize to JS field names —
// reading snake_case ALONE silently zeroed bidPriceTzs / emptied the seller
// BidsInbox (the producer/consumer casing seam, same class as adaptOfftake).
// snake_case kept as a defensive fallback.
export interface RawIncomingBidRow {
  readonly id?: string;
  readonly listingId?: string;
  readonly listing_id?: string;
  readonly buyerId?: string;
  readonly buyer_id?: string;
  readonly bidPriceTzs?: string | number | null;
  readonly bid_price_tzs?: string | number | null;
  readonly status?: string;
  readonly paymentTerms?: string | null;
  readonly payment_terms?: string | null;
  readonly notes?: string | null;
  readonly createdAt?: string;
  readonly created_at?: string;
}

const INCOMING_BID_STATUSES = new Set<IncomingBid['status']>([
  'pending',
  'accepted',
  'rejected',
  'countered',
  'withdrawn',
]);

export function adaptIncomingBid(row: RawIncomingBidRow): IncomingBid | null {
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  const status =
    typeof row.status === 'string' &&
    INCOMING_BID_STATUSES.has(row.status as IncomingBid['status'])
      ? (row.status as IncomingBid['status'])
      : 'pending';
  const priceRaw = row.bidPriceTzs ?? row.bid_price_tzs;
  const bidPriceTzs =
    priceRaw == null
      ? 0
      : typeof priceRaw === 'number'
        ? priceRaw
        : Number(priceRaw);
  return {
    id: row.id,
    listingId: firstString(row.listingId, row.listing_id) ?? '',
    buyerId: firstString(row.buyerId, row.buyer_id) ?? '',
    bidPriceTzs: Number.isFinite(bidPriceTzs) ? bidPriceTzs : 0,
    status,
    paymentTerms: firstString(row.paymentTerms, row.payment_terms),
    notes: row.notes ?? null,
    createdAt: firstString(row.createdAt, row.created_at) ?? '',
  };
}

/**
 * Incoming bids on the owner's marketplace listings (seller-side).
 *
 * `status` optionally narrows the server query (e.g. `'pending'` for the
 * action inbox). The gateway returns raw `marketplace_bids` rows already
 * scoped to the seller tenant by RLS.
 */
export function useIncomingBids(status?: IncomingBid['status']) {
  return useQuery({
    queryKey: marketplaceKeys.incomingBids(status),
    queryFn: async ({ signal }): Promise<ReadonlyArray<IncomingBid>> => {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      const rows = await apiRequest<ReadonlyArray<RawIncomingBidRow>>(
        `/api/v1/mining/bids/incoming${qs}`,
        { signal },
      );
      return (rows ?? [])
        .map(adaptIncomingBid)
        .filter((b): b is IncomingBid => b !== null);
    },
    // Bids land via the cockpit SSE `bid.placed` pulse — keep the cache tight
    // so the inbox refreshes promptly on next focus after a new bid.
    staleTime: 15_000,
  });
}

/**
 * Accept an incoming bid. The gateway flips the bid to `accepted` AND
 * crystallizes the binding offtake agreement in one transaction, so on
 * success we invalidate BOTH the bids inbox and the offtake ledger.
 */
export function useAcceptBid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (bidId: string): Promise<void> => {
      await apiRequest<unknown>(
        `/api/v1/mining/bids/${encodeURIComponent(bidId)}/accept`,
        { method: 'POST' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplace'] });
    },
  });
}

/** Reject an incoming bid with a localized reason captured by the caller. */
export function useRejectBid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly bidId: string;
      readonly reason: string;
    }): Promise<void> => {
      await apiRequest<unknown>(
        `/api/v1/mining/bids/${encodeURIComponent(input.bidId)}/reject`,
        { method: 'POST', body: { reason: input.reason } },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplace'] });
    },
  });
}

/** A binding offtake agreement crystallized from an accepted bid. */
export interface OfftakeAgreement {
  readonly id: string;
  readonly listingId: string;
  readonly bidId: string;
  readonly buyerId: string;
  /** CONTRACT TERM — agreed price in TZS (never a ledger entry). */
  readonly agreedPriceTzs: number;
  /** CONTRACT TERM — agreed volume in kg. */
  readonly quantityKg: number;
  readonly paymentTerms: string | null;
  readonly status:
    | 'pending_signature'
    | 'signed'
    | 'cancelled'
    | 'completed';
  readonly signedAt: string | null;
  readonly createdAt: string;
}

/**
 * Raw offtake row as it arrives over the wire.
 *
 * WIRE SHAPE: the gateway (GET /api/v1/mining/bids/offtake-agreements) returns
 * Drizzle rows selected from the table object, so the keys are the JS field
 * names (camelCase: `agreedPriceTzs`, `quantityKg`, `paymentTerms`, `bidId`,
 * `listingId`, `signedAt`, `createdAt` — confirmed by the gateway contract test
 * services/api-gateway/.../offtake-crystallization.test.ts asserting
 * `body.data[0].bidId`). We read camelCase as CANONICAL and fall back to
 * snake_case DEFENSIVELY — same adapter discipline as the buyer leg in
 * apps/buyer-mobile/src/api/offtake.ts. Reading snake_case alone silently
 * zeroes the money/volume terms (the casing seam this shape closes).
 */
export interface RawOfftakeRow {
  readonly id?: string;
  readonly listingId?: string;
  readonly listing_id?: string;
  readonly bidId?: string;
  readonly bid_id?: string;
  readonly buyerId?: string;
  readonly buyer_id?: string;
  readonly agreedPriceTzs?: string | number | null;
  readonly agreed_price_tzs?: string | number | null;
  readonly quantityKg?: string | number | null;
  readonly quantity_kg?: string | number | null;
  readonly paymentTerms?: string | null;
  readonly payment_terms?: string | null;
  readonly status?: string;
  readonly signedAt?: string | null;
  readonly signed_at?: string | null;
  readonly createdAt?: string;
  readonly created_at?: string;
}

const OFFTAKE_STATUSES = new Set<OfftakeAgreement['status']>([
  'pending_signature',
  'signed',
  'cancelled',
  'completed',
]);

function toFiniteNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** First defined string among the candidates (camelCase canonical first). */
function firstString(
  ...values: ReadonlyArray<string | null | undefined>
): string | null {
  for (const v of values) {
    if (typeof v === 'string') return v;
  }
  return null;
}

/**
 * Adapt a raw wire row → typed agreement. Reads camelCase as CANONICAL with
 * snake_case as a DEFENSIVE fallback (`?? ` / firstString): the gateway
 * serializes Drizzle rows as camelCase, so reading snake_case alone silently
 * zeroes `agreedPriceTzs` / `quantityKg` and blanks `paymentTerms` — the casing
 * seam this adapter closes. Mirrors apps/buyer-mobile/src/api/offtake.ts.
 */
export function adaptOfftake(row: RawOfftakeRow): OfftakeAgreement | null {
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  const status =
    typeof row.status === 'string' &&
    OFFTAKE_STATUSES.has(row.status as OfftakeAgreement['status'])
      ? (row.status as OfftakeAgreement['status'])
      : 'pending_signature';
  return {
    id: row.id,
    listingId: firstString(row.listingId, row.listing_id) ?? '',
    bidId: firstString(row.bidId, row.bid_id) ?? '',
    buyerId: firstString(row.buyerId, row.buyer_id) ?? '',
    agreedPriceTzs: toFiniteNumber(row.agreedPriceTzs ?? row.agreed_price_tzs),
    quantityKg: toFiniteNumber(row.quantityKg ?? row.quantity_kg),
    paymentTerms: firstString(row.paymentTerms, row.payment_terms),
    status,
    signedAt: firstString(row.signedAt, row.signed_at),
    createdAt: firstString(row.createdAt, row.created_at) ?? '',
  };
}

/**
 * Seller-side binding offtake agreements — the contract ledger surfacing
 * `pending_signature` vs `signed` (and terminal) states.
 *
 * Backing endpoint: GET /api/v1/mining/bids/offtake-agreements.
 */
export function useOfftakeAgreements(status?: OfftakeAgreement['status']) {
  return useQuery({
    queryKey: marketplaceKeys.offtakeAgreements(status),
    queryFn: async ({ signal }): Promise<ReadonlyArray<OfftakeAgreement>> => {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      const rows = await apiRequest<ReadonlyArray<RawOfftakeRow>>(
        `/api/v1/mining/bids/offtake-agreements${qs}`,
        { signal },
      );
      return (rows ?? [])
        .map(adaptOfftake)
        .filter((a): a is OfftakeAgreement => a !== null);
    },
    staleTime: 30_000,
  });
}

/**
 * Sign a `pending_signature` offtake agreement — the COMPLETION-LAW leg that
 * advances the contract to `signed` AND enqueues settlement.
 *
 * Hits POST /api/v1/mining/bids/offtake-agreements/:id/sign — the SOLE path
 * that writes a `settlement.requested` row into the transactional
 * `event_outbox` (in the same transaction as the status flip), so the
 * settlement worker can consume it via `LedgerService.post()` (money never
 * moves from this surface; the contract table holds contract terms only).
 * The gateway is idempotent: re-signing a signed contract returns it
 * unchanged and never enqueues a second settlement.
 *
 * On success both the offtake ledger and the bids inbox are invalidated so
 * the row's terminal `signed` state paints immediately. The caller wires the
 * localized error path (`localizeError` by stable code) — never a raw English
 * message — so a failed signature is a recoverable, single-locale dead-end,
 * never a silent no-op.
 */
export function useSignOfftake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (agreementId: string): Promise<void> => {
      await apiRequest<unknown>(
        `/api/v1/mining/bids/offtake-agreements/${encodeURIComponent(
          agreementId,
        )}/sign`,
        { method: 'POST' },
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketplace'] });
    },
  });
}

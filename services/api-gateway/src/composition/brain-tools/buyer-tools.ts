/**
 * Buyer persona — T5 customer-concierge tools (mineral buyers).
 *
 * Seven tools backing the buyer-mobile chat home:
 *   - Marketplace search + listing detail
 *   - Place / cancel / list-mine bids
 *   - KYC progress + chunked upload-atom (WRITE)
 *
 * All persona-gated to `T5_customer_concierge`. The KYC upload-atom is
 * the only chunked-upload WRITE; it forwards a single chunk to the KYC
 * service, which assembles the full document downstream.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';
import { withChatProvenance } from './provenance-injector';

const BUYER: ReadonlyArray<'T5_customer_concierge'> = ['T5_customer_concierge'];

// 1. Marketplace search
const MarketSearchInput = z.object({
  mineral: z.enum(['gold', 'copper', 'tanzanite', 'any']).default('any'),
  minWeightGrams: z.number().nonnegative().optional(),
  maxPriceTzs: z.number().positive().optional(),
  limit: z.number().int().positive().max(50).default(20),
});
const MarketSearchOutput = z.object({
  listings: z.array(
    z.object({
      parcelId: z.string(),
      mineral: z.string(),
      weightGrams: z.number(),
      askingPrice: z.number(),
      currency: z.string(),
      listedAt: z.string(),
    }),
  ),
  totalListings: z.number().int().nonnegative(),
});
export const buyerMarketSearchTool: PersonaToolDescriptor<
  typeof MarketSearchInput,
  typeof MarketSearchOutput
> = {
  id: 'mining.marketplace.search',
  name: 'Buyer — marketplace search',
  description: 'Search active marketplace parcels by mineral, weight, and price.',
  personaSlugs: BUYER,
  inputSchema: MarketSearchInput,
  outputSchema: MarketSearchOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { listings: [], totalListings: 0 };
    return client.get<{ listings: Array<{ parcelId: string; mineral: string; weightGrams: number; askingPrice: number; currency: string; listedAt: string }>; totalListings: number }>(
      '/mining/marketplace/listings',
      {
        query: {
          tenantId: ctx.tenantId,
          mineral: input.mineral,
          minWeightGrams: input.minWeightGrams,
          maxPriceTzs: input.maxPriceTzs,
          limit: input.limit,
        },
      },
    );
  },
};

// 2. Listing detail
const ListingDetailInput = z.object({
  parcelId: z.string().min(1),
});
const ListingDetailOutput = z.object({
  parcelId: z.string(),
  mineral: z.string(),
  weightGrams: z.number(),
  askingPrice: z.number(),
  currency: z.string(),
  origin: z.object({
    siteId: z.string(),
    region: z.string().optional(),
  }),
  assays: z.array(
    z.object({
      assayId: z.string(),
      report: z.string(),
      generatedAt: z.string(),
    }),
  ),
  bidCount: z.number().int().nonnegative(),
});
export const buyerListingDetailTool: PersonaToolDescriptor<
  typeof ListingDetailInput,
  typeof ListingDetailOutput
> = {
  id: 'mining.marketplace.listing-detail',
  name: 'Buyer — listing detail',
  description: 'Full detail for one marketplace parcel including assays and bid count.',
  personaSlugs: BUYER,
  inputSchema: ListingDetailInput,
  outputSchema: ListingDetailOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        parcelId: input.parcelId,
        mineral: 'unknown',
        weightGrams: 0,
        askingPrice: 0,
        currency: 'TZS',
        origin: { siteId: 'unknown' },
        assays: [],
        bidCount: 0,
      };
    }
    return client.get<{ parcelId: string; mineral: string; weightGrams: number; askingPrice: number; currency: string; origin: { siteId: string; region?: string }; assays: Array<{ assayId: string; report: string; generatedAt: string }>; bidCount: number }>(
      `/mining/marketplace/listings/${encodeURIComponent(input.parcelId)}`,
      { query: { tenantId: ctx.tenantId } },
    );
  },
};

// 3. Place bid (WRITE)
const PlaceBidInput = z.object({
  parcelId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3),
});
const PlaceBidOutput = z.object({
  bidId: z.string(),
  placedAt: z.string(),
  status: z.enum(['active', 'rejected']),
});
export const buyerPlaceBidTool: PersonaToolDescriptor<
  typeof PlaceBidInput,
  typeof PlaceBidOutput
> = {
  id: 'mining.bids.place',
  name: 'Buyer — place bid',
  description: 'Place a bid on a marketplace parcel. Audit-tracked.',
  personaSlugs: BUYER,
  inputSchema: PlaceBidInput,
  outputSchema: PlaceBidOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        bidId: `pending:${ctx.actorId}`,
        placedAt: new Date().toISOString(),
        status: 'rejected' as const,
      };
    }
    // Retarget: canonical surface is POST /api/v1/mining/bids
    // (services/api-gateway/src/routes/mining/bids.hono.ts). The route
    // resolves the calling user's KYC'd `buyers` row, validates the
    // listing tenant matches, and persists the row in marketplace_bids.
    const res = await client.post<{
      data?: { id?: string; status?: string; created_at?: string };
    }>(
      '/mining/bids',
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          listingId: input.parcelId,
          bidPriceTzs: input.amount,
          paymentTerms: 'cash',
        },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      bidId: String(row.id ?? `pending:${ctx.actorId}`),
      placedAt: String(row.created_at ?? new Date().toISOString()),
      status:
        row.status === 'pending'
          ? ('active' as const)
          : ('rejected' as const),
    };
  },
};

// 4. My bids
const MyBidsInput = z.object({
  status: z.enum(['active', 'won', 'lost', 'withdrawn', 'all']).default('active'),
});
const MyBidsOutput = z.object({
  bids: z.array(
    z.object({
      bidId: z.string(),
      parcelId: z.string(),
      amount: z.number(),
      currency: z.string(),
      placedAt: z.string(),
      status: z.enum(['active', 'won', 'lost', 'withdrawn']),
    }),
  ),
});
export const buyerMyBidsTool: PersonaToolDescriptor<typeof MyBidsInput, typeof MyBidsOutput> = {
  id: 'mining.bids.mine',
  name: 'Buyer — my bids',
  description: 'List bids placed by the calling buyer, optionally filtered by status.',
  personaSlugs: BUYER,
  inputSchema: MyBidsInput,
  outputSchema: MyBidsOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { bids: [] };
    // Retarget: canonical surface is GET /api/v1/mining/bids/mine
    // (buyer-side projection of marketplace_bids — added in this same
    // sweep). The route resolves buyers.linked_user_id automatically.
    const res = await client.get<{
      data?: Array<Record<string, unknown>>;
    }>('/mining/bids/mine', {
      query: { status: input.status === 'all' ? undefined : input.status },
    });
    const rows = res.data ?? [];
    const statusMap: Record<string, 'active' | 'won' | 'lost' | 'withdrawn'> = {
      pending: 'active',
      accepted: 'won',
      rejected: 'lost',
      withdrawn: 'withdrawn',
      countered: 'active',
    };
    return {
      bids: rows.map((r) => ({
        bidId: String(r.id ?? ''),
        parcelId: String(r.listing_id ?? r.listingId ?? ''),
        amount: Number(r.bid_price_tzs ?? r.bidPriceTzs ?? 0),
        currency: 'TZS',
        placedAt: String(r.created_at ?? r.createdAt ?? new Date().toISOString()),
        status: statusMap[String(r.status)] ?? ('active' as const),
      })),
    };
  },
};

// 5. Cancel bid (WRITE)
const CancelBidInput = z.object({
  bidId: z.string().min(1),
  reasonEn: z.string().max(2000).optional(),
});
const CancelBidOutput = z.object({
  bidId: z.string(),
  withdrawnAt: z.string(),
});
export const buyerCancelBidTool: PersonaToolDescriptor<
  typeof CancelBidInput,
  typeof CancelBidOutput
> = {
  id: 'mining.bids.cancel',
  name: 'Buyer — cancel bid',
  description: 'Withdraw a previously-placed bid. Audit-tracked.',
  personaSlugs: BUYER,
  inputSchema: CancelBidInput,
  outputSchema: CancelBidOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { bidId: input.bidId, withdrawnAt: new Date().toISOString() };
    }
    // Retarget: canonical surface is POST /api/v1/mining/bids/:id/withdraw
    // (buyer-side cancellation — added in this same sweep). The route
    // refuses unless the calling user owns the bid.
    const res = await client.post<{ data?: { id?: string; updated_at?: string } }>(
      `/mining/bids/${encodeURIComponent(input.bidId)}/withdraw`,
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          reason: input.reasonEn,
        },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      bidId: String(row.id ?? input.bidId),
      withdrawnAt: String(row.updated_at ?? new Date().toISOString()),
    };
  },
};

// 6. KYC status
const KycStatusInput = z.object({});
const KycStatusOutput = z.object({
  tier: z.enum(['unverified', 'tier1', 'tier2', 'tier3']),
  pendingSteps: z.array(z.string()),
  approvedAt: z.string().optional(),
});
export const buyerKycStatusTool: PersonaToolDescriptor<
  typeof KycStatusInput,
  typeof KycStatusOutput
> = {
  id: 'mining.buyers.kyc.status',
  name: 'Buyer — KYC status',
  description: 'Current KYC tier and remaining steps for the calling buyer.',
  personaSlugs: BUYER,
  inputSchema: KycStatusInput,
  outputSchema: KycStatusOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { tier: 'unverified' as const, pendingSteps: [] };
    // Retarget: canonical surface is GET /api/v1/mining/buyers/kyc/me
    // which auto-resolves the buyers row by linked_user_id. Returns
    // 404 when KYC has not been submitted; the brain tool treats that
    // as the literal `unverified` tier.
    try {
      const res = await client.get<{
        data?: { kycStatus?: string; attributes?: Record<string, unknown> };
      }>('/mining/buyers/kyc/me');
      const status = String(res.data?.kycStatus ?? 'pending');
      const tierMap: Record<
        string,
        'unverified' | 'tier1' | 'tier2' | 'tier3'
      > = {
        pending: 'unverified',
        in_review: 'tier1',
        verified: 'tier3',
        rejected: 'unverified',
      };
      return {
        tier: tierMap[status] ?? ('unverified' as const),
        pendingSteps: status === 'in_review' ? ['nida', 'tin', 'aml'] : [],
      };
    } catch {
      // 404 = no KYC submitted yet — surface as unverified to the brain.
      return { tier: 'unverified' as const, pendingSteps: ['kyc_submit'] };
    }
  },
};

// 7. KYC upload atom (WRITE — chunked)
const KycAtomInput = z.object({
  sessionId: z.string().min(1),
  chunkIndex: z.number().int().nonnegative(),
  chunkBase64: z.string().min(1).max(2_000_000),
  isLast: z.boolean().default(false),
});
const KycAtomOutput = z.object({
  sessionId: z.string(),
  chunkIndex: z.number().int(),
  acceptedAt: z.string(),
  assembled: z.boolean(),
});
export const buyerKycUploadAtomTool: PersonaToolDescriptor<
  typeof KycAtomInput,
  typeof KycAtomOutput
> = {
  id: 'mining.buyers.kyc.upload-atom',
  name: 'Buyer — KYC upload chunk',
  description:
    'Upload one chunk of a KYC document. Assembly happens server-side after the ' +
    'final chunk (`isLast: true`) is accepted.',
  personaSlugs: BUYER,
  inputSchema: KycAtomInput,
  outputSchema: KycAtomOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        sessionId: input.sessionId,
        chunkIndex: input.chunkIndex,
        acceptedAt: new Date().toISOString(),
        assembled: false,
      };
    }
    // Canonical surface: POST /api/v1/mining/buyers/kyc/upload-atom
    // (services/api-gateway/src/routes/mining/buyers-kyc.hono.ts — added
    // in this same sweep). The route persists the chunk under the
    // buyer's attributes.kycChunks; the chat brain forwards the chunk
    // as-is so assembly stays server-side.
    const res = await client.post<{
      data?: {
        sessionId?: string;
        chunkIndex?: number;
        acceptedAt?: string;
        assembled?: boolean;
      };
    }>(
      '/mining/buyers/kyc/upload-atom',
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          sessionId: input.sessionId,
          chunkIndex: input.chunkIndex,
          chunkBase64: input.chunkBase64,
          isLast: input.isLast,
        },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      sessionId: String(row.sessionId ?? input.sessionId),
      chunkIndex: Number(row.chunkIndex ?? input.chunkIndex),
      acceptedAt: String(row.acceptedAt ?? new Date().toISOString()),
      assembled: Boolean(row.assembled ?? false),
    };
  },
};

// 8. Market intel (LBMA fix + benchmark + trend)
const MarketIntelInput = z.object({
  commodity: z.enum(['gold', 'tanzanite', 'copper', 'any']).default('gold'),
  region: z.string().optional(),
  windowDays: z.number().int().positive().max(180).default(30),
});
const MarketIntelOutput = z.object({
  commodity: z.string(),
  lbmaFixUsdPerOz: z.number().optional(),
  benchmarkTzsPerGram: z.number().optional(),
  trend: z.array(
    z.object({
      asOf: z.string(),
      priceTzs: z.number(),
    }),
  ),
  asOf: z.string(),
});
export const buyerMarketIntelTool: PersonaToolDescriptor<
  typeof MarketIntelInput,
  typeof MarketIntelOutput
> = {
  id: 'mining.marketplace.market-intel',
  name: 'Buyer — market intel',
  description:
    'Current LBMA fix + local benchmark + price trend for the given commodity and ' +
    'optional region over a configurable window (default 30 days).',
  personaSlugs: BUYER,
  inputSchema: MarketIntelInput,
  outputSchema: MarketIntelOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        commodity: input.commodity,
        trend: [],
        asOf: new Date().toISOString(),
      };
    }
    return client.get<{
      commodity: string;
      lbmaFixUsdPerOz?: number;
      benchmarkTzsPerGram?: number;
      trend: Array<{ asOf: string; priceTzs: number }>;
      asOf: string;
    }>('/mining/marketplace/market-intel', {
      query: {
        tenantId: ctx.tenantId,
        commodity: input.commodity,
        region: input.region,
        windowDays: input.windowDays,
      },
    });
  },
};

// 9. Chain of custody (parcel timeline, hash-chained)
const CustodyInput = z.object({
  parcelId: z.string().min(1),
});
const CustodyOutput = z.object({
  parcelId: z.string(),
  timeline: z.array(
    z.object({
      hopId: z.string(),
      stage: z.enum([
        'pit',
        'assayer',
        'smelter',
        'exporter',
        'buyer',
        'transit',
        'custom',
      ]),
      label: z.string(),
      occurredAt: z.string(),
      hashChainPrev: z.string().optional(),
      hashChainSelf: z.string(),
    }),
  ),
  totalHops: z.number().int().nonnegative(),
});
export const buyerChainOfCustodyTool: PersonaToolDescriptor<
  typeof CustodyInput,
  typeof CustodyOutput
> = {
  id: 'mining.marketplace.chain-of-custody',
  name: 'Buyer — chain of custody',
  description:
    'Full hash-chained custody timeline for a marketplace parcel (pit through buyer ' +
    'delivery). Every hop carries its own hash plus the previous-hop hash.',
  personaSlugs: BUYER,
  inputSchema: CustodyInput,
  outputSchema: CustodyOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { parcelId: input.parcelId, timeline: [], totalHops: 0 };
    }
    // Retarget: canonical custody surface is GET /api/v1/ops/chain-of-
    // custody?parcelId= (services/api-gateway/src/routes/...). The
    // ops router returns the hash-chained pit-to-buyer timeline; the
    // brain tool maps the step shape into its narrower public schema.
    const res = await client.get<{
      data?: {
        steps?: Array<{
          stepIndex?: number;
          action?: string;
          happenedAt?: string;
          auditHashId?: string;
          location?: string;
        }>;
        latestHash?: string;
      };
    }>('/ops/chain-of-custody', {
      query: { parcelId: input.parcelId },
    });
    const steps = res.data?.steps ?? [];
    const stages: ReadonlyArray<
      'pit' | 'assayer' | 'smelter' | 'exporter' | 'buyer' | 'transit' | 'custom'
    > = [
      'pit',
      'assayer',
      'smelter',
      'exporter',
      'buyer',
      'transit',
      'custom',
    ];
    function stageFromAction(action: string | undefined):
      | 'pit'
      | 'assayer'
      | 'smelter'
      | 'exporter'
      | 'buyer'
      | 'transit'
      | 'custom' {
      const lower = String(action ?? '').toLowerCase();
      for (const s of stages) {
        if (lower.includes(s)) return s;
      }
      return 'custom';
    }
    return {
      parcelId: input.parcelId,
      timeline: steps.map((s, i) => {
        const hopId = String(s.auditHashId ?? `hop:${i}`);
        const prev = i > 0 ? String(steps[i - 1]?.auditHashId ?? '') : undefined;
        return {
          hopId,
          stage: stageFromAction(s.action),
          label: String(s.action ?? ''),
          occurredAt: String(s.happenedAt ?? new Date().toISOString()),
          ...(prev ? { hashChainPrev: prev } : {}),
          hashChainSelf: hopId,
        };
      }),
      totalHops: steps.length,
    };
  },
};

// 10. Accept offer (WRITE — MEDIUM)
const AcceptOfferInput = z.object({
  offerId: z.string().min(1),
  signedAt: z.string(),
});
const AcceptOfferOutput = z.object({
  offerId: z.string(),
  acceptedAt: z.string(),
  bidId: z.string().optional(),
});
export const buyerAcceptOfferTool: PersonaToolDescriptor<
  typeof AcceptOfferInput,
  typeof AcceptOfferOutput
> = {
  id: 'mining.marketplace.accept-offer',
  name: 'Buyer — accept seller offer',
  description:
    'Accept a seller counter-offer on an existing bid. Audit-tracked. The upstream ' +
    'route revalidates the offer is still open before commit.',
  personaSlugs: BUYER,
  inputSchema: AcceptOfferInput,
  outputSchema: AcceptOfferOutput,
  stakes: 'MEDIUM',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { offerId: input.offerId, acceptedAt: new Date().toISOString() };
    }
    // Retarget: canonical surface is POST /api/v1/mining/bids/:id/accept
    // (services/api-gateway/src/routes/mining/bids.hono.ts). In the
    // Borjie data model, a counter-offer is a `bids` row with status =
    // 'countered'; accepting it flips status -> 'accepted'. The brain
    // tool's `offerId` IS the underlying bid id.
    const res = await client.post<{
      data?: { id?: string; updated_at?: string };
    }>(
      `/mining/bids/${encodeURIComponent(input.offerId)}/accept`,
      withChatProvenance(
        {
          tenantId: ctx.tenantId,
          actorId: ctx.actorId,
          signedAt: input.signedAt,
        },
        ctx,
      ),
    );
    const row = res.data ?? {};
    return {
      offerId: String(row.id ?? input.offerId),
      acceptedAt: String(row.updated_at ?? new Date().toISOString()),
      bidId: String(row.id ?? input.offerId),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 11. RFB — buyer.rfb.create (WRITE — LOW)
// ─────────────────────────────────────────────────────────────────────

const RFB_MINERAL_KINDS = [
  'gold',
  'tanzanite',
  'diamond',
  'copper',
  'cobalt',
  'nickel',
  'iron',
  'coal',
  'silver',
  'rare_earth',
  'limestone',
  'gypsum',
  'salt',
  'gemstone_other',
] as const;

const RfbCreateInput = z.object({
  mineralKind: z.enum(RFB_MINERAL_KINDS),
  gradeMin: z.string().max(120).optional(),
  tonnageMin: z.number().positive(),
  tonnageMax: z.number().positive().optional(),
  unitPriceTzs: z.number().positive(),
  deliveryBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locationLat: z.number().gte(-90).lte(90).optional(),
  locationLon: z.number().gte(-180).lte(180).optional(),
  radiusKm: z.number().int().positive().max(5000).default(200),
  notes: z.string().max(1500).optional(),
});
const RfbCreateOutput = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
});

export const buyerRfbCreateTool: PersonaToolDescriptor<
  typeof RfbCreateInput,
  typeof RfbCreateOutput
> = {
  id: 'buyer.rfb.create',
  name: 'Buyer — create Request for Bids',
  description:
    'Post a buyer-initiated Request for Bids ("I want N tonnes of mineral X at ' +
    'TZS Y per unit by date D"). Sellers within radius_km respond with counter ' +
    'offers. Auto-expires after 14 days unless filled or cancelled.',
  personaSlugs: BUYER,
  inputSchema: RfbCreateInput,
  outputSchema: RfbCreateOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        id: 'rfb-stub',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }
    const body: Record<string, unknown> = {
      mineralKind: input.mineralKind,
      tonnageMin: input.tonnageMin,
      unitPriceTzs: input.unitPriceTzs,
      deliveryBy: input.deliveryBy,
      radiusKm: input.radiusKm,
    };
    if (input.gradeMin !== undefined) body.gradeMin = input.gradeMin;
    if (input.tonnageMax !== undefined) body.tonnageMax = input.tonnageMax;
    if (input.locationLat !== undefined) body.locationLat = input.locationLat;
    if (input.locationLon !== undefined) body.locationLon = input.locationLon;
    if (input.notes !== undefined) body.notes = input.notes;
    const res = await client.post<{
      success: boolean;
      data: { id: string; createdAt: string; expiresAt: string };
    }>('/marketplace/rfb', withChatProvenance(body, ctx));
    return res.data;
  },
};

// ─────────────────────────────────────────────────────────────────────
// 12. RFB — buyer.rfb.list_mine (READ — LOW)
// ─────────────────────────────────────────────────────────────────────

const RfbListMineInput = z.object({
  limit: z.number().int().positive().max(100).default(20),
});
const RfbListMineOutput = z.object({
  rfbs: z.array(
    z.object({
      id: z.string(),
      mineralKind: z.string(),
      tonnageMin: z.string(),
      unitPriceTzs: z.string(),
      deliveryBy: z.string(),
      status: z.string(),
      pendingResponseCount: z.number().int(),
    }),
  ),
});

export const buyerRfbListMineTool: PersonaToolDescriptor<
  typeof RfbListMineInput,
  typeof RfbListMineOutput
> = {
  id: 'buyer.rfb.list_mine',
  name: 'Buyer — list my RFBs',
  description:
    'List the buyer\'s own Request-for-Bids with status + pending-response count. ' +
    'Most-recent first. Read-only.',
  personaSlugs: BUYER,
  inputSchema: RfbListMineInput,
  outputSchema: RfbListMineOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { rfbs: [] };
    const res = await client.get<{
      success: boolean;
      data: {
        rfbs: Array<{
          id: string;
          mineral_kind: string;
          tonnage_min: string;
          unit_price_tzs: string;
          delivery_by: string;
          status: string;
          pending_response_count: number;
        }>;
      };
    }>('/marketplace/rfb/mine');
    return {
      rfbs: res.data.rfbs.map((r) => ({
        id: r.id,
        mineralKind: r.mineral_kind,
        tonnageMin: r.tonnage_min,
        unitPriceTzs: r.unit_price_tzs,
        deliveryBy: r.delivery_by,
        status: r.status,
        pendingResponseCount: r.pending_response_count,
      })),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 13. RFB — seller.rfb.list_nearby (READ — LOW)
// ─────────────────────────────────────────────────────────────────────
//
// Sellers also use the buyer-persona today (the persona system has
// not split seller into its own slug yet) so this tool is wired
// under BUYER. When the seller persona lands the same handler can
// be moved without changing the route or schema.

const RfbNearbyInput = z.object({
  mineralKind: z.enum(RFB_MINERAL_KINDS).optional(),
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  limit: z.number().int().positive().max(100).default(20),
});
const RfbNearbyOutput = z.object({
  rfbs: z.array(
    z.object({
      id: z.string(),
      mineralKind: z.string(),
      tonnageMin: z.string(),
      unitPriceTzs: z.string(),
      deliveryBy: z.string(),
      distanceKm: z.number().nullable(),
    }),
  ),
});

export const sellerRfbNearbyTool: PersonaToolDescriptor<
  typeof RfbNearbyInput,
  typeof RfbNearbyOutput
> = {
  id: 'seller.rfb.list_nearby',
  name: 'Seller — list nearby buyer RFBs',
  description:
    'Show open buyer-initiated RFBs within the seller\'s search radius, sorted by ' +
    'distance ascending. Read-only.',
  personaSlugs: BUYER,
  inputSchema: RfbNearbyInput,
  outputSchema: RfbNearbyOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) return { rfbs: [] };
    const query: Record<string, string> = {
      lat: String(input.lat),
      lon: String(input.lon),
      limit: String(input.limit),
    };
    if (input.mineralKind) query.mineralKind = input.mineralKind;
    const res = await client.get<{
      success: boolean;
      data: {
        rfbs: Array<{
          id: string;
          mineral_kind: string;
          tonnage_min: string;
          unit_price_tzs: string;
          delivery_by: string;
          distance_km: number | null;
        }>;
      };
    }>('/marketplace/rfb/nearby', { query });
    return {
      rfbs: res.data.rfbs.map((r) => ({
        id: r.id,
        mineralKind: r.mineral_kind,
        tonnageMin: r.tonnage_min,
        unitPriceTzs: r.unit_price_tzs,
        deliveryBy: r.delivery_by,
        distanceKm: r.distance_km,
      })),
    };
  },
};

// Commercial chain L8 — buyer signs delivery, triggering settlement.
//
// Hits POST /api/v1/marketplace/rfb-responses/:responseId/sign-delivery
// which runs the SettlementOrchestrator: idempotency check, math,
// LedgerService.post(), payout via M-Pesa B2C. The tool surfaces the
// final settlement id + math so the buyer's chat bubble carries the
// confirmation without a second round-trip.

const BuyerSignDeliveryInput = z.object({
  responseId: z.string().min(1).max(64),
  coCStepChecksum: z.string().min(8).max(256),
});
const BuyerSignDeliveryOutput = z.object({
  settlementId: z.string(),
  status: z.string(),
  grossTzs: z.number(),
  royaltyTzs: z.number(),
  feeTzs: z.number(),
  netTzs: z.number(),
  idempotent: z.boolean(),
});

export const buyerSignDeliveryTool: PersonaToolDescriptor<
  typeof BuyerSignDeliveryInput,
  typeof BuyerSignDeliveryOutput
> = {
  id: 'buyer.delivery.sign',
  name: 'Buyer — sign delivery (settlement)',
  description:
    'Sign the final chain-of-custody step on an accepted RFB response. ' +
    'Drives the settlement orchestrator end-to-end: math, ledger journal ' +
    'via LedgerService.post(), and M-Pesa B2C payout to the seller. ' +
    'WRITE — hash-chain audited via the underlying route. Idempotent on ' +
    '(tenant, response, coCStepChecksum).',
  personaSlugs: BUYER,
  inputSchema: BuyerSignDeliveryInput,
  outputSchema: BuyerSignDeliveryOutput,
  stakes: 'HIGH',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        settlementId: '',
        status: 'unavailable',
        grossTzs: 0,
        royaltyTzs: 0,
        feeTzs: 0,
        netTzs: 0,
        idempotent: false,
      };
    }
    const res = await client.post<{
      success: boolean;
      data?: {
        settlementId?: string;
        status?: string;
        grossTzs?: number;
        royaltyTzs?: number;
        feeTzs?: number;
        netTzs?: number;
        idempotent?: boolean;
      };
    }>(
      `/marketplace/rfb-responses/${encodeURIComponent(input.responseId)}/sign-delivery`,
      withChatProvenance(
        { coCStepChecksum: input.coCStepChecksum },
        ctx,
      ),
    );
    const data = res.data ?? {};
    return {
      settlementId: String(data.settlementId ?? ''),
      status: String(data.status ?? 'pending'),
      grossTzs: Number(data.grossTzs ?? 0),
      royaltyTzs: Number(data.royaltyTzs ?? 0),
      feeTzs: Number(data.feeTzs ?? 0),
      netTzs: Number(data.netTzs ?? 0),
      idempotent: Boolean(data.idempotent),
    };
  },
};

export const BUYER_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  buyerMarketSearchTool,
  buyerListingDetailTool,
  buyerPlaceBidTool,
  buyerMyBidsTool,
  buyerCancelBidTool,
  buyerKycStatusTool,
  buyerKycUploadAtomTool,
  buyerMarketIntelTool,
  buyerChainOfCustodyTool,
  buyerAcceptOfferTool,
  // R11 — buyer-initiated RFB.
  buyerRfbCreateTool,
  buyerRfbListMineTool,
  sellerRfbNearbyTool,
  // Commercial chain L8 — buyer signs delivery → ledger + payout.
  buyerSignDeliveryTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);

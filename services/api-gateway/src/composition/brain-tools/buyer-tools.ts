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
    return client.post<{ bidId: string; placedAt: string; status: 'active' | 'rejected' }>(
      '/mining/marketplace/bids',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        parcelId: input.parcelId,
        amount: input.amount,
        currency: input.currency,
      },
    );
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
    return client.get<{ bids: Array<{ bidId: string; parcelId: string; amount: number; currency: string; placedAt: string; status: 'active' | 'won' | 'lost' | 'withdrawn' }> }>(
      '/mining/marketplace/bids/mine',
      { query: { tenantId: ctx.tenantId, actorId: ctx.actorId, status: input.status } },
    );
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
    return client.post<{ bidId: string; withdrawnAt: string }>(
      '/mining/marketplace/bids/cancel',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        bidId: input.bidId,
        reasonEn: input.reasonEn,
      },
    );
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
    return client.get<{ tier: 'unverified' | 'tier1' | 'tier2' | 'tier3'; pendingSteps: string[]; approvedAt?: string }>(
      '/mining/buyers/kyc/status',
      { query: { tenantId: ctx.tenantId, actorId: ctx.actorId } },
    );
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
    return client.post<{ sessionId: string; chunkIndex: number; acceptedAt: string; assembled: boolean }>(
      '/mining/buyers/kyc/upload-atom',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        sessionId: input.sessionId,
        chunkIndex: input.chunkIndex,
        chunkBase64: input.chunkBase64,
        isLast: input.isLast,
      },
    );
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
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);

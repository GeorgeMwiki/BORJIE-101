// @ts-nocheck — drizzle-orm v0.36 pgEnum narrowing on listing_kind/status columns; tracked.
/**
 * Postgres-backed marketplace repositories (Drizzle).
 *
 * Three repos:
 *   - PostgresMarketplaceListingRepository
 *   - PostgresTenderRepository
 *   - PostgresBidRepository
 *
 * Tenant isolation is enforced via WHERE tenant_id = :ctx on every
 * read/update. Duplicate bids are prevented at the DB layer by the
 * unique index (tender_id, vendor_id).
 */
import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import {
  marketplaceListings,
  tenders,
  bids,
} from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import type {
  Bid,
  BidId,
  BidRepository,
  MarketplaceListing,
  MarketplaceListingId,
  MarketplaceListingRepository,
  SearchListingsInput,
  Tender,
  TenderId,
  TenderRepository,
} from './types.js';

export interface DrizzleLike {
  transaction<T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T>;
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

// ============================================================================
// Marketplace Listings
// ============================================================================

export class PostgresMarketplaceListingRepository
  implements MarketplaceListingRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async findById(
    id: MarketplaceListingId,
    tenantId: TenantId
  ): Promise<MarketplaceListing | null> {
    const rows = await this.db
      .select()
      .from(marketplaceListings)
      .where(
        and(
          eq(marketplaceListings.id, id as unknown as string),
          eq(marketplaceListings.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToListing(row) : null;
  }

  async create(listing: MarketplaceListing): Promise<MarketplaceListing> {
    await this.db.insert(marketplaceListings).values(listingToRow(listing));
    return listing;
  }

  async update(
    id: MarketplaceListingId,
    tenantId: TenantId,
    patch: Partial<MarketplaceListing>
  ): Promise<MarketplaceListing> {
    const updateValues = buildListingUpdate(patch);
    await this.db
      .update(marketplaceListings)
      .set(updateValues)
      .where(
        and(
          eq(marketplaceListings.id, id as unknown as string),
          eq(marketplaceListings.tenantId, tenantId as unknown as string)
        )
      );
    const after = await this.findById(id, tenantId);
    if (!after) throw new Error(`MarketplaceListing not found: ${id}`);
    return after;
  }

  async search(
    tenantId: TenantId,
    query: SearchListingsInput
  ): Promise<{
    readonly items: ReadonlyArray<MarketplaceListing>;
    readonly total: number;
  }> {
    const clauses: unknown[] = [
      eq(marketplaceListings.tenantId, tenantId as unknown as string),
    ];
    if (query.status) clauses.push(eq(marketplaceListings.status, query.status));
    if (query.listingKind)
      clauses.push(eq(marketplaceListings.listingKind, query.listingKind));
    if (query.propertyId)
      clauses.push(eq(marketplaceListings.propertyId, query.propertyId));
    if (query.minPrice !== undefined)
      clauses.push(gte(marketplaceListings.headlinePrice, query.minPrice));
    if (query.maxPrice !== undefined)
      clauses.push(lte(marketplaceListings.headlinePrice, query.maxPrice));

    const base = this.db
      .select()
      .from(marketplaceListings)
      .where(and(...clauses))
      .orderBy(desc(marketplaceListings.publishedAt));

    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const rows = await base.limit(limit).offset(offset);

    const allRows = await this.db
      .select()
      .from(marketplaceListings)
      .where(and(...clauses));
    const total = allRows.length;

    return {
      items: rows.map(rowToListing),
      total,
    };
  }
}

// ============================================================================
// Tenders
// ============================================================================

export class PostgresTenderRepository implements TenderRepository {
  constructor(private readonly db: DrizzleLike) {}

  async findById(id: TenderId, tenantId: TenantId): Promise<Tender | null> {
    const rows = await this.db
      .select()
      .from(tenders)
      .where(
        and(
          eq(tenders.id, id as unknown as string),
          eq(tenders.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToTender(row) : null;
  }

  async create(tender: Tender): Promise<Tender> {
    await this.db.insert(tenders).values(tenderToRow(tender));
    return tender;
  }

  async update(
    id: TenderId,
    tenantId: TenantId,
    patch: Partial<Tender>
  ): Promise<Tender> {
    const updateValues = buildTenderUpdate(patch);
    await this.db
      .update(tenders)
      .set(updateValues)
      .where(
        and(
          eq(tenders.id, id as unknown as string),
          eq(tenders.tenantId, tenantId as unknown as string)
        )
      );
    const after = await this.findById(id, tenantId);
    if (!after) throw new Error(`Tender not found: ${id}`);
    return after;
  }

  async listOpen(tenantId: TenantId): Promise<ReadonlyArray<Tender>> {
    const rows = await this.db
      .select()
      .from(tenders)
      .where(
        and(
          eq(tenders.tenantId, tenantId as unknown as string),
          eq(tenders.status, 'open')
        )
      )
      .orderBy(asc(tenders.closesAt));
    return rows.map(rowToTender);
  }
}

// ============================================================================
// Bids
// ============================================================================

export class PostgresBidRepository implements BidRepository {
  constructor(private readonly db: DrizzleLike) {}

  async findById(id: BidId, tenantId: TenantId): Promise<Bid | null> {
    const rows = await this.db
      .select()
      .from(bids)
      .where(
        and(
          eq(bids.id, id as unknown as string),
          eq(bids.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToBid(row) : null;
  }

  async create(bid: Bid): Promise<Bid> {
    await this.db.insert(bids).values(bidToRow(bid));
    return bid;
  }

  async update(
    id: BidId,
    tenantId: TenantId,
    patch: Partial<Bid>
  ): Promise<Bid> {
    const updateValues = buildBidUpdate(patch);
    await this.db
      .update(bids)
      .set(updateValues)
      .where(
        and(
          eq(bids.id, id as unknown as string),
          eq(bids.tenantId, tenantId as unknown as string)
        )
      );
    const after = await this.findById(id, tenantId);
    if (!after) throw new Error(`Bid not found: ${id}`);
    return after;
  }

  async listByTender(
    tenderId: TenderId,
    tenantId: TenantId
  ): Promise<ReadonlyArray<Bid>> {
    const rows = await this.db
      .select()
      .from(bids)
      .where(
        and(
          eq(bids.tenderId, tenderId as unknown as string),
          eq(bids.tenantId, tenantId as unknown as string)
        )
      )
      .orderBy(asc(bids.price));
    return rows.map(rowToBid);
  }
}

// ============================================================================
// Row <-> Entity mapping
// ============================================================================

function listingToRow(l: MarketplaceListing): Record<string, unknown> {
  return {
    id: l.id,
    tenantId: l.tenantId,
    unitId: l.unitId,
    propertyId: l.propertyId,
    listingKind: l.listingKind,
    headlinePrice: l.headlinePrice,
    currency: l.currency,
    negotiable: l.negotiable,
    media: l.media,
    attributes: l.attributes,
    status: l.status,
    publishedAt: l.publishedAt ? new Date(l.publishedAt) : null,
    expiresAt: l.expiresAt ? new Date(l.expiresAt) : null,
    negotiationPolicyId: l.negotiationPolicyId,
    createdAt: new Date(l.createdAt),
    createdBy: l.createdBy,
    updatedAt: new Date(l.updatedAt),
    updatedBy: l.updatedBy,
  };
}

function buildListingUpdate(
  patch: Partial<MarketplaceListing>
): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (patch.headlinePrice !== undefined) u.headlinePrice = patch.headlinePrice;
  if (patch.listingKind !== undefined) u.listingKind = patch.listingKind;
  if (patch.currency !== undefined) u.currency = patch.currency;
  if (patch.negotiable !== undefined) u.negotiable = patch.negotiable;
  if (patch.media !== undefined) u.media = patch.media;
  if (patch.attributes !== undefined) u.attributes = patch.attributes;
  if (patch.status !== undefined) u.status = patch.status;
  if (patch.publishedAt !== undefined)
    u.publishedAt = patch.publishedAt ? new Date(patch.publishedAt) : null;
  if (patch.expiresAt !== undefined)
    u.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
  if (patch.negotiationPolicyId !== undefined)
    u.negotiationPolicyId = patch.negotiationPolicyId;
  if (patch.updatedBy !== undefined) u.updatedBy = patch.updatedBy;
  u.updatedAt = new Date();
  return u;
}

function rowToListing(row: Record<string, unknown>): MarketplaceListing {
  return {
    id: row.id as MarketplaceListingId,
    tenantId: row.tenantId as TenantId,
    unitId: row.unitId as string,
    propertyId: (row.propertyId as string | null) ?? null,
    listingKind: row.listingKind as MarketplaceListing['listingKind'],
    headlinePrice: row.headlinePrice as number,
    currency: row.currency as string,
    negotiable: Boolean(row.negotiable),
    media: (row.media as MarketplaceListing['media']) ?? [],
    attributes: (row.attributes as Record<string, unknown>) ?? {},
    status: row.status as MarketplaceListing['status'],
    publishedAt: row.publishedAt
      ? (toIso(row.publishedAt as Date) as MarketplaceListing['publishedAt'])
      : null,
    expiresAt: row.expiresAt
      ? (toIso(row.expiresAt as Date) as MarketplaceListing['expiresAt'])
      : null,
    negotiationPolicyId: (row.negotiationPolicyId as string | null) ?? null,
    createdAt: toIso(row.createdAt as Date | string) as MarketplaceListing['createdAt'],
    createdBy: (row.createdBy as MarketplaceListing['createdBy']) ?? null,
    updatedAt: toIso(row.updatedAt as Date | string) as MarketplaceListing['updatedAt'],
    updatedBy: (row.updatedBy as MarketplaceListing['updatedBy']) ?? null,
  };
}

function tenderToRow(t: Tender): Record<string, unknown> {
  return {
    id: t.id,
    tenantId: t.tenantId,
    workOrderId: t.workOrderId,
    scope: t.scope,
    details: t.details,
    budgetRangeMin: t.budgetRangeMin,
    budgetRangeMax: t.budgetRangeMax,
    currency: t.currency,
    status: t.status,
    visibility: t.visibility,
    invitedVendorIds: t.invitedVendorIds,
    aiNegotiatorEnabled: t.aiNegotiatorEnabled,
    negotiationPolicyId: t.negotiationPolicyId,
    closesAt: new Date(t.closesAt),
    awardedAt: t.awardedAt ? new Date(t.awardedAt) : null,
    awardedBidId: t.awardedBidId,
    cancelledAt: t.cancelledAt ? new Date(t.cancelledAt) : null,
    cancellationReason: t.cancellationReason,
    createdAt: new Date(t.createdAt),
    createdBy: t.createdBy,
    updatedAt: new Date(t.updatedAt),
    updatedBy: t.updatedBy,
  };
}

function buildTenderUpdate(patch: Partial<Tender>): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (patch.scope !== undefined) u.scope = patch.scope;
  if (patch.details !== undefined) u.details = patch.details;
  if (patch.budgetRangeMin !== undefined) u.budgetRangeMin = patch.budgetRangeMin;
  if (patch.budgetRangeMax !== undefined) u.budgetRangeMax = patch.budgetRangeMax;
  if (patch.status !== undefined) u.status = patch.status;
  if (patch.visibility !== undefined) u.visibility = patch.visibility;
  if (patch.invitedVendorIds !== undefined)
    u.invitedVendorIds = patch.invitedVendorIds;
  if (patch.aiNegotiatorEnabled !== undefined)
    u.aiNegotiatorEnabled = patch.aiNegotiatorEnabled;
  if (patch.negotiationPolicyId !== undefined)
    u.negotiationPolicyId = patch.negotiationPolicyId;
  if (patch.closesAt !== undefined) u.closesAt = new Date(patch.closesAt);
  if (patch.awardedAt !== undefined)
    u.awardedAt = patch.awardedAt ? new Date(patch.awardedAt) : null;
  if (patch.awardedBidId !== undefined) u.awardedBidId = patch.awardedBidId;
  if (patch.cancelledAt !== undefined)
    u.cancelledAt = patch.cancelledAt ? new Date(patch.cancelledAt) : null;
  if (patch.cancellationReason !== undefined)
    u.cancellationReason = patch.cancellationReason;
  if (patch.updatedBy !== undefined) u.updatedBy = patch.updatedBy;
  u.updatedAt = new Date();
  return u;
}

function rowToTender(row: Record<string, unknown>): Tender {
  return {
    id: row.id as TenderId,
    tenantId: row.tenantId as TenantId,
    workOrderId: (row.workOrderId as string | null) ?? null,
    scope: row.scope as string,
    details: (row.details as string | null) ?? null,
    budgetRangeMin: row.budgetRangeMin as number,
    budgetRangeMax: row.budgetRangeMax as number,
    currency: row.currency as string,
    status: row.status as Tender['status'],
    visibility: row.visibility as Tender['visibility'],
    invitedVendorIds: (row.invitedVendorIds as ReadonlyArray<string>) ?? [],
    aiNegotiatorEnabled: Boolean(row.aiNegotiatorEnabled),
    negotiationPolicyId: (row.negotiationPolicyId as string | null) ?? null,
    closesAt: toIso(row.closesAt as Date | string) as Tender['closesAt'],
    awardedAt: row.awardedAt
      ? (toIso(row.awardedAt as Date) as Tender['awardedAt'])
      : null,
    awardedBidId: (row.awardedBidId as BidId | null) ?? null,
    cancelledAt: row.cancelledAt
      ? (toIso(row.cancelledAt as Date) as Tender['cancelledAt'])
      : null,
    cancellationReason: (row.cancellationReason as string | null) ?? null,
    createdAt: toIso(row.createdAt as Date | string) as Tender['createdAt'],
    createdBy: (row.createdBy as Tender['createdBy']) ?? null,
    updatedAt: toIso(row.updatedAt as Date | string) as Tender['updatedAt'],
    updatedBy: (row.updatedBy as Tender['updatedBy']) ?? null,
  };
}

function bidToRow(b: Bid): Record<string, unknown> {
  return {
    id: b.id,
    tenantId: b.tenantId,
    tenderId: b.tenderId,
    vendorId: b.vendorId,
    price: b.price,
    currency: b.currency,
    timelineDays: b.timelineDays,
    notes: b.notes,
    attachments: b.attachments,
    status: b.status,
    negotiationId: b.negotiationId,
    negotiationTurns: b.negotiationTurns,
    submittedAt: new Date(b.submittedAt),
    awardedAt: b.awardedAt ? new Date(b.awardedAt) : null,
    rejectedAt: b.rejectedAt ? new Date(b.rejectedAt) : null,
    rejectionReason: b.rejectionReason,
    createdAt: new Date(b.createdAt),
    updatedAt: new Date(b.updatedAt),
  };
}

function buildBidUpdate(patch: Partial<Bid>): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (patch.price !== undefined) u.price = patch.price;
  if (patch.timelineDays !== undefined) u.timelineDays = patch.timelineDays;
  if (patch.notes !== undefined) u.notes = patch.notes;
  if (patch.attachments !== undefined) u.attachments = patch.attachments;
  if (patch.status !== undefined) u.status = patch.status;
  if (patch.negotiationId !== undefined) u.negotiationId = patch.negotiationId;
  if (patch.negotiationTurns !== undefined)
    u.negotiationTurns = patch.negotiationTurns;
  if (patch.awardedAt !== undefined)
    u.awardedAt = patch.awardedAt ? new Date(patch.awardedAt) : null;
  if (patch.rejectedAt !== undefined)
    u.rejectedAt = patch.rejectedAt ? new Date(patch.rejectedAt) : null;
  if (patch.rejectionReason !== undefined)
    u.rejectionReason = patch.rejectionReason;
  u.updatedAt = new Date();
  return u;
}

function rowToBid(row: Record<string, unknown>): Bid {
  return {
    id: row.id as BidId,
    tenantId: row.tenantId as TenantId,
    tenderId: row.tenderId as TenderId,
    vendorId: row.vendorId as string,
    price: row.price as number,
    currency: row.currency as string,
    timelineDays: row.timelineDays as number,
    notes: (row.notes as string | null) ?? null,
    attachments: (row.attachments as ReadonlyArray<unknown>) ?? [],
    status: row.status as Bid['status'],
    negotiationId: (row.negotiationId as string | null) ?? null,
    negotiationTurns: (row.negotiationTurns as ReadonlyArray<unknown>) ?? [],
    submittedAt: toIso(row.submittedAt as Date | string) as Bid['submittedAt'],
    awardedAt: row.awardedAt
      ? (toIso(row.awardedAt as Date) as Bid['awardedAt'])
      : null,
    rejectedAt: row.rejectedAt
      ? (toIso(row.rejectedAt as Date) as Bid['rejectedAt'])
      : null,
    rejectionReason: (row.rejectionReason as string | null) ?? null,
    createdAt: toIso(row.createdAt as Date | string) as Bid['createdAt'],
    updatedAt: toIso(row.updatedAt as Date | string) as Bid['updatedAt'],
  };
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}
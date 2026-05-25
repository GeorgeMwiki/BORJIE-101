/**
 * Marketplace domain types.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
} from '@borjie/domain-models';

export type MarketplaceListingId = string & {
  readonly __brand: 'MarketplaceListingId';
};
export type TenderId = string & { readonly __brand: 'TenderId' };
export type BidId = string & { readonly __brand: 'BidId' };

export const asMarketplaceListingId = (s: string): MarketplaceListingId =>
  s as MarketplaceListingId;
export const asTenderId = (s: string): TenderId => s as TenderId;
export const asBidId = (s: string): BidId => s as BidId;

export type ListingKind = 'rent' | 'lease' | 'sale';
export type ListingStatus = 'draft' | 'published' | 'paused' | 'closed';
export type TenderStatus = 'open' | 'closed' | 'awarded' | 'cancelled';
export type TenderVisibility = 'public' | 'invite_only';
export type BidStatus =
  | 'submitted'
  | 'negotiating'
  | 'awarded'
  | 'rejected'
  | 'withdrawn';

export interface ListingMediaItem {
  readonly type: 'photo' | 'video' | 'floor_360' | 'street_view';
  readonly url: string;
  readonly caption?: string;
}

export interface MarketplaceListing {
  readonly id: MarketplaceListingId;
  readonly tenantId: TenantId;
  readonly unitId: string;
  readonly propertyId: string | null;
  readonly listingKind: ListingKind;
  readonly headlinePrice: number;
  readonly currency: string;
  readonly negotiable: boolean;
  readonly media: ReadonlyArray<ListingMediaItem>;
  readonly attributes: Record<string, unknown>;
  readonly status: ListingStatus;
  readonly publishedAt: ISOTimestamp | null;
  readonly expiresAt: ISOTimestamp | null;
  readonly negotiationPolicyId: string | null;
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId | null;
  readonly updatedAt: ISOTimestamp;
  readonly updatedBy: UserId | null;
}

export interface Tender {
  readonly id: TenderId;
  readonly tenantId: TenantId;
  readonly workOrderId: string | null;
  readonly scope: string;
  readonly details: string | null;
  readonly budgetRangeMin: number;
  readonly budgetRangeMax: number;
  readonly currency: string;
  readonly status: TenderStatus;
  readonly visibility: TenderVisibility;
  readonly invitedVendorIds: ReadonlyArray<string>;
  readonly aiNegotiatorEnabled: boolean;
  readonly negotiationPolicyId: string | null;
  readonly closesAt: ISOTimestamp;
  readonly awardedAt: ISOTimestamp | null;
  readonly awardedBidId: BidId | null;
  readonly cancelledAt: ISOTimestamp | null;
  readonly cancellationReason: string | null;
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId | null;
  readonly updatedAt: ISOTimestamp;
  readonly updatedBy: UserId | null;
}

export interface Bid {
  readonly id: BidId;
  readonly tenantId: TenantId;
  readonly tenderId: TenderId;
  readonly vendorId: string;
  readonly price: number;
  readonly currency: string;
  readonly timelineDays: number;
  readonly notes: string | null;
  readonly attachments: ReadonlyArray<unknown>;
  readonly status: BidStatus;
  readonly negotiationId: string | null;
  readonly negotiationTurns: ReadonlyArray<unknown>;
  readonly submittedAt: ISOTimestamp;
  readonly awardedAt: ISOTimestamp | null;
  readonly rejectedAt: ISOTimestamp | null;
  readonly rejectionReason: string | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

// ============================================================================
// Inputs
// ============================================================================

export interface PublishListingInput {
  readonly unitId: string;
  readonly propertyId?: string | null;
  readonly listingKind: ListingKind;
  readonly headlinePrice: number;
  readonly currency?: string;
  readonly negotiable?: boolean;
  readonly media?: ReadonlyArray<ListingMediaItem>;
  readonly attributes?: Record<string, unknown>;
  readonly negotiationPolicyId?: string | null;
  readonly expiresAt?: ISOTimestamp | null;
  readonly publishImmediately?: boolean;
}

export interface SearchListingsInput {
  readonly status?: ListingStatus;
  readonly listingKind?: ListingKind;
  readonly minPrice?: number;
  readonly maxPrice?: number;
  readonly propertyId?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface PublishTenderInput {
  readonly scope: string;
  readonly details?: string;
  readonly budgetRangeMin: number;
  readonly budgetRangeMax: number;
  readonly currency?: string;
  readonly visibility?: TenderVisibility;
  readonly invitedVendorIds?: ReadonlyArray<string>;
  readonly workOrderId?: string | null;
  readonly aiNegotiatorEnabled?: boolean;
  readonly negotiationPolicyId?: string | null;
  readonly closesAt: ISOTimestamp;
}

export interface SubmitBidInput {
  readonly tenderId: TenderId;
  readonly vendorId: string;
  readonly price: number;
  readonly timelineDays: number;
  readonly notes?: string;
  readonly attachments?: ReadonlyArray<unknown>;
  readonly currency?: string;
}

export interface AwardTenderInput {
  readonly tenderId: TenderId;
  readonly bidId: BidId;
  readonly awardedBy: UserId;
  readonly reason?: string;
}

export interface StartEnquiryInput {
  readonly listingId: MarketplaceListingId;
  readonly prospectCustomerId: string;
  readonly openingOffer: number;
  readonly message?: string;
}

// ============================================================================
// Repositories
// ============================================================================

export interface MarketplaceListingRepository {
  findById(
    id: MarketplaceListingId,
    tenantId: TenantId
  ): Promise<MarketplaceListing | null>;
  create(listing: MarketplaceListing): Promise<MarketplaceListing>;
  update(
    id: MarketplaceListingId,
    tenantId: TenantId,
    patch: Partial<MarketplaceListing>
  ): Promise<MarketplaceListing>;
  search(
    tenantId: TenantId,
    query: SearchListingsInput
  ): Promise<{
    readonly items: ReadonlyArray<MarketplaceListing>;
    readonly total: number;
  }>;
}

export interface TenderRepository {
  findById(id: TenderId, tenantId: TenantId): Promise<Tender | null>;
  create(tender: Tender): Promise<Tender>;
  update(
    id: TenderId,
    tenantId: TenantId,
    patch: Partial<Tender>
  ): Promise<Tender>;
  listOpen(tenantId: TenantId): Promise<ReadonlyArray<Tender>>;
}

export interface BidRepository {
  findById(id: BidId, tenantId: TenantId): Promise<Bid | null>;
  create(bid: Bid): Promise<Bid>;
  update(id: BidId, tenantId: TenantId, patch: Partial<Bid>): Promise<Bid>;
  listByTender(
    tenderId: TenderId,
    tenantId: TenantId
  ): Promise<ReadonlyArray<Bid>>;
}

// ============================================================================
// Errors
// ============================================================================

export class MarketplaceServiceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'VALIDATION'
      | 'INVALID_STATUS'
      | 'DUPLICATE_BID'
      | 'TENDER_CLOSED'
      | 'LISTING_NOT_PUBLISHED'
      | 'POLICY_REQUIRED'
  ) {
    super(message);
    this.name = 'MarketplaceServiceError';
  }
}

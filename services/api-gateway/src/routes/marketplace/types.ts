/**
 * Marketplace API — shared types used by the router, its data port, and
 * the api-client wrapper in `apps/tenant-portal/src/lib/marketplace`.
 *
 * These are wire shapes. They MUST stay backwards-compatible with the
 * `apps/tenant-portal` client — if a field changes name or type, bump a
 * version field on the response envelope instead of breaking the
 * existing consumer.
 */

export interface OrgSummary {
  readonly orgId: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly listingCount: number;
  readonly tenderCount: number;
}

export interface OrgProfile extends OrgSummary {
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly state: string | null;
  readonly postalCode: string | null;
  readonly primaryEmail: string;
  readonly primaryPhone: string | null;
  readonly coverageArea: string | null;
  readonly joinCodePromptHint: string | null;
}

export interface MarketplaceListing {
  readonly listingId: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly propertyId: string;
  readonly propertyName: string;
  readonly unitId: string;
  readonly unitName: string;
  readonly city: string;
  readonly country: string;
  readonly type: string;
  readonly bedrooms: number;
  readonly bathrooms: number;
  readonly squareMeters: number | null;
  readonly priceMin: number;
  readonly priceMax: number;
  readonly currency: string;
  readonly negotiable: boolean;
  readonly furnishing: string | null;
  readonly amenities: ReadonlyArray<string>;
  readonly thumbnailUrl: string | null;
}

export interface MarketplaceListingDetail extends MarketplaceListing {
  readonly description: string | null;
  readonly media: ReadonlyArray<{
    readonly type: 'photo' | 'video' | 'floor_360' | 'street_view';
    readonly url: string;
    readonly caption: string | null;
  }>;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly virtualTourUrl: string | null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly priceRange: {
    readonly min: number;
    readonly max: number;
    readonly currency: string;
    readonly negotiable: boolean;
  };
}

export interface ListingsPage {
  readonly items: ReadonlyArray<MarketplaceListing>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface TenderSummary {
  readonly tenderId: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly scope: string;
  readonly budgetMin: number;
  readonly budgetMax: number;
  readonly currency: string;
  readonly closesAt: string;
  readonly visibility: 'public' | 'invite_only';
}

export interface InquiryRecord {
  readonly inquiryId: string;
  readonly listingId: string;
  readonly userId: string;
  readonly message: string;
  readonly proposedPrice: number | null;
  readonly createdAt: string;
}

export interface ApplicationRecord {
  readonly applicationId: string;
  readonly listingId: string;
  readonly userId: string;
  readonly status: 'submitted' | 'in_review' | 'approved' | 'rejected' | 'withdrawn';
  readonly letterBody: string;
  readonly expectedResponseAt: string | null;
  readonly createdAt: string;
}

export interface OrgMembership {
  readonly orgId: string;
  readonly orgName: string;
  readonly role: 'tenant' | 'prospect' | 'vendor';
  readonly joinedAt: string;
  readonly activeLeaseCount: number;
}

export interface JoinCodeRedemption {
  readonly orgId: string;
  readonly orgName: string;
  readonly role: 'tenant' | 'prospect' | 'vendor';
  readonly userOrgId: string;
  readonly joinedAt: string;
}

export interface ListingsFilters {
  readonly orgId?: string;
  readonly city?: string;
  readonly type?: string;
  readonly minPrice?: number;
  readonly maxPrice?: number;
  readonly bedrooms?: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * The data-access port used by the router. The composition root binds
 * a real implementation (Postgres-backed); tests bind a `vi.fn()`-driven
 * stub. Every method must be idempotent + side-effect-free unless its
 * name says otherwise (`createX`, `redeemX`, ...).
 */
export interface MarketplaceDataPort {
  listOrgs(): Promise<ReadonlyArray<OrgSummary>>;
  findOrg(orgId: string): Promise<OrgProfile | null>;
  searchListings(filters: ListingsFilters): Promise<ListingsPage>;
  findListing(listingId: string): Promise<MarketplaceListingDetail | null>;
  listTenders(orgId: string | undefined): Promise<ReadonlyArray<TenderSummary>>;
  createInquiry(input: {
    readonly listingId: string;
    readonly userId: string;
    readonly message: string;
    readonly proposedPrice: number | null;
  }): Promise<InquiryRecord>;
  createApplication(input: {
    readonly listingId: string;
    readonly userId: string;
    readonly letterBody: string;
  }): Promise<ApplicationRecord>;
  redeemJoinCode(input: {
    readonly userId: string;
    readonly code: string;
  }): Promise<
    | { readonly ok: true; readonly value: JoinCodeRedemption }
    | {
        readonly ok: false;
        readonly error:
          | 'CODE_NOT_FOUND'
          | 'CODE_EXPIRED'
          | 'CODE_EXHAUSTED'
          | 'CODE_REVOKED'
          | 'ALREADY_MEMBER';
      }
  >;
}

/**
 * Standard wire envelope. Mirrors the rest of the api-gateway: every
 * route returns `{ success, data?, error?, meta? }` so the client can
 * branch on `success` without inspecting the HTTP status.
 */
export interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: { readonly code: string; readonly message: string };
  readonly meta?: { readonly total: number; readonly page: number; readonly pageSize: number };
}

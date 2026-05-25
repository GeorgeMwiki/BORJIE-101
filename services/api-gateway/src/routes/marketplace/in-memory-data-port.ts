/**
 * In-memory MarketplaceDataPort.
 *
 * Two reasons for the in-memory adapter to live in the router folder:
 *
 *   1. The Postgres-backed adapter is not wired yet — the composition
 *      root will bind it once the migrations land in prod. Until then,
 *      the router falls back to this seeded in-memory store so a
 *      tenant-portal developer can hit a working surface end-to-end.
 *   2. Tests construct their own stubs via `vi.fn()`. This file is
 *      ALSO useful as a copy-pasteable reference shape — the tests in
 *      `__tests__/marketplace-routes.test.ts` use `createSeededPort()`
 *      so the assertions read like a fixture, not a mock soup.
 *
 * The seed mirrors the questionnaire (Section 4) examples:
 *   - Two orgs (Asha Properties / Kilimani Homes)
 *   - Three listings across both orgs in Nairobi + Mombasa
 *   - One tender package per org
 *   - One demo join code per org
 */

import type {
  ApplicationRecord,
  InquiryRecord,
  JoinCodeRedemption,
  ListingsFilters,
  ListingsPage,
  MarketplaceDataPort,
  MarketplaceListing,
  MarketplaceListingDetail,
  OrgMembership,
  OrgProfile,
  OrgSummary,
  TenderSummary,
} from './types.js';

interface JoinCodeRow {
  readonly code: string;
  readonly orgId: string;
  readonly role: 'tenant' | 'prospect' | 'vendor';
  readonly maxUses: number | null;
  usesCount: number;
  readonly expiresAt: string | null;
  revokedAt: string | null;
}

interface Membership {
  readonly userOrgId: string;
  readonly userId: string;
  readonly orgId: string;
  readonly role: 'tenant' | 'prospect' | 'vendor';
  readonly joinedAt: string;
  readonly activeLeaseCount: number;
}

export interface InMemoryStore {
  readonly orgs: ReadonlyArray<OrgProfile>;
  readonly listings: ReadonlyArray<MarketplaceListingDetail>;
  readonly tenders: ReadonlyArray<TenderSummary>;
  readonly joinCodes: Array<JoinCodeRow>;
  readonly memberships: Array<Membership>;
  readonly inquiries: Array<InquiryRecord>;
  readonly applications: Array<ApplicationRecord>;
}

const ORGS: ReadonlyArray<OrgProfile> = [
  {
    orgId: 'org_asha',
    name: 'Asha Properties',
    slug: 'asha-properties',
    description: 'Family-run portfolio of 12 walk-up apartments in Nairobi.',
    city: 'Nairobi',
    country: 'KE',
    listingCount: 2,
    tenderCount: 1,
    addressLine1: '5 Riverside Drive',
    addressLine2: null,
    state: 'Nairobi',
    postalCode: '00100',
    primaryEmail: 'hello@ashaproperties.example',
    primaryPhone: '+254700111222',
    coverageArea: 'Nairobi (Westlands, Lavington, Kilimani)',
    joinCodePromptHint: 'Ask your building caretaker for an ASHA code.',
  },
  {
    orgId: 'org_kilimani',
    name: 'Kilimani Homes',
    slug: 'kilimani-homes',
    description: 'Mid-market apartments and tenders across coastal Kenya.',
    city: 'Mombasa',
    country: 'KE',
    listingCount: 1,
    tenderCount: 1,
    addressLine1: '14 Nyali Road',
    addressLine2: null,
    state: 'Mombasa',
    postalCode: '80100',
    primaryEmail: 'lettings@kilimanihomes.example',
    primaryPhone: '+254711222333',
    coverageArea: 'Mombasa, Nyali, Malindi',
    joinCodePromptHint: 'Your landlord will share a code on signing.',
  },
];

const LISTINGS: ReadonlyArray<MarketplaceListingDetail> = [
  {
    listingId: 'lst_asha_unit_a1',
    orgId: 'org_asha',
    orgName: 'Asha Properties',
    propertyId: 'prop_asha_riverside',
    propertyName: 'Riverside Walk-up A',
    unitId: 'unit_a1',
    unitName: 'A1',
    city: 'Nairobi',
    country: 'KE',
    type: 'apartment',
    bedrooms: 2,
    bathrooms: 1,
    squareMeters: 65,
    priceMin: 45000,
    priceMax: 55000,
    currency: 'KES',
    negotiable: true,
    furnishing: 'semi_furnished',
    amenities: ['parking', 'water_backup'],
    thumbnailUrl: 'https://cdn.borjie.example/listings/asha-a1.webp',
    description: 'A bright 2-bed with a small private balcony.',
    media: [
      {
        type: 'photo',
        url: 'https://cdn.borjie.example/listings/asha-a1.webp',
        caption: 'Living room',
      },
      {
        type: 'photo',
        url: 'https://cdn.borjie.example/listings/asha-a1-kitchen.webp',
        caption: 'Kitchen',
      },
    ],
    latitude: -1.2632,
    longitude: 36.8067,
    virtualTourUrl: null,
    attributes: { petsAllowed: true, internetReady: true },
    priceRange: { min: 45000, max: 55000, currency: 'KES', negotiable: true },
  },
  {
    listingId: 'lst_asha_unit_b3',
    orgId: 'org_asha',
    orgName: 'Asha Properties',
    propertyId: 'prop_asha_lavington',
    propertyName: 'Lavington Court',
    unitId: 'unit_b3',
    unitName: 'B3',
    city: 'Nairobi',
    country: 'KE',
    type: 'apartment',
    bedrooms: 3,
    bathrooms: 2,
    squareMeters: 95,
    priceMin: 75000,
    priceMax: 90000,
    currency: 'KES',
    negotiable: true,
    furnishing: 'unfurnished',
    amenities: ['gym', 'security_24_7'],
    thumbnailUrl: 'https://cdn.borjie.example/listings/asha-b3.webp',
    description: 'Family-sized 3-bed close to Yaya Centre.',
    media: [
      {
        type: 'photo',
        url: 'https://cdn.borjie.example/listings/asha-b3.webp',
        caption: 'Front entry',
      },
    ],
    latitude: -1.2913,
    longitude: 36.7799,
    virtualTourUrl: 'https://tour.borjie.example/asha-b3',
    attributes: { schoolZone: 'Lavington Primary' },
    priceRange: { min: 75000, max: 90000, currency: 'KES', negotiable: true },
  },
  {
    listingId: 'lst_kilimani_nyali_2br',
    orgId: 'org_kilimani',
    orgName: 'Kilimani Homes',
    propertyId: 'prop_kilimani_nyali',
    propertyName: 'Nyali Beach Suites',
    unitId: 'unit_nyali_2br',
    unitName: '2BR-04',
    city: 'Mombasa',
    country: 'KE',
    type: 'apartment',
    bedrooms: 2,
    bathrooms: 2,
    squareMeters: 78,
    priceMin: 60000,
    priceMax: 72000,
    currency: 'KES',
    negotiable: false,
    furnishing: 'fully_furnished',
    amenities: ['pool', 'beach_access'],
    thumbnailUrl: 'https://cdn.borjie.example/listings/kilimani-2br.webp',
    description: 'Fully-furnished beachside two-bed, short-let ready.',
    media: [
      {
        type: 'photo',
        url: 'https://cdn.borjie.example/listings/kilimani-2br.webp',
        caption: 'Balcony view',
      },
    ],
    latitude: -4.0435,
    longitude: 39.7184,
    virtualTourUrl: null,
    attributes: { shortLetMin: 30 },
    priceRange: { min: 60000, max: 72000, currency: 'KES', negotiable: false },
  },
];

const TENDERS: ReadonlyArray<TenderSummary> = [
  {
    tenderId: 'tnd_asha_paint_2026q3',
    orgId: 'org_asha',
    orgName: 'Asha Properties',
    scope: 'Exterior painting — Riverside Walk-up A (3 blocks).',
    budgetMin: 180000,
    budgetMax: 240000,
    currency: 'KES',
    closesAt: '2026-09-30T23:59:00.000Z',
    visibility: 'public',
  },
  {
    tenderId: 'tnd_kilimani_landscape_2026q4',
    orgId: 'org_kilimani',
    orgName: 'Kilimani Homes',
    scope: 'Landscape upkeep — Nyali Beach Suites (12 months).',
    budgetMin: 95000,
    budgetMax: 130000,
    currency: 'KES',
    closesAt: '2026-11-15T23:59:00.000Z',
    visibility: 'public',
  },
];

const DEMO_JOIN_CODES: ReadonlyArray<JoinCodeRow> = [
  {
    code: 'ASHA-WELCOME',
    orgId: 'org_asha',
    role: 'tenant',
    maxUses: null,
    usesCount: 0,
    expiresAt: null,
    revokedAt: null,
  },
  {
    code: 'KILIMANI-2026',
    orgId: 'org_kilimani',
    role: 'tenant',
    maxUses: 50,
    usesCount: 0,
    expiresAt: '2026-12-31T23:59:00.000Z',
    revokedAt: null,
  },
];

/**
 * Spin up a fresh store. Each test gets its own — the seed data is the
 * same so assertions stay deterministic.
 */
export function createSeededStore(): InMemoryStore {
  return {
    orgs: ORGS,
    listings: LISTINGS,
    tenders: TENDERS,
    joinCodes: DEMO_JOIN_CODES.map((c) => ({ ...c })),
    memberships: [],
    inquiries: [],
    applications: [],
  };
}

/**
 * Wrap a store in the MarketplaceDataPort interface. Pure projection +
 * a handful of mutating methods that push onto the store's arrays.
 */
export function inMemoryDataPort(store: InMemoryStore): MarketplaceDataPort {
  function listingToSummary(d: MarketplaceListingDetail): MarketplaceListing {
    return {
      listingId: d.listingId,
      orgId: d.orgId,
      orgName: d.orgName,
      propertyId: d.propertyId,
      propertyName: d.propertyName,
      unitId: d.unitId,
      unitName: d.unitName,
      city: d.city,
      country: d.country,
      type: d.type,
      bedrooms: d.bedrooms,
      bathrooms: d.bathrooms,
      squareMeters: d.squareMeters,
      priceMin: d.priceMin,
      priceMax: d.priceMax,
      currency: d.currency,
      negotiable: d.negotiable,
      furnishing: d.furnishing,
      amenities: d.amenities,
      thumbnailUrl: d.thumbnailUrl,
    };
  }

  return {
    async listOrgs(): Promise<ReadonlyArray<OrgSummary>> {
      return store.orgs.map((o) => ({
        orgId: o.orgId,
        name: o.name,
        slug: o.slug,
        description: o.description,
        city: o.city,
        country: o.country,
        listingCount: o.listingCount,
        tenderCount: o.tenderCount,
      }));
    },

    async findOrg(orgId: string): Promise<OrgProfile | null> {
      return store.orgs.find((o) => o.orgId === orgId) ?? null;
    },

    async searchListings(filters: ListingsFilters): Promise<ListingsPage> {
      const matched = store.listings.filter((l) => {
        if (filters.orgId && l.orgId !== filters.orgId) return false;
        if (filters.city && l.city.toLowerCase() !== filters.city.toLowerCase())
          return false;
        if (filters.type && l.type !== filters.type) return false;
        if (filters.bedrooms !== undefined && l.bedrooms !== filters.bedrooms)
          return false;
        if (filters.minPrice !== undefined && l.priceMax < filters.minPrice)
          return false;
        if (filters.maxPrice !== undefined && l.priceMin > filters.maxPrice)
          return false;
        return true;
      });
      const start = (filters.page - 1) * filters.pageSize;
      const items = matched.slice(start, start + filters.pageSize).map(listingToSummary);
      return {
        items,
        total: matched.length,
        page: filters.page,
        pageSize: filters.pageSize,
      };
    },

    async findListing(listingId: string): Promise<MarketplaceListingDetail | null> {
      return store.listings.find((l) => l.listingId === listingId) ?? null;
    },

    async listTenders(orgId: string | undefined): Promise<ReadonlyArray<TenderSummary>> {
      if (!orgId) return store.tenders;
      return store.tenders.filter((t) => t.orgId === orgId);
    },

    async createInquiry(input): Promise<InquiryRecord> {
      const row: InquiryRecord = {
        inquiryId: `inq_${Date.now()}_${store.inquiries.length}`,
        listingId: input.listingId,
        userId: input.userId,
        message: input.message,
        proposedPrice: input.proposedPrice,
        createdAt: new Date().toISOString(),
      };
      store.inquiries.push(row);
      return row;
    },

    async createApplication(input): Promise<ApplicationRecord> {
      const row: ApplicationRecord = {
        applicationId: `app_${Date.now()}_${store.applications.length}`,
        listingId: input.listingId,
        userId: input.userId,
        status: 'submitted',
        letterBody: input.letterBody,
        expectedResponseAt: null,
        createdAt: new Date().toISOString(),
      };
      store.applications.push(row);
      return row;
    },

    async redeemJoinCode(input) {
      const normalised = input.code.trim().toUpperCase();
      const row = store.joinCodes.find((c) => c.code === normalised);
      if (!row) return { ok: false, error: 'CODE_NOT_FOUND' } as const;
      if (row.revokedAt) return { ok: false, error: 'CODE_REVOKED' } as const;
      if (row.expiresAt && new Date(row.expiresAt) < new Date())
        return { ok: false, error: 'CODE_EXPIRED' } as const;
      if (row.maxUses !== null && row.usesCount >= row.maxUses)
        return { ok: false, error: 'CODE_EXHAUSTED' } as const;

      const existing = store.memberships.find(
        (m) => m.userId === input.userId && m.orgId === row.orgId && m.role === row.role,
      );
      if (existing) return { ok: false, error: 'ALREADY_MEMBER' } as const;

      const org = store.orgs.find((o) => o.orgId === row.orgId);
      if (!org) return { ok: false, error: 'CODE_NOT_FOUND' } as const;

      const userOrgId = `uorg_${Date.now()}_${store.memberships.length}`;
      const joinedAt = new Date().toISOString();
      const membership: Membership = {
        userOrgId,
        userId: input.userId,
        orgId: row.orgId,
        role: row.role,
        joinedAt,
        activeLeaseCount: 0,
      };
      store.memberships.push(membership);
      row.usesCount += 1;
      const redemption: JoinCodeRedemption = {
        orgId: row.orgId,
        orgName: org.name,
        role: row.role,
        userOrgId,
        joinedAt,
      };
      return { ok: true, value: redemption } as const;
    },
  };
}

/**
 * Read-side helper used by `/me/orgs` (NOT on the data-port interface
 * because that's read by the marketplace router only — this helper is
 * called by the membership widget endpoint).
 */
export function listMembershipsForUser(
  store: InMemoryStore,
  userId: string,
): ReadonlyArray<OrgMembership> {
  const orgsById = new Map(store.orgs.map((o) => [o.orgId, o]));
  return store.memberships
    .filter((m) => m.userId === userId)
    .map((m) => {
      const org = orgsById.get(m.orgId);
      return {
        orgId: m.orgId,
        orgName: org?.name ?? m.orgId,
        role: m.role,
        joinedAt: m.joinedAt,
        activeLeaseCount: m.activeLeaseCount,
      };
    });
}

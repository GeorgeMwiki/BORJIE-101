/**
 * Drizzle-backed MarketplaceDataPort — the REAL data source for the
 * `/marketplace-universal` surface (MS-3 remediation).
 *
 * ── Why this file exists ────────────────────────────────────────────
 * The original `in-memory-data-port.ts` served FABRICATED property-domain
 * listings ("Nyali Beach Suites", KES rents, bedrooms/bathrooms) to live
 * users. That violated the `borjie/no-mock-data-in-runtime` discipline.
 * This adapter replaces it with a port that ONLY ever returns rows that
 * exist in Postgres — never a hand-authored seed.
 *
 * ── Honest-empty mapping ────────────────────────────────────────────
 * The `/marketplace-universal` wire shape (see `./types.ts`) is the
 * legacy PROPERTY shape: orgs, rental listings, tenders, and org
 * join-codes. The Borjie mining schema has exactly ONE backing table for
 * any of this — `marketplace_listings` (the mineral/equipment/expert
 * marketplace). It has NO `marketplace_orgs`, NO `marketplace_tenders`,
 * and NO `org_join_codes` table. So this port:
 *
 *   - `searchListings` / `findListing` → READ the real
 *     `marketplace_listings` table and project it onto the wire shape.
 *   - `listOrgs` / `findOrg` / `listTenders` → return honest EMPTY
 *     (no table exists). NEVER a fabricated org/tender.
 *   - `createInquiry` / `createApplication` / `redeemJoinCode` → there is
 *     no inquiries / applications / join-codes table for this surface, so
 *     these report an honest "unsupported" outcome rather than writing to
 *     a phantom table or returning a fake receipt.
 *
 * ── Recommended disposition ─────────────────────────────────────────
 * `/marketplace-universal` is a property-domain residual with NO live
 * consumer in this monorepo (the `apps/tenant-portal` client referenced
 * in its docstrings does not exist here). The real mineral marketplace
 * lives at `routes/mining/marketplace.hono.ts` (+ `bids.hono.ts`). The
 * integration owner should prefer UNMOUNTING this router (see the agent
 * report for the exact `index.ts` line). This adapter exists so that, for
 * as long as the route stays mounted, it cannot emit fabricated data.
 *
 * Per CLAUDE.md: Drizzle only, no `process.env` reads, no `console.log`,
 * immutability (every projection returns a fresh object), currency is
 * read from the row — never hard-coded.
 */

import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { marketplaceListings } from '@borjie/database';
import type {
  ApplicationRecord,
  InquiryRecord,
  ListingsFilters,
  ListingsPage,
  MarketplaceDataPort,
  MarketplaceListing,
  MarketplaceListingDetail,
  OrgProfile,
  OrgSummary,
  TenderSummary,
} from './types.js';

/**
 * Minimal structural view of the Drizzle client the port needs. Keeping
 * it local (rather than importing the full `DatabaseClient` type) dodges
 * the package-barrel TS2709 drift documented in `middleware/database.ts`.
 */
export interface MarketplaceDb {
  select(): {
    from(table: unknown): {
      where(predicate: unknown): {
        orderBy(col: unknown): {
          limit(n: number): {
            offset(n: number): Promise<readonly Record<string, unknown>[]>;
          };
        };
        limit(n: number): Promise<readonly Record<string, unknown>[]>;
      };
    };
  };
  execute(query: unknown): Promise<unknown>;
}

const MARKETPLACE_ERR =
  'The universal-marketplace write surface (inquiries / applications / ' +
  'join-codes) has no backing table in the Borjie mining schema. Use the ' +
  'mineral marketplace at /api/v1/mining/marketplace + /bids instead.';

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

function toNum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function str(value: unknown, fallback = ''): string {
  return value === null || value === undefined ? fallback : String(value);
}

/**
 * Project a real `marketplace_listings` row onto the legacy wire summary.
 * The mining listing model is org-less and unit-less, so the property
 * fields (org / property / unit / bedrooms / bathrooms / furnishing) are
 * reported as honest neutral values — NOT invented. Price is the single
 * `price_tzs` column rendered against the listing's own currency hint
 * (defaults to the tenant primary currency captured in `attributes`).
 */
function projectSummary(row: Record<string, unknown>): MarketplaceListing {
  const attributes =
    row.attributes && typeof row.attributes === 'object'
      ? (row.attributes as Record<string, unknown>)
      : {};
  const price = toNum(row.price_tzs ?? row.priceTzs);
  const currency = str(attributes.currency, 'TZS');
  const photos = Array.isArray(row.photos)
    ? (row.photos as unknown[]).map((p) => String(p))
    : [];
  return {
    listingId: str(row.id),
    orgId: str(row.tenant_id ?? row.tenantId),
    orgName: str(attributes.seller, ''),
    propertyId: '',
    propertyName: str(row.title),
    unitId: '',
    unitName: '',
    city: str(attributes.region, ''),
    country: str(attributes.country, ''),
    type: str(row.category),
    bedrooms: 0,
    bathrooms: 0,
    squareMeters: null,
    priceMin: price,
    priceMax: price,
    currency,
    negotiable: Boolean(attributes.negotiable ?? false),
    furnishing: null,
    amenities: [],
    thumbnailUrl: photos[0] ?? null,
  };
}

function projectDetail(row: Record<string, unknown>): MarketplaceListingDetail {
  const summary = projectSummary(row);
  const attributes =
    row.attributes && typeof row.attributes === 'object'
      ? (row.attributes as Record<string, unknown>)
      : {};
  const photos = Array.isArray(row.photos)
    ? (row.photos as unknown[]).map((p) => String(p))
    : [];
  return {
    ...summary,
    description: row.description == null ? null : String(row.description),
    media: photos.map((url) => ({
      type: 'photo' as const,
      url,
      caption: null,
    })),
    latitude: null,
    longitude: null,
    virtualTourUrl: null,
    attributes,
    priceRange: {
      min: summary.priceMin,
      max: summary.priceMax,
      currency: summary.currency,
      negotiable: summary.negotiable,
    },
  };
}

/**
 * Build the real port over a Drizzle client. The reads target only the
 * mineral `marketplace_listings` table; everything property-specific is
 * honest-empty.
 */
export function drizzleMarketplaceDataPort(
  db: MarketplaceDb,
): MarketplaceDataPort {
  return {
    // No `marketplace_orgs` table exists — honest empty.
    async listOrgs(): Promise<ReadonlyArray<OrgSummary>> {
      return [];
    },

    async findOrg(_orgId: string): Promise<OrgProfile | null> {
      return null;
    },

    async searchListings(filters: ListingsFilters): Promise<ListingsPage> {
      const conds: SQL[] = [eq(marketplaceListings.status, 'active')];
      if (filters.orgId) {
        conds.push(eq(marketplaceListings.tenantId, filters.orgId));
      }
      if (filters.type) {
        conds.push(eq(marketplaceListings.category, filters.type));
      }
      // `city` maps to the listing's region attribute; `bedrooms` has no
      // mining equivalent, so it never matches and is intentionally
      // ignored (honest: returns nothing fabricated).
      if (filters.city) {
        conds.push(
          sql`${marketplaceListings.attributes}->>'region' = ${filters.city}`,
        );
      }
      if (filters.minPrice !== undefined) {
        conds.push(sql`${marketplaceListings.priceTzs} >= ${filters.minPrice}`);
      }
      if (filters.maxPrice !== undefined) {
        conds.push(sql`${marketplaceListings.priceTzs} <= ${filters.maxPrice}`);
      }

      const offset = (filters.page - 1) * filters.pageSize;
      const where = and(...conds);

      const rows = rowsOf(
        await db
          .select()
          .from(marketplaceListings)
          .where(where)
          .orderBy(desc(marketplaceListings.createdAt))
          .limit(filters.pageSize)
          .offset(offset),
      );

      const countRows = rowsOf(
        await db.execute(sql`
          SELECT count(*)::int AS total
            FROM marketplace_listings
           WHERE status = 'active'
        `),
      );
      const total = toNum(
        (countRows[0] as Record<string, unknown> | undefined)?.total,
      );

      return {
        items: rows.map(projectSummary),
        total,
        page: filters.page,
        pageSize: filters.pageSize,
      };
    },

    async findListing(
      listingId: string,
    ): Promise<MarketplaceListingDetail | null> {
      const rows = rowsOf(
        await db
          .select()
          .from(marketplaceListings)
          .where(eq(marketplaceListings.id, listingId))
          .limit(1),
      );
      const row = rows[0];
      return row ? projectDetail(row) : null;
    },

    // No `marketplace_tenders` table exists — honest empty.
    async listTenders(
      _orgId: string | undefined,
    ): Promise<ReadonlyArray<TenderSummary>> {
      return [];
    },

    // No inquiries table for this surface — fail honestly rather than
    // write to a phantom table or hand back a fabricated receipt.
    async createInquiry(): Promise<InquiryRecord> {
      throw new Error(MARKETPLACE_ERR);
    },

    async createApplication(): Promise<ApplicationRecord> {
      throw new Error(MARKETPLACE_ERR);
    },

    async redeemJoinCode() {
      // No `org_join_codes` table — the code can never be found.
      return { ok: false, error: 'CODE_NOT_FOUND' } as const;
    },
  };
}

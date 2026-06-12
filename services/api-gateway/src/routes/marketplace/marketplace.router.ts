/**
 * /v1/marketplace — tenant-facing universal marketplace.
 *
 * The marketplace router exposes the cross-org browsing surface from
 * Section 4 of the questionnaire. A tenant browses orgs, listings, and
 * tender packages across the platform; auth-gated routes let them
 * inquire, apply, and join an org via a special code.
 *
 * Routes:
 *
 *   PUBLIC:
 *     GET  /v1/marketplace/orgs                       — list orgs with public presence
 *     GET  /v1/marketplace/orgs/:orgId                — org public profile
 *     GET  /v1/marketplace/listings                   — paginated cross-org search
 *     GET  /v1/marketplace/listings/:listingId        — full listing detail
 *     GET  /v1/marketplace/tenders                    — public tenders (?orgId optional)
 *
 *   AUTH-REQUIRED:
 *     POST /v1/marketplace/listings/:listingId/inquiries
 *     POST /v1/marketplace/listings/:listingId/applications
 *     POST /v1/marketplace/join-org                   — redeem special code
 *
 * Auth gate: `authMiddleware` is mounted only on the mutating
 * sub-routes, NOT on the whole router — public reads are anonymous on
 * purpose (the marketplace IS the discovery surface).
 *
 * Observability: every mutating route is wrapped in
 * `withSecurityEvents` for the SOC 2 CC7.2 audit trail. (Task spec
 * calls out `withSecurityEventsFastify`; the api-gateway is a Hono app
 * so we use the Hono-flavoured variant from the SAME
 * `@borjie/observability` HOF family — semantically equivalent.)
 *
 * Data port: the router holds a `MarketplaceDataPort` instance. The
 * composition root will swap the default seeded in-memory adapter for
 * a Postgres-backed one once the 0172 migration ships in prod.
 *
 * Cross-collision note:
 *   - This is NEW work under `routes/marketplace/`. It does NOT touch
 *     `routes/marketplace.router.ts` (the legacy org-side router that
 *     manages listing publishing for portfolio owners).
 */

import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth.js';
import { databaseMiddleware } from '../../middleware/database.js';
import {
  emptyInMemoryStore,
  inMemoryDataPort,
  type InMemoryStore,
} from './in-memory-data-port.js';
import {
  drizzleMarketplaceDataPort,
  type MarketplaceDb,
} from './drizzle-data-port.js';
import type { MarketplaceDataPort } from './types.js';

// ────────────────────────────────────────────────────────────────────
// Schemas
// ────────────────────────────────────────────────────────────────────

const ListingsQuerySchema = z.object({
  orgId: z.string().optional(),
  city: z.string().optional(),
  type: z.string().optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
  bedrooms: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

const InquirySchema = z.object({
  message: z.string().min(1).max(2000),
  proposedPrice: z.number().int().positive().optional(),
});

const ApplicationSchema = z.object({
  letterBody: z.string().min(20).max(8000),
});

const JoinOrgSchema = z.object({
  orgCode: z.string().min(2).max(64),
});

const TendersQuerySchema = z.object({
  orgId: z.string().optional(),
});

// ────────────────────────────────────────────────────────────────────
// Router factory — the composition root passes a data port. The
// default port is a seeded in-memory store so route tests + local
// dev work without a database.
// ────────────────────────────────────────────────────────────────────

export interface MarketplaceRouterDeps {
  /**
   * Static data port (tests + the legacy in-memory path). When omitted,
   * the router resolves a real Drizzle-backed port from the per-request
   * `c.get('db')` so production never serves a hand-authored fixture.
   */
  readonly dataPort?: MarketplaceDataPort;
  /**
   * Per-request resolver. Takes precedence over `dataPort`. Used by the
   * default singleton to bind a Drizzle port to the request-scoped,
   * RLS-pinned connection.
   */
  readonly resolveDataPort?: (c: Context) => MarketplaceDataPort;
  /** Exposed only so the membership widget can read multi-org tenancy. */
  readonly readMemberships: (userId: string) => ReadonlyArray<{
    readonly orgId: string;
    readonly orgName: string;
    readonly role: 'tenant' | 'prospect' | 'vendor';
    readonly joinedAt: string;
    readonly activeLeaseCount: number;
  }>;
}

export function createMarketplaceRouter(deps: MarketplaceRouterDeps): Hono {
  const router = new Hono();
  const { readMemberships } = deps;

  // Resolve the data port for THIS request. A static `dataPort` (tests)
  // wins for determinism; otherwise the per-request resolver binds a real
  // Drizzle port. As a last resort we return an honest EMPTY port — never
  // a fabricated-fixture port.
  const getPort = (c: Context): MarketplaceDataPort => {
    if (deps.dataPort) return deps.dataPort;
    if (deps.resolveDataPort) return deps.resolveDataPort(c);
    return inMemoryDataPort(emptyInMemoryStore());
  };

  // ─── PUBLIC: orgs list ─────────────────────────────────────────
  router.get('/orgs', async (c) => {
    const orgs = await getPort(c).listOrgs();
    return c.json({ success: true, data: orgs });
  });

  // ─── PUBLIC: org profile ───────────────────────────────────────
  router.get('/orgs/:orgId', async (c) => {
    const orgId = c.req.param('orgId');
    const profile = await getPort(c).findOrg(orgId);
    if (!profile) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Org not found' } },
        404,
      );
    }
    return c.json({ success: true, data: profile });
  });

  // ─── PUBLIC: cross-org listing search ──────────────────────────
  // INTENTIONALLY PUBLIC (hardening R-2): the mineral marketplace is a
  // public-discovery surface — any buyer browses listings across ALL
  // sellers; that cross-org reach IS the product. There is NO membership
  // gate here BY DESIGN, and none is needed: the data port hard-filters
  // `status = 'active'` (drizzle-data-port.ts searchListings), so only
  // listings a seller has explicitly published are ever returned. The
  // optional `orgId` filter is a PUBLIC narrowing to one seller's active
  // listings — it exposes nothing a buyer couldn't already page to. Buyer
  // ≠ tenant (corrected model): a buyer holds no tenant-insider membership
  // to check against, so an "active membership in orgId" gate would be both
  // wrong (breaks public browse) and impossible (buyers aren't members).
  // Per-buyer / connected-seller scoping, when wanted, is a CLIENT-side
  // filter over GET /memberships/me, not a server-side access gate.
  router.get('/listings', async (c) => {
    const parsed = ListingsQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: parsed.error.message },
        },
        400,
      );
    }
    if (
      parsed.data.minPrice !== undefined &&
      parsed.data.maxPrice !== undefined &&
      parsed.data.minPrice > parsed.data.maxPrice
    ) {
      return c.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: 'minPrice must be <= maxPrice' },
        },
        400,
      );
    }
    const filters: import('./types').ListingsFilters = {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    };
    if (parsed.data.city !== undefined) (filters as { city?: string }).city = parsed.data.city;
    if (parsed.data.type !== undefined) (filters as { type?: string }).type = parsed.data.type;
    if (parsed.data.bedrooms !== undefined) (filters as { bedrooms?: number }).bedrooms = parsed.data.bedrooms;
    if (parsed.data.orgId !== undefined) (filters as { orgId?: string }).orgId = parsed.data.orgId;
    if (parsed.data.minPrice !== undefined) (filters as { minPrice?: number }).minPrice = parsed.data.minPrice;
    if (parsed.data.maxPrice !== undefined) (filters as { maxPrice?: number }).maxPrice = parsed.data.maxPrice;
    const page = await getPort(c).searchListings(filters);
    return c.json({
      success: true,
      data: page.items,
      meta: { total: page.total, page: page.page, pageSize: page.pageSize },
    });
  });

  // ─── PUBLIC: listing detail ────────────────────────────────────
  router.get('/listings/:listingId', async (c) => {
    const listing = await getPort(c).findListing(c.req.param('listingId'));
    if (!listing) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Listing not found' } },
        404,
      );
    }
    return c.json({ success: true, data: listing });
  });

  // ─── PUBLIC: tenders feed ──────────────────────────────────────
  router.get('/tenders', async (c) => {
    const parsed = TendersQuerySchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      return c.json(
        {
          success: false,
          error: { code: 'BAD_REQUEST', message: parsed.error.message },
        },
        400,
      );
    }
    const tenders = await getPort(c).listTenders(parsed.data.orgId);
    return c.json({ success: true, data: tenders });
  });

  // ─── AUTH GATE: everything below requires a valid session ──────
  router.use('/listings/:listingId/inquiries', authMiddleware);
  router.use('/listings/:listingId/applications', authMiddleware);
  router.use('/join-org', authMiddleware);
  router.use('/me/*', authMiddleware);

  // ─── POST /listings/:listingId/inquiries ───────────────────────
  router.post(
    '/listings/:listingId/inquiries',
    withSecurityEvents(
      {
        action: 'marketplace.inquiry.create',
        resource: 'marketplace_inquiry',
        severity: 'info',
      },
      async (c) => {
        const auth = c.get('auth');
        if (!auth) {
          return c.json(
            {
              success: false,
              error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            },
            401,
          );
        }
        let body: unknown;
        try {
          body = await c.req.json();
        } catch {
          return c.json(
            {
              success: false,
              error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
            },
            400,
          );
        }
        const parsed = InquirySchema.safeParse(body);
        if (!parsed.success) {
          return c.json(
            {
              success: false,
              error: { code: 'BAD_REQUEST', message: parsed.error.message },
            },
            400,
          );
        }
        const dataPort = getPort(c);
        const listingId = c.req.param('listingId');
        const listing = await dataPort.findListing(listingId);
        if (!listing) {
          return c.json(
            {
              success: false,
              error: { code: 'NOT_FOUND', message: 'Listing not found' },
            },
            404,
          );
        }
        const inquiry = await dataPort.createInquiry({
          listingId,
          userId: auth.userId,
          message: parsed.data.message,
          proposedPrice: parsed.data.proposedPrice ?? null,
        });
        return c.json({ success: true, data: inquiry }, 201);
      },
    ),
  );

  // ─── POST /listings/:listingId/applications ────────────────────
  router.post(
    '/listings/:listingId/applications',
    withSecurityEvents(
      {
        action: 'marketplace.application.create',
        resource: 'marketplace_application',
        severity: 'info',
      },
      async (c) => {
        const auth = c.get('auth');
        if (!auth) {
          return c.json(
            {
              success: false,
              error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            },
            401,
          );
        }
        let body: unknown;
        try {
          body = await c.req.json();
        } catch {
          return c.json(
            {
              success: false,
              error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
            },
            400,
          );
        }
        const parsed = ApplicationSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(
            {
              success: false,
              error: { code: 'BAD_REQUEST', message: parsed.error.message },
            },
            400,
          );
        }
        const dataPort = getPort(c);
        const listingId = c.req.param('listingId');
        const listing = await dataPort.findListing(listingId);
        if (!listing) {
          return c.json(
            {
              success: false,
              error: { code: 'NOT_FOUND', message: 'Listing not found' },
            },
            404,
          );
        }
        const application = await dataPort.createApplication({
          listingId,
          userId: auth.userId,
          letterBody: parsed.data.letterBody,
        });
        return c.json({ success: true, data: application }, 201);
      },
    ),
  );

  // ─── POST /join-org ────────────────────────────────────────────
  router.post(
    '/join-org',
    withSecurityEvents(
      {
        action: 'marketplace.org.join',
        resource: 'org_membership',
        severity: 'notice',
      },
      async (c) => {
        const auth = c.get('auth');
        if (!auth) {
          return c.json(
            {
              success: false,
              error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            },
            401,
          );
        }
        let body: unknown;
        try {
          body = await c.req.json();
        } catch {
          return c.json(
            {
              success: false,
              error: { code: 'INVALID_JSON', message: 'invalid JSON body' },
            },
            400,
          );
        }
        const parsed = JoinOrgSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(
            {
              success: false,
              error: { code: 'BAD_REQUEST', message: parsed.error.message },
            },
            400,
          );
        }
        const result = await getPort(c).redeemJoinCode({
          userId: auth.userId,
          code: parsed.data.orgCode,
        });
        if (!result.ok) {
          const status =
            result.error === 'CODE_NOT_FOUND' || result.error === 'CODE_REVOKED'
              ? 404
              : result.error === 'ALREADY_MEMBER'
                ? 409
                : 400;
          return c.json(
            {
              success: false,
              error: { code: result.error, message: codeErrorMessage(result.error) },
            },
            status,
          );
        }
        return c.json({ success: true, data: result.value }, 201);
      },
    ),
  );

  // ─── GET /me/orgs — multi-org tenancy widget data ──────────────
  router.get('/me/orgs', (c) => {
    const auth = c.get('auth');
    if (!auth) {
      return c.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        },
        401,
      );
    }
    const memberships = readMemberships(auth.userId);
    return c.json({ success: true, data: memberships });
  });

  return router;
}

function codeErrorMessage(
  code:
    | 'CODE_NOT_FOUND'
    | 'CODE_EXPIRED'
    | 'CODE_EXHAUSTED'
    | 'CODE_REVOKED'
    | 'ALREADY_MEMBER',
): string {
  switch (code) {
    case 'CODE_NOT_FOUND':
      return 'No org found for that code.';
    case 'CODE_EXPIRED':
      return 'This code has expired.';
    case 'CODE_EXHAUSTED':
      return 'This code has reached its use limit.';
    case 'CODE_REVOKED':
      return 'This code has been revoked.';
    case 'ALREADY_MEMBER':
      return 'You already have a membership for this org and role.';
  }
}

// ────────────────────────────────────────────────────────────────────
// Default singleton — the composition root mounts this. Tests build
// their own via `createMarketplaceRouter({ dataPort: ... })`.
//
// MS-3: the singleton is now backed by a REAL Drizzle port resolved from
// the request-scoped, RLS-pinned `c.get('db')`. It NEVER serves a
// fabricated fixture. When no DB is configured (mock mode), the resolver
// degrades to an honest EMPTY in-memory store — still zero fake data.
//
// NOTE (integration): `/marketplace-universal` is a property-domain
// residual with no live consumer in this monorepo. The recommended
// disposition is to UNMOUNT it (see the agent report). This wiring exists
// so that, while it remains mounted, it cannot emit fabricated data.
// ────────────────────────────────────────────────────────────────────

function resolveSingletonPort(c: Context): MarketplaceDataPort {
  const db = c.get('db') as MarketplaceDb | null | undefined;
  if (db) return drizzleMarketplaceDataPort(db);
  // No live DB on the context — honest empty, never the old fake seed.
  return inMemoryDataPort(emptyInMemoryStore());
}

// Build the singleton router, then prepend `databaseMiddleware` so the
// request-scoped Drizzle client is available to `resolveSingletonPort`.
const singletonRouter = new Hono();
singletonRouter.use('*', databaseMiddleware);
singletonRouter.route(
  '/',
  createMarketplaceRouter({
    resolveDataPort: resolveSingletonPort,
    // Memberships have no backing table on this surface — honest empty.
    readMemberships: () => [],
  }),
);

export const universalMarketplaceRouter = singletonRouter;

/**
 * Re-exported for tests. The default singleton no longer owns a seeded
 * store (MS-3 killed the fake seed), so this is an EMPTY store kept only
 * for backwards-compatible imports.
 */
export const __defaultStoreForTests: InMemoryStore = emptyInMemoryStore();

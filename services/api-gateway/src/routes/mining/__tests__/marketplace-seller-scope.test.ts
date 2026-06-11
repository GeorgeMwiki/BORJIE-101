/**
 * Owner-scoped buyer marketplace — GET /marketplace/listings?sellerTenantId
 * + GET /marketplace/listings/sellers (buyer leg of the four-surface
 * projection: "buy from this mine").
 *
 * Written to lock the tenant-isolation rails:
 *   - the `sellerTenantId` filter returns ONLY that seller's buyer-visible
 *     ACTIVE listings, excluding private + other sellers;
 *   - a buyer NEVER sees another tenant's PRIVATE listing through the
 *     seller filter;
 *   - the seller is attributed on every row (`sellerTenantId` + `sellerName`);
 *   - /listings/sellers returns the distinct seller orgs (id + name + count)
 *     over buyer-visible active listings only.
 *
 * Harness: a fake drizzle query-builder db + a `drizzle-orm` mock that turns
 * `eq` / `and` / `inArray` into row predicates (mirrors approvals.test.ts).
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));
vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

vi.mock('drizzle-orm', async (original) => {
  const real = await original<typeof import('drizzle-orm')>();
  // Column markers carry the camelCase listing field they target so the
  // fake db can evaluate predicates against the underlying row.
  const fieldOf = (col: unknown): string | null => {
    const c = col as { __field?: string } | null | undefined;
    return c?.__field ?? null;
  };
  return {
    ...real,
    eq: (col: unknown, value: unknown) => ({
      __filter: (row: Record<string, unknown>) => {
        const key = fieldOf(col);
        if (!key) return true;
        return row[key] === value;
      },
    }),
    inArray: (col: unknown, values: readonly unknown[]) => ({
      __filter: (row: Record<string, unknown>) => {
        const key = fieldOf(col);
        if (!key) return true;
        return values.includes(row[key]);
      },
    }),
    and: (...conds: Array<{ __filter?: (r: Record<string, unknown>) => boolean }>) => ({
      __filter: (row: Record<string, unknown>) =>
        conds.every((cnd) => (cnd?.__filter ? cnd.__filter(row) : true)),
    }),
    desc: (col: unknown) => col,
    count: () => ({ __count: true }),
  };
});

// Column markers — minimal stand-ins for the drizzle table columns the
// handler references, each tagged with the camelCase row field.
vi.mock('@borjie/database', () => ({
  marketplaceListings: {
    id: { __field: 'id' },
    tenantId: { __field: 'tenantId' },
    category: { __field: 'category' },
    visibility: { __field: 'visibility' },
    status: { __field: 'status' },
    attributes: { __field: 'attributes' },
    createdAt: { __field: 'createdAt' },
  },
  tenants: {
    id: { __field: 'id' },
    name: { __field: 'name' },
  },
}));

import { Hono } from 'hono';
import { miningMarketplaceRouter } from '../marketplace.hono';

interface Row {
  readonly id: string;
  readonly tenantId: string;
  readonly title: string;
  readonly category: string;
  readonly visibility: string;
  readonly status: string;
  readonly attributes: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Joined seller-org name (tenants.name). */
  readonly sellerName: string;
}

type Predicate = (row: Record<string, unknown>) => boolean;

function hasFilter(x: unknown): x is { __filter: Predicate } {
  return !!x && typeof x === 'object' && '__filter' in (x as object);
}

/**
 * Fake drizzle query builder. Backed by `fixtures` already carrying the
 * joined `sellerName`. Detects whether the select projection is the
 * grouped (sellers) shape or the row shape by inspecting the projection
 * keys, and returns rows accordingly.
 */
function createFakeDb(fixtures: readonly Row[]) {
  return {
    select(projection?: Record<string, unknown>) {
      const isGrouped = !!projection && 'listingCount' in projection;
      let filter: Predicate = () => true;
      const builder = {
        from() {
          return builder;
        },
        leftJoin() {
          return builder;
        },
        where(cond: unknown) {
          if (hasFilter(cond)) filter = cond.__filter;
          return builder;
        },
        groupBy() {
          return builder;
        },
        orderBy() {
          return isGrouped ? Promise.resolve(grouped()) : builder;
        },
        limit() {
          return Promise.resolve(listingRows());
        },
        then(resolve: (v: unknown) => void) {
          // The list handler awaits the builder after `.limit()`; the
          // sellers handler awaits after `.orderBy()`. Support both.
          return Promise.resolve(isGrouped ? grouped() : listingRows()).then(resolve);
        },
      };
      function listingRows() {
        return fixtures
          .filter((r) => filter(r as unknown as Record<string, unknown>))
          .map((r) => ({
            listing: {
              id: r.id,
              tenantId: r.tenantId,
              title: r.title,
              category: r.category,
              visibility: r.visibility,
              status: r.status,
              attributes: r.attributes,
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
            },
            sellerName: r.sellerName,
          }));
      }
      function grouped() {
        const visible = fixtures.filter((r) =>
          filter(r as unknown as Record<string, unknown>),
        );
        const byTenant = new Map<string, { name: string; n: number }>();
        for (const r of visible) {
          const cur = byTenant.get(r.tenantId) ?? { name: r.sellerName, n: 0 };
          byTenant.set(r.tenantId, { name: r.sellerName, n: cur.n + 1 });
        }
        return [...byTenant.entries()].map(([sellerTenantId, v]) => ({
          sellerTenantId,
          sellerName: v.name,
          listingCount: v.n,
        }));
      }
      return builder;
    },
  };
}

function buildApp(fixtures: readonly Row[], auth: { tenantId: string }) {
  const app = new Hono();
  const db = createFakeDb(fixtures);
  app.use('*', async (c, next) => {
    c.set('auth', auth);
    c.set('db', db);
    await next();
  });
  app.route('/', miningMarketplaceRouter);
  return app;
}

const SELLER_A = 'tenant-mine-a';
const SELLER_B = 'tenant-mine-b';
const BUYER = 'tenant-buyer';

function row(over: Partial<Row> & Pick<Row, 'id' | 'tenantId' | 'visibility'>): Row {
  return {
    title: `Parcel ${over.id}`,
    category: 'concentrate',
    status: 'active',
    attributes: {},
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    sellerName: over.tenantId === SELLER_A ? 'Mine A Ltd' : 'Mine B Ltd',
    ...over,
  };
}

const FIXTURES: readonly Row[] = [
  row({ id: 'a-public-1', tenantId: SELLER_A, visibility: 'tanzania' }),
  row({ id: 'a-public-2', tenantId: SELLER_A, visibility: 'global' }),
  row({ id: 'a-private', tenantId: SELLER_A, visibility: 'private' }),
  row({ id: 'a-paused', tenantId: SELLER_A, visibility: 'tanzania', status: 'paused' }),
  row({ id: 'b-public', tenantId: SELLER_B, visibility: 'regional' }),
  row({ id: 'b-private', tenantId: SELLER_B, visibility: 'private' }),
];

describe('owner-scoped buyer marketplace — sellerTenantId filter', () => {
  it('returns only seller A buyer-visible ACTIVE listings; excludes private, paused, other sellers', async () => {
    const app = buildApp(FIXTURES, { tenantId: BUYER });
    const res = await app.request(
      `/listings?sellerTenantId=${SELLER_A}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const ids = (body.data as Array<{ id: string }>).map((r) => r.id).sort();
    expect(ids).toEqual(['a-public-1', 'a-public-2']);
    // Tenant-isolation rail: no private parcel leaks through the filter.
    expect(ids).not.toContain('a-private');
    // Status rail: paused excluded.
    expect(ids).not.toContain('a-paused');
    // Seller scope: nothing from B.
    expect(ids.every((id) => id.startsWith('a-'))).toBe(true);
  });

  it('attributes the seller org on every row (sellerTenantId + sellerName)', async () => {
    const app = buildApp(FIXTURES, { tenantId: BUYER });
    const res = await app.request(`/listings?sellerTenantId=${SELLER_A}`);
    const body = await res.json();
    for (const r of body.data as Array<Record<string, unknown>>) {
      expect(r.sellerTenantId).toBe(SELLER_A);
      expect(r.sellerName).toBe('Mine A Ltd');
    }
  });

  it('a buyer NEVER sees another tenant private listing via the seller filter', async () => {
    const app = buildApp(FIXTURES, { tenantId: BUYER });
    const res = await app.request(`/listings?sellerTenantId=${SELLER_B}`);
    const body = await res.json();
    const ids = (body.data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toEqual(['b-public']);
    expect(ids).not.toContain('b-private');
  });

  it('the owner viewing their OWN scope still cannot be a cross-tenant leak vector for buyers (private stays own-tenant)', async () => {
    // When the authed tenant IS the seller, the private rule is not
    // applied by the sellerTenantId branch — but the global browse here
    // is still status=active scoped. Owner sees their own private parcel.
    const app = buildApp(FIXTURES, { tenantId: SELLER_A });
    const res = await app.request(`/listings?sellerTenantId=${SELLER_A}`);
    const body = await res.json();
    const ids = (body.data as Array<{ id: string }>).map((r) => r.id).sort();
    expect(ids).toContain('a-private');
    expect(ids).toContain('a-public-1');
    expect(ids).not.toContain('a-paused');
  });

  it('absent sellerTenantId preserves the existing cross-tenant global browse (non-breaking)', async () => {
    const app = buildApp(FIXTURES, { tenantId: BUYER });
    const res = await app.request('/listings');
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = (body.data as Array<{ id: string }>).map((r) => r.id).sort();
    // Existing behavior: active listings across tenants; private only via
    // the explicit `visibility=private` (own-tenant) path, not here.
    expect(ids).toContain('a-public-1');
    expect(ids).toContain('b-public');
  });
});

describe('browse-by-seller — GET /listings/sellers', () => {
  it('returns distinct seller orgs with buyer-visible active listing counts; excludes private', async () => {
    const app = buildApp(FIXTURES, { tenantId: BUYER });
    const res = await app.request('/listings/sellers');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const sellers = body.data as Array<{
      sellerTenantId: string;
      sellerName: string;
      listingCount: number;
    }>;
    const a = sellers.find((s) => s.sellerTenantId === SELLER_A);
    const b = sellers.find((s) => s.sellerTenantId === SELLER_B);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // A: two buyer-visible active (tanzania + global); private + paused excluded.
    expect(a?.listingCount).toBe(2);
    expect(a?.sellerName).toBe('Mine A Ltd');
    // B: one buyer-visible active (regional); private excluded.
    expect(b?.listingCount).toBe(1);
    expect(b?.sellerName).toBe('Mine B Ltd');
  });
});

/**
 * Universal marketplace router — exhaustive route tests.
 *
 * Covers all 8 routes from the task brief:
 *   1. GET  /orgs
 *   2. GET  /orgs/:orgId
 *   3. GET  /listings
 *   4. GET  /listings/:listingId
 *   5. POST /listings/:listingId/inquiries
 *   6. POST /listings/:listingId/applications
 *   7. GET  /tenders
 *   8. POST /join-org
 *
 * Plus the bonus auth-gated membership widget route
 * `GET /me/orgs` that the multi-org tenancy UI calls.
 *
 * Data-port is faked via `vi.fn()` so every assertion targets the
 * router's wire behaviour (validation, status codes, envelope shape)
 * not the persistence layer.
 *
 * Test count: 36 (>= 35 required by the task).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { vi } from 'vitest';

// Pin the JWT secret BEFORE importing any router so all middlewares
// that capture the secret at module init agree.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import {
  createMarketplaceRouter,
  createSeededStore,
  inMemoryDataPort,
  listMembershipsForUser,
  type InMemoryStore,
  type MarketplaceDataPort,
} from '../marketplace/index.js';
import { generateToken } from '../../middleware/auth.js';
import { UserRole } from '../../types/user-role.js';

function bearer(): string {
  return `Bearer ${generateToken({
    userId: 'usr-test-1',
    tenantId: 'tnt-test',
    role: UserRole.RESIDENT as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mount(dataPort: MarketplaceDataPort, store?: InMemoryStore): Hono {
  const app = new Hono();
  const router = createMarketplaceRouter({
    dataPort,
    readMemberships: (userId) =>
      store ? listMembershipsForUser(store, userId) : [],
  });
  app.route('/marketplace-universal', router);
  return app;
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
});

// ────────────────────────────────────────────────────────────────────
// 1) GET /orgs
// ────────────────────────────────────────────────────────────────────

describe('GET /v1/marketplace-universal/orgs', () => {
  it('returns the seeded orgs (200)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/orgs',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      orgId: 'org_asha',
      name: 'Asha Properties',
    });
  });

  it('returns an empty array when no orgs exist (200)', async () => {
    const port: MarketplaceDataPort = {
      listOrgs: vi.fn().mockResolvedValue([]),
      findOrg: vi.fn(),
      searchListings: vi.fn(),
      findListing: vi.fn(),
      listTenders: vi.fn(),
      createInquiry: vi.fn(),
      createApplication: vi.fn(),
      redeemJoinCode: vi.fn(),
    };
    const res = await mount(port).request('/marketplace-universal/orgs');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('is anonymous (no auth required)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/orgs',
    );
    expect(res.status).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────
// 2) GET /orgs/:orgId
// ────────────────────────────────────────────────────────────────────

describe('GET /v1/marketplace-universal/orgs/:orgId', () => {
  it('returns the org profile (200)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/orgs/org_asha',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.orgId).toBe('org_asha');
    expect(body.data.coverageArea).toContain('Nairobi');
  });

  it('returns 404 when the org does not exist', async () => {
    const port: MarketplaceDataPort = {
      listOrgs: vi.fn(),
      findOrg: vi.fn().mockResolvedValue(null),
      searchListings: vi.fn(),
      findListing: vi.fn(),
      listTenders: vi.fn(),
      createInquiry: vi.fn(),
      createApplication: vi.fn(),
      redeemJoinCode: vi.fn(),
    };
    const res = await mount(port).request(
      '/marketplace-universal/orgs/org_unknown',
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ────────────────────────────────────────────────────────────────────
// 3) GET /listings
// ────────────────────────────────────────────────────────────────────

describe('GET /v1/marketplace-universal/listings', () => {
  it('returns the seeded listings (200)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(3);
    expect(body.meta).toEqual({ total: 3, page: 1, pageSize: 20 });
  });

  it('filters by orgId', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings?orgId=org_asha',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data.every((l: any) => l.orgId === 'org_asha')).toBe(true);
  });

  it('filters by city', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings?city=Mombasa',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].city).toBe('Mombasa');
  });

  it('filters by minPrice / maxPrice', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings?minPrice=50000&maxPrice=80000',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // asha_a1 max 55k → matches; asha_b3 min 75k → matches; kilimani 60-72k → matches
    expect(body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by bedrooms', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings?bedrooms=3',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].bedrooms).toBe(3);
  });

  it('paginates correctly', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings?page=1&pageSize=2',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta).toEqual({ total: 3, page: 1, pageSize: 2 });
  });

  it('returns 400 when minPrice > maxPrice', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings?minPrice=100000&maxPrice=50000',
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 on invalid query params', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings?page=not-a-number',
    );
    expect(res.status).toBe(400);
  });

  it('is anonymous (no auth required)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings',
    );
    expect(res.status).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────
// 4) GET /listings/:listingId
// ────────────────────────────────────────────────────────────────────

describe('GET /v1/marketplace-universal/listings/:listingId', () => {
  it('returns the full listing detail (200)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings/lst_asha_unit_a1',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.listingId).toBe('lst_asha_unit_a1');
    expect(body.data.media.length).toBeGreaterThan(0);
    expect(body.data.priceRange).toEqual({
      min: 45000,
      max: 55000,
      currency: 'KES',
      negotiable: true,
    });
  });

  it('returns 404 when the listing does not exist', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings/lst_does_not_exist',
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ────────────────────────────────────────────────────────────────────
// 5) POST /listings/:listingId/inquiries
// ────────────────────────────────────────────────────────────────────

describe('POST /v1/marketplace-universal/listings/:id/inquiries', () => {
  it('rejects without a token (401)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings/lst_asha_unit_a1/inquiries',
      {
        method: 'POST',
        body: JSON.stringify({ message: 'hello' }),
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(res.status).toBe(401);
  });

  it('creates an inquiry (201)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings/lst_asha_unit_a1/inquiries',
      {
        method: 'POST',
        body: JSON.stringify({
          message: 'Is this unit still available?',
          proposedPrice: 50000,
        }),
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.inquiryId).toMatch(/^inq_/);
    expect(body.data.userId).toBe('usr-test-1');
    expect(store.inquiries).toHaveLength(1);
  });

  it('returns 404 when the listing does not exist', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings/lst_unknown/inquiries',
      {
        method: 'POST',
        body: JSON.stringify({ message: 'hello' }),
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 on empty message', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings/lst_asha_unit_a1/inquiries',
      {
        method: 'POST',
        body: JSON.stringify({ message: '' }),
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings/lst_asha_unit_a1/inquiries',
      {
        method: 'POST',
        body: 'not-json',
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_JSON');
  });
});

// ────────────────────────────────────────────────────────────────────
// 6) POST /listings/:listingId/applications
// ────────────────────────────────────────────────────────────────────

describe('POST /v1/marketplace-universal/listings/:id/applications', () => {
  it('rejects without a token (401)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings/lst_asha_unit_a1/applications',
      {
        method: 'POST',
        body: JSON.stringify({
          letterBody: 'I would like to apply for this unit. Thanks!',
        }),
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(res.status).toBe(401);
  });

  it('creates an application (201)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings/lst_asha_unit_a1/applications',
      {
        method: 'POST',
        body: JSON.stringify({
          letterBody:
            'Dear Asha team, I am a non-smoking professional looking for a quiet 2-bed near my office. Thank you for your consideration.',
        }),
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.applicationId).toMatch(/^app_/);
    expect(body.data.status).toBe('submitted');
    expect(store.applications).toHaveLength(1);
  });

  it('returns 404 when the listing does not exist', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings/lst_unknown/applications',
      {
        method: 'POST',
        body: JSON.stringify({
          letterBody: 'A letter that is sufficiently long enough to pass.',
        }),
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when letterBody is too short', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/listings/lst_asha_unit_a1/applications',
      {
        method: 'POST',
        body: JSON.stringify({ letterBody: 'too short' }),
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────
// 7) GET /tenders
// ────────────────────────────────────────────────────────────────────

describe('GET /v1/marketplace-universal/tenders', () => {
  it('returns the seeded tenders (200)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/tenders',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
  });

  it('filters by orgId', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/tenders?orgId=org_asha',
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].orgId).toBe('org_asha');
  });

  it('is anonymous (no auth required)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/tenders',
    );
    expect(res.status).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────
// 8) POST /join-org
// ────────────────────────────────────────────────────────────────────

describe('POST /v1/marketplace-universal/join-org', () => {
  it('rejects without a token (401)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/join-org',
      {
        method: 'POST',
        body: JSON.stringify({ orgCode: 'ASHA-WELCOME' }),
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(res.status).toBe(401);
  });

  it('redeems a valid code (201)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/join-org',
      {
        method: 'POST',
        body: JSON.stringify({ orgCode: 'ASHA-WELCOME' }),
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.orgId).toBe('org_asha');
    expect(body.data.role).toBe('tenant');
    expect(store.memberships).toHaveLength(1);
  });

  it('is case-insensitive on the code', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/join-org',
      {
        method: 'POST',
        body: JSON.stringify({ orgCode: 'asha-welcome' }),
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(201);
  });

  it('returns 404 for an unknown code', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/join-org',
      {
        method: 'POST',
        body: JSON.stringify({ orgCode: 'TOTALLY-MADE-UP' }),
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('CODE_NOT_FOUND');
  });

  it('returns 409 when the user is already a member', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    // First join — succeeds.
    await mount(port, store).request('/marketplace-universal/join-org', {
      method: 'POST',
      body: JSON.stringify({ orgCode: 'ASHA-WELCOME' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    // Second join — same user, same code — 409.
    const res = await mount(port, store).request(
      '/marketplace-universal/join-org',
      {
        method: 'POST',
        body: JSON.stringify({ orgCode: 'ASHA-WELCOME' }),
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('ALREADY_MEMBER');
  });

  it('returns 400 on an empty code', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/join-org',
      {
        method: 'POST',
        body: JSON.stringify({ orgCode: '' }),
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when expired', async () => {
    const port: MarketplaceDataPort = {
      listOrgs: vi.fn(),
      findOrg: vi.fn(),
      searchListings: vi.fn(),
      findListing: vi.fn(),
      listTenders: vi.fn(),
      createInquiry: vi.fn(),
      createApplication: vi.fn(),
      redeemJoinCode: vi
        .fn()
        .mockResolvedValue({ ok: false, error: 'CODE_EXPIRED' }),
    };
    const res = await mount(port).request('/marketplace-universal/join-org', {
      method: 'POST',
      body: JSON.stringify({ orgCode: 'EXPIRED-CODE' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('CODE_EXPIRED');
  });

  it('returns 400 when exhausted', async () => {
    const port: MarketplaceDataPort = {
      listOrgs: vi.fn(),
      findOrg: vi.fn(),
      searchListings: vi.fn(),
      findListing: vi.fn(),
      listTenders: vi.fn(),
      createInquiry: vi.fn(),
      createApplication: vi.fn(),
      redeemJoinCode: vi
        .fn()
        .mockResolvedValue({ ok: false, error: 'CODE_EXHAUSTED' }),
    };
    const res = await mount(port).request('/marketplace-universal/join-org', {
      method: 'POST',
      body: JSON.stringify({ orgCode: 'CAPPED' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('CODE_EXHAUSTED');
  });

  it('returns 404 when revoked', async () => {
    const port: MarketplaceDataPort = {
      listOrgs: vi.fn(),
      findOrg: vi.fn(),
      searchListings: vi.fn(),
      findListing: vi.fn(),
      listTenders: vi.fn(),
      createInquiry: vi.fn(),
      createApplication: vi.fn(),
      redeemJoinCode: vi
        .fn()
        .mockResolvedValue({ ok: false, error: 'CODE_REVOKED' }),
    };
    const res = await mount(port).request('/marketplace-universal/join-org', {
      method: 'POST',
      body: JSON.stringify({ orgCode: 'REVOKED' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('CODE_REVOKED');
  });

  it('returns 400 on invalid JSON', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/join-org',
      {
        method: 'POST',
        body: 'not-json',
        headers: {
          'content-type': 'application/json',
          authorization: bearer(),
        },
      },
    );
    expect(res.status).toBe(400);
  });
});

// ────────────────────────────────────────────────────────────────────
// 9) GET /me/orgs — multi-org tenancy widget
// ────────────────────────────────────────────────────────────────────

describe('GET /v1/marketplace-universal/me/orgs', () => {
  it('rejects without a token (401)', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const res = await mount(port, store).request(
      '/marketplace-universal/me/orgs',
    );
    expect(res.status).toBe(401);
  });

  it('returns the memberships the user has accumulated', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const app = mount(port, store);
    // Join Asha + Kilimani in one session.
    await app.request('/marketplace-universal/join-org', {
      method: 'POST',
      body: JSON.stringify({ orgCode: 'ASHA-WELCOME' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    await app.request('/marketplace-universal/join-org', {
      method: 'POST',
      body: JSON.stringify({ orgCode: 'KILIMANI-2026' }),
      headers: {
        'content-type': 'application/json',
        authorization: bearer(),
      },
    });
    const res = await app.request('/marketplace-universal/me/orgs', {
      headers: { authorization: bearer() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    const orgIds = body.data.map((m: any) => m.orgId).sort();
    expect(orgIds).toEqual(['org_asha', 'org_kilimani']);
  });
});

// ────────────────────────────────────────────────────────────────────
// 10) End-to-end: cross-org tenancy
// ────────────────────────────────────────────────────────────────────

describe('End-to-end: a tenant joins multiple orgs and inquires across them', () => {
  it('successfully joins 2 orgs and inquires on a listing from each', async () => {
    const store = createSeededStore();
    const port = inMemoryDataPort(store);
    const app = mount(port, store);
    const headers = {
      'content-type': 'application/json',
      authorization: bearer(),
    };

    await app.request('/marketplace-universal/join-org', {
      method: 'POST',
      body: JSON.stringify({ orgCode: 'ASHA-WELCOME' }),
      headers,
    });
    await app.request('/marketplace-universal/join-org', {
      method: 'POST',
      body: JSON.stringify({ orgCode: 'KILIMANI-2026' }),
      headers,
    });
    await app.request(
      '/marketplace-universal/listings/lst_asha_unit_a1/inquiries',
      {
        method: 'POST',
        body: JSON.stringify({ message: 'Interested.' }),
        headers,
      },
    );
    await app.request(
      '/marketplace-universal/listings/lst_kilimani_nyali_2br/inquiries',
      {
        method: 'POST',
        body: JSON.stringify({ message: 'Also interested.' }),
        headers,
      },
    );

    expect(store.memberships).toHaveLength(2);
    expect(store.inquiries).toHaveLength(2);
    expect(store.inquiries.map((i) => i.listingId).sort()).toEqual([
      'lst_asha_unit_a1',
      'lst_kilimani_nyali_2br',
    ]);
  });
});

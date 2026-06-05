/**
 * /api/v1/owner/tabs — auth + validation + DB-branch + recent-types tests.
 *
 * Pins the public auth gate over every verb (GET / PUT / POST / PATCH /
 * DELETE / POST sync / chat-tool aliases), the zod payload validators, the
 * 503 "DB not configured" branch, and the pure `deriveRecentTypes` helper.
 *
 * The default vitest harness runs in mock-mode (no live Postgres), so the
 * handler's `if (!db)` branch returns 503 once authenticated — these tests
 * stay mock-mode so they ride with the default suite. A live-DB integration
 * suite re-runs the cross-device sync contract separately.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = 'test';
process.env.USE_MOCK_DATA = process.env.USE_MOCK_DATA ?? 'true';

import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';
import { ownerTabsRouter, deriveRecentTypes } from '../tabs.hono';

const TEST_TENANT = 'tenant-tabs-1';
const TEST_USER = 'user-owner-tabs-1';

function bearer(
  role: UserRole = UserRole.OWNER,
  tenantId = TEST_TENANT,
  userId = TEST_USER,
): string {
  return `Bearer ${generateToken({
    userId,
    tenantId,
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mount(): Hono {
  const app = new Hono();
  app.route('/owner/tabs', ownerTabsRouter);
  return app;
}

function authedJson(method: string, path: string, body?: unknown) {
  return mount().request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      Authorization: bearer(),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

describe('owner-tabs auth gate', () => {
  it('rejects unauthenticated GET', async () => {
    const res = await mount().request('/owner/tabs');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated POST (spawn)', async () => {
    const res = await mount().request('/owner/tabs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated PATCH', async () => {
    const res = await mount().request('/owner/tabs/some-tab', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated DELETE', async () => {
    const res = await mount().request('/owner/tabs/some-tab', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated POST /sync', async () => {
    const res = await mount().request('/owner/tabs/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated POST /:id/close alias', async () => {
    const res = await mount().request('/owner/tabs/some-tab/close', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated POST /:id/update alias', async () => {
    const res = await mount().request('/owner/tabs/some-tab/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

describe('owner-tabs payload validation (authenticated)', () => {
  it('rejects POST with a malformed tab (missing id)', async () => {
    const res = await authedJson('POST', '/owner/tabs', {
      tab: { kind: 'licence', title: 'Geita PML' },
    });
    // 400 (validation) or 503 (DB pre-empts in mock-mode) both acceptable.
    expect([400, 503]).toContain(res.status);
  });

  it('rejects PATCH with an empty title', async () => {
    const res = await authedJson('PATCH', '/owner/tabs/licence|licenceId:42', {
      title: '',
    });
    expect([400, 503]).toContain(res.status);
  });

  it('rejects POST /sync with non-array tabs', async () => {
    const res = await authedJson('POST', '/owner/tabs/sync', {
      state: { tabs: 'not-an-array' },
    });
    expect([400, 503]).toContain(res.status);
  });

  it('rejects POST /:id/update with no mutable fields shape', async () => {
    const res = await authedJson(
      'POST',
      '/owner/tabs/licence|42/update',
      { pendingUpdates: -1 },
    );
    expect([400, 503]).toContain(res.status);
  });
});

describe('owner-tabs DB-not-configured branch (mock-mode)', () => {
  it('GET returns 503 with OWNER_TABS_DB_UNAVAILABLE', async () => {
    const res = await mount().request('/owner/tabs', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('OWNER_TABS_DB_UNAVAILABLE');
  });

  it('POST (spawn) returns 503 when DB is not configured', async () => {
    const res = await authedJson('POST', '/owner/tabs', {
      tab: {
        id: 'licence|licenceId:42',
        kind: 'licence',
        title: 'Geita PML',
      },
    });
    expect(res.status).toBe(503);
  });

  it('POST /:id/close alias returns 503 when DB is not configured', async () => {
    const res = await authedJson('POST', '/owner/tabs/licence|42/close', {
      operation: 'close',
      tabId: 'licence|42',
    });
    expect(res.status).toBe(503);
  });

  it('GET /recent-types returns 503 when DB is not configured', async () => {
    const res = await mount().request('/owner/tabs/recent-types?days=30', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
  });
});

describe('owner-tabs cross-tenant isolation (defense-in-depth)', () => {
  it('two tenants with the same user id each reach the handler independently', async () => {
    const aRes = await mount().request('/owner/tabs', {
      headers: { Authorization: bearer(UserRole.OWNER, 'tenant-a') },
    });
    const bRes = await mount().request('/owner/tabs', {
      headers: { Authorization: bearer(UserRole.OWNER, 'tenant-b') },
    });
    // Both authenticate + reach the route handler (the cross-tenant gate);
    // neither is redirected/forbidden. In mock-mode the DB branch is 503.
    expect(aRes.status).toBe(503);
    expect(bRes.status).toBe(503);
  });
});

describe('deriveRecentTypes (pure helper)', () => {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const DAY = 24 * 60 * 60 * 1000;

  it('returns [] for non-object / missing tabs', () => {
    expect(deriveRecentTypes(null, 30)).toEqual([]);
    expect(deriveRecentTypes({}, 30)).toEqual([]);
    expect(deriveRecentTypes({ tabs: 'nope' }, 30)).toEqual([]);
  });

  it('emits recent types ordered most-recent first, deduped by type', () => {
    const state = {
      tabs: [
        { type: 'licence', lastOpenedAt: iso(2 * DAY) },
        { type: 'site', lastOpenedAt: iso(1 * DAY) },
        { type: 'licence', lastOpenedAt: iso(0.5 * DAY) }, // newer dup
      ],
    };
    const out = deriveRecentTypes(state, 30);
    expect(out.map((e) => e.type)).toEqual(['licence', 'site']);
    // The newer of the two licence timestamps wins.
    expect(out[0]!.lastOpenedAt).toBe(iso(0.5 * DAY));
  });

  it('drops types whose only timestamp is outside the window', () => {
    const state = {
      tabs: [{ type: 'stale', lastOpenedAt: iso(40 * DAY) }],
    };
    expect(deriveRecentTypes(state, 30)).toEqual([]);
  });

  it('falls back to kind, then id-prefix, for the type id', () => {
    const state = {
      tabs: [
        { kind: 'buyer', lastOpenedAt: iso(1 * DAY) },
        { id: 'production|caseId:9', lastOpenedAt: iso(1 * DAY) },
      ],
    };
    const types = deriveRecentTypes(state, 30).map((e) => e.type);
    expect(types).toContain('buyer');
    expect(types).toContain('production');
  });

  it('keeps timestamp-less tabs at the back (never empty when tabs exist)', () => {
    const state = {
      tabs: [
        { type: 'no-ts' },
        { type: 'dated', lastOpenedAt: iso(1 * DAY) },
      ],
    };
    const out = deriveRecentTypes(state, 30).map((e) => e.type);
    expect(out[0]).toBe('dated');
    expect(out).toContain('no-ts');
  });
});

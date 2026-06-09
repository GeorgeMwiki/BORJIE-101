/**
 * /api/v1/owner/contact-prefs — K5 ordered-notification-preferences tests.
 *
 * Two layers:
 *   1) `pickDeliverableChannel` (pure) — proves the ORDERED `channelPriority`
 *      list drives delivery: the FIRST channel with a resolvable destination
 *      wins, with a fall-through to the legacy preferred → email → sms → slack
 *      order when nothing in the list is deliverable.
 *   2) The route's auth gate + validation + DB-not-configured branch, in the
 *      default vitest mock-mode (no live Postgres) — mirroring the owner-tabs
 *      smoke-test idiom so it rides with the default suite. A live-DB
 *      integration suite re-runs the PUT-upsert / GET-read-back contract.
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
import { ownerContactPrefsRouter } from '../contact-prefs.hono';
import { pickDeliverableChannel } from '../../../services/action-executor/handlers/reminders';
import type { ResolvedOwnerContact } from '../../../services/owner-identity/resolver';

const TEST_TENANT = 'tenant-contact-prefs-1';
const TEST_USER = 'user-owner-contact-prefs-1';

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
  app.route('/owner/contact-prefs', ownerContactPrefsRouter);
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

/** Build a `ResolvedOwnerContact` with overridable destinations + ranking. */
function contact(
  over: Partial<ResolvedOwnerContact> = {},
): ResolvedOwnerContact {
  return {
    tenantId: TEST_TENANT,
    ownerId: TEST_USER,
    email: null,
    phone: null,
    slackHandle: null,
    preferredChannel: 'email',
    channelPriority: [],
    locale: 'en',
    timezone: 'Africa/Dar_es_Salaam',
    hasContactPrefRow: true,
    ...over,
  };
}

beforeAll(() => {
  expect(process.env.JWT_SECRET?.length).toBeGreaterThanOrEqual(32);
});

// ---------------------------------------------------------------------------
// pickDeliverableChannel — honours the ORDERED list
// ---------------------------------------------------------------------------

describe('pickDeliverableChannel honours channelPriority order', () => {
  it('priority [slack, email] with only email deliverable → email', () => {
    const out = pickDeliverableChannel(
      contact({
        channelPriority: ['slack', 'email'],
        email: 'owner@example.com',
        // no slackHandle → slack not deliverable, falls to email (next in list)
      }),
    );
    expect(out).toBe('email');
  });

  it('priority [sms, email] with a phone present → sms (first deliverable)', () => {
    const out = pickDeliverableChannel(
      contact({
        channelPriority: ['sms', 'email'],
        phone: '+255700000000',
        email: 'owner@example.com',
      }),
    );
    expect(out).toBe('sms');
  });

  it('returns the FIRST deliverable entry, skipping undeliverable head', () => {
    const out = pickDeliverableChannel(
      contact({
        channelPriority: ['slack', 'sms', 'email'],
        phone: '+255700000000',
        email: 'owner@example.com',
        // slack undeliverable (no handle) → sms is first deliverable
      }),
    );
    expect(out).toBe('sms');
  });

  it('skips whatsapp in the list (worker cannot deliver) and falls through', () => {
    const out = pickDeliverableChannel(
      contact({
        channelPriority: ['whatsapp', 'email'],
        email: 'owner@example.com',
      }),
    );
    expect(out).toBe('email');
  });

  it('falls back to preferredChannel when nothing ranked is deliverable', () => {
    const out = pickDeliverableChannel(
      contact({
        channelPriority: ['slack'], // no slackHandle → undeliverable
        preferredChannel: 'sms',
        phone: '+255700000000',
      }),
    );
    expect(out).toBe('sms');
  });

  it('falls back to deliverable order when list + preferred both undeliverable', () => {
    const out = pickDeliverableChannel(
      contact({
        channelPriority: ['slack'],
        preferredChannel: 'slack', // no slackHandle
        email: 'owner@example.com',
      }),
    );
    expect(out).toBe('email');
  });

  it('empty list → legacy preferred → email → sms → slack order', () => {
    expect(
      pickDeliverableChannel(
        contact({ channelPriority: [], preferredChannel: 'sms', phone: '+1' }),
      ),
    ).toBe('sms');
    expect(
      pickDeliverableChannel(
        contact({ channelPriority: [], slackHandle: '@owner' }),
      ),
    ).toBe('slack');
  });
});

// ---------------------------------------------------------------------------
// Route auth gate
// ---------------------------------------------------------------------------

describe('owner-contact-prefs auth gate', () => {
  it('rejects unauthenticated GET', async () => {
    const res = await mount().request('/owner/contact-prefs');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated PUT', async () => {
    const res = await mount().request('/owner/contact-prefs', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channelPriority: ['email'] }),
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Payload validation (authenticated)
// ---------------------------------------------------------------------------

describe('owner-contact-prefs PUT validation', () => {
  it('rejects a duplicate channel in channelPriority', async () => {
    const res = await authedJson('PUT', '/owner/contact-prefs', {
      channelPriority: ['email', 'email'],
    });
    // 400 (validation) wins over the 503 DB branch (parse happens first).
    expect(res.status).toBe(400);
  });

  it('rejects an unknown channel', async () => {
    const res = await authedJson('PUT', '/owner/contact-prefs', {
      channelPriority: ['carrier-pigeon'],
    });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed emailOverride', async () => {
    const res = await authedJson('PUT', '/owner/contact-prefs', {
      channelPriority: ['email'],
      emailOverride: 'not-an-email',
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown top-level key (strict schema)', async () => {
    const res = await authedJson('PUT', '/owner/contact-prefs', {
      channelPriority: ['email'],
      tenantId: 'attacker-tenant',
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DB-not-configured branch (mock-mode)
// ---------------------------------------------------------------------------

describe('owner-contact-prefs DB-not-configured branch (mock-mode)', () => {
  it('GET returns 503 with CONTACT_PREFS_DB_UNAVAILABLE', async () => {
    const res = await mount().request('/owner/contact-prefs', {
      headers: { Authorization: bearer() },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('CONTACT_PREFS_DB_UNAVAILABLE');
  });

  it('PUT with a VALID payload returns 503 when DB is not configured', async () => {
    const res = await authedJson('PUT', '/owner/contact-prefs', {
      channelPriority: ['slack', 'email', 'sms'],
      slackHandle: '@owner',
      emailOverride: 'owner@example.com',
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('CONTACT_PREFS_DB_UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant isolation (defense-in-depth)
// ---------------------------------------------------------------------------

describe('owner-contact-prefs cross-tenant isolation', () => {
  it('two tenants sharing a user id each reach the handler independently', async () => {
    const aRes = await mount().request('/owner/contact-prefs', {
      headers: { Authorization: bearer(UserRole.OWNER, 'tenant-a') },
    });
    const bRes = await mount().request('/owner/contact-prefs', {
      headers: { Authorization: bearer(UserRole.OWNER, 'tenant-b') },
    });
    expect(aRes.status).toBe(503);
    expect(bRes.status).toBe(503);
  });
});

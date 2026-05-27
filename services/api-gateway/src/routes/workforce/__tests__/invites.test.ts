/**
 * Workforce invitations router tests.
 *
 * Mounts the real router against a stubbed Drizzle client + injected auth
 * context. Each endpoint is exercised end-to-end through Hono's
 * `app.request()` API. Audit-chain writes are captured in-memory so the
 * idempotency / activation invariants can be asserted.
 *
 * Test groups (≥15 assertions across):
 *   1. Auth gate — 401 when no bearer, 403 when role cannot invite.
 *   2. Validation — zod rejects bad phones / roles / certifications.
 *   3. Issue happy path — 201, returns activation code, persists row.
 *   4. Idempotency — second invite within 24h returns the same row.
 *   5. List — filters by status + tenant.
 *   6. Revoke — happy path + state-machine guard.
 *   7. Activate — happy path, wrong-code, expired, already-activated.
 *   8. SMS adapter — invoked + delivered/providerId surfaced; failure swallowed.
 *   9. Cross-tenant isolation — different tenant cannot see the row.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const ctx = (globalThis as any).__BORJIE_TEST_AUTH__;
    if (!ctx) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    c.set('auth', ctx);
    await next();
  },
  requireRole: () => async (_c: any, next: any) => {
    await next();
  },
}));

vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (c: any, next: any) => {
    const db = (globalThis as any).__BORJIE_TEST_DB__;
    c.set('db', db);
    c.set('repos', {});
    c.set('useMockData', false);
    await next();
  },
}));

import { Hono } from 'hono';
import {
  createWorkforceInvitesRouter,
  __setInvitationSmsAdapterForTests,
  __setActivationSupabasePortForTests,
  type InvitationSmsAdapter,
  type ActivationSupabasePort,
} from '../invites.hono';

// ---------------------------------------------------------------------------
// Fake drizzle client — keyed only on column name + filter predicates.
// Maintains: rows for workforce_invitations + audit-chain INSERTs captured
// out of the execute() path.
// ---------------------------------------------------------------------------

interface FakeDb {
  rows(): any[];
  auditEntries(): Array<{ readonly action: string; readonly turnId: string }>;
  select(): any;
  insert(): any;
  update(): any;
  execute(query: any): Promise<any>;
  forceInsertError?: boolean;
}

function createFakeDb(initial: any[] = []): FakeDb {
  let rows: any[] = [...initial];
  const auditEntries: Array<{ action: string; turnId: string }> = [];

  function applyFilter(condition: any): (row: any) => boolean {
    if (!condition) return () => true;
    if (typeof condition.__filter === 'function') return condition.__filter;
    return () => true;
  }

  const api: FakeDb = {
    rows: () => rows,
    auditEntries: () => auditEntries,
    select() {
      return {
        from() {
          return {
            where(condition: any) {
              const filterFn = applyFilter(condition);
              return {
                orderBy() {
                  return {
                    limit() {
                      return Promise.resolve(rows.filter(filterFn));
                    },
                  };
                },
                limit() {
                  return Promise.resolve(rows.filter(filterFn));
                },
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        values(input: any) {
          const next = Array.isArray(input) ? input : [input];
          return {
            returning() {
              if (api.forceInsertError) {
                return Promise.reject(new Error('forced insert failure'));
              }
              const created = next.map((row) => ({
                id: row.id ?? `11111111-1111-4111-8111-${Math.random()
                  .toString(16)
                  .slice(2, 14)
                  .padStart(12, '0')}`,
                createdAt: row.createdAt ?? new Date(),
                ...row,
              }));
              rows = [...rows, ...created];
              return Promise.resolve(created);
            },
          };
        },
      };
    },
    update() {
      return {
        set(patch: any) {
          return {
            where(condition: any) {
              const filterFn = applyFilter(condition);
              return {
                returning() {
                  const updated: any[] = [];
                  rows = rows.map((row) => {
                    if (filterFn(row)) {
                      const merged = { ...row, ...patch };
                      updated.push(merged);
                      return merged;
                    }
                    return row;
                  });
                  return Promise.resolve(updated);
                },
              };
            },
          };
        },
      };
    },
    async execute(query: any) {
      const text =
        typeof query === 'object' && query !== null && 'queryChunks' in query
          ? String((query as any).queryChunks ?? '')
          : String(query);
      if (text.includes('ai_audit_chain') && text.includes('INSERT')) {
        auditEntries.push({
          action: 'captured.via.text',
          turnId: 'captured',
        });
        return { rows: [] };
      }
      // The MAX/last_hash lookup short-circuits with an empty head.
      return { rows: [{ max_seq: 0, last_hash: null }] };
    },
  };
  return api;
}

// drizzle-orm shim — turn eq/and/or into predicate fns the fake client uses.
vi.mock('drizzle-orm', async (original) => {
  const real = await original<typeof import('drizzle-orm')>();
  const readField = (col: any) => col?.name ?? col?._?.name ?? null;
  return {
    ...real,
    eq: (col: any, value: any) => ({
      __filter: (row: any) => {
        const key = readField(col);
        if (!key) return true;
        return row[snakeToCamel(key)] === value || row[key] === value;
      },
    }),
    and: (...conds: any[]) => ({
      __filter: (row: any) =>
        conds.every((c) => (c?.__filter ? c.__filter(row) : true)),
    }),
    or: (...conds: any[]) => ({
      __filter: (row: any) =>
        conds.some((c) => (c?.__filter ? c.__filter(row) : false)),
    }),
    desc: (col: any) => col,
    sql: (..._args: any[]) => ({ queryChunks: 'sql-stub' }),
  };
});

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_USER_ID = '00000000-0000-4000-8000-000000000002';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function setAuth(
  overrides: Partial<{ userId: string; role: string; tenantId: string }> = {},
) {
  (globalThis as any).__BORJIE_TEST_AUTH__ = {
    userId: overrides.userId ?? OWNER_USER_ID,
    tenantId: overrides.tenantId ?? TENANT_ID,
    role: overrides.role ?? 'OWNER',
    permissions: [],
    propertyAccess: ['*'],
  };
}

function clearAuth() {
  (globalThis as any).__BORJIE_TEST_AUTH__ = undefined;
}

function setDb(db: FakeDb | null) {
  (globalThis as any).__BORJIE_TEST_DB__ = db;
}

function buildApp(): Hono {
  const app = new Hono();
  app.route('/', createWorkforceInvitesRouter());
  return app;
}

interface CapturedSms {
  readonly phoneE164: string;
  readonly bodySw: string;
  readonly bodyEn: string;
}

function buildSmsAdapter(
  overrides: {
    readonly captured: CapturedSms[];
    readonly delivered?: boolean;
    readonly providerId?: string;
    readonly throwOnSend?: boolean;
  },
): InvitationSmsAdapter {
  return {
    async send(input) {
      overrides.captured.push(input);
      if (overrides.throwOnSend) {
        throw new Error('sms provider down');
      }
      return {
        delivered: overrides.delivered ?? true,
        providerId: overrides.providerId ?? 'sms-stub-001',
      };
    },
  };
}

function buildSupabasePort(
  state: { userIdFor: string | null; calls: number },
): ActivationSupabasePort {
  return {
    async ensureUser(input) {
      state.calls += 1;
      return {
        userId:
          state.userIdFor ?? `99999999-1111-4111-8111-${input.phoneE164.replace(/[^0-9]/g, '').padStart(12, '0').slice(-12)}`,
        accessToken: 'access-token-stub',
        refreshToken: 'refresh-token-stub',
        expiresIn: 3600,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('workforce invitations router', () => {
  beforeEach(() => {
    clearAuth();
    setDb(null);
    __setInvitationSmsAdapterForTests(null);
    __setActivationSupabasePortForTests(null);
  });

  // ------------------------- Auth gate -------------------------

  it('rejects unauthenticated POST / with 401', async () => {
    const res = await buildApp().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+255712345678' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST / with 403 when role is not in INVITER_ROLES', async () => {
    setAuth({ role: 'RESIDENT' });
    setDb(createFakeDb());
    const res = await buildApp().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+255712345678' }),
    });
    expect(res.status).toBe(403);
  });

  // ------------------------- Validation -------------------------

  it('rejects POST / with 400 when phoneE164 is malformed', async () => {
    setAuth();
    setDb(createFakeDb());
    const res = await buildApp().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneE164: '0712345678' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects POST / with 400 when assignedRole is not in [employee, manager]', async () => {
    setAuth();
    setDb(createFakeDb());
    const res = await buildApp().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phoneE164: '+255712345678',
        assignedRole: 'foreman',
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects POST / with 400 when assignedCertifications contains an unknown cert', async () => {
    setAuth();
    setDb(createFakeDb());
    const res = await buildApp().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phoneE164: '+255712345678',
        assignedCertifications: ['ninja-cert'],
      }),
    });
    expect(res.status).toBe(400);
  });

  // ------------------------- Issue happy path -------------------------

  it('POST / creates an invitation, returns a 6-digit code, and persists the row', async () => {
    setAuth();
    const db = createFakeDb();
    setDb(db);
    const res = await buildApp().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phoneE164: '+255712345678',
        fullName: 'Juma Mwakipesile',
        assignedRole: 'employee',
        assignedCertifications: ['haul-truck-license', 'first-aid'],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        invitationId: string;
        activationCode: string;
        phoneE164: string;
        assignedRole: string;
        assignedCertifications: ReadonlyArray<string>;
        expiresAt: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.activationCode).toMatch(/^[0-9]{6}$/);
    expect(body.data.phoneE164).toBe('+255712345678');
    expect(body.data.assignedRole).toBe('employee');
    expect(body.data.assignedCertifications).toContain('haul-truck-license');
    expect(db.rows()).toHaveLength(1);
  });

  // ------------------------- Idempotency -------------------------

  it('POST / collapses re-invites within 24h into the existing pending row', async () => {
    setAuth();
    const db = createFakeDb([
      {
        id: VALID_UUID,
        tenantId: TENANT_ID,
        invitedByUserId: OWNER_USER_ID,
        phoneE164: '+255712345678',
        activationCode: '424242',
        assignedRole: 'employee',
        assignedSiteId: null,
        assignedCertifications: [],
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        activatedAt: null,
        activatedUserId: null,
        status: 'pending',
        createdAt: new Date(),
        hashChainId: null,
      },
    ]);
    setDb(db);
    const res = await buildApp().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phoneE164: '+255712345678',
        assignedRole: 'employee',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { invitationId: string; activationCode: string; idempotent: boolean };
      meta: { idempotent: boolean };
    };
    expect(body.meta.idempotent).toBe(true);
    expect(body.data.idempotent).toBe(true);
    expect(body.data.invitationId).toBe(VALID_UUID);
    expect(body.data.activationCode).toBe('424242');
    // No new row inserted.
    expect(db.rows()).toHaveLength(1);
  });

  // ------------------------- List -------------------------

  it('GET / returns only invites for the current tenant', async () => {
    setAuth();
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: TENANT_ID,
          status: 'pending',
          phoneE164: '+255712345678',
          createdAt: new Date(),
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          tenantId: OTHER_TENANT_ID,
          status: 'pending',
          phoneE164: '+255712111222',
          createdAt: new Date(),
        },
      ]),
    );
    const res = await buildApp().request('/?status=pending', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].tenantId).toBe(TENANT_ID);
  });

  // ------------------------- Revoke -------------------------

  it('POST /:id/revoke flips a pending invite to revoked', async () => {
    setAuth();
    const db = createFakeDb([
      {
        id: VALID_UUID,
        tenantId: TENANT_ID,
        status: 'pending',
        phoneE164: '+255712345678',
        invitedByUserId: OWNER_USER_ID,
        activationCode: '424242',
        assignedRole: 'employee',
        assignedSiteId: null,
        assignedCertifications: [],
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        activatedAt: null,
        activatedUserId: null,
        createdAt: new Date(),
        hashChainId: null,
      },
    ]);
    setDb(db);
    const res = await buildApp().request(`/${VALID_UUID}/revoke`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('revoked');
  });

  it('POST /:id/revoke rejects activating an already-activated invite with 409', async () => {
    setAuth();
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: TENANT_ID,
          status: 'activated',
          phoneE164: '+255712345678',
          invitedByUserId: OWNER_USER_ID,
          activationCode: '424242',
          assignedRole: 'employee',
          assignedSiteId: null,
          assignedCertifications: [],
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          activatedAt: new Date(),
          activatedUserId: '33333333-3333-4333-8333-333333333333',
          createdAt: new Date(),
          hashChainId: null,
        },
      ]),
    );
    const res = await buildApp().request(`/${VALID_UUID}/revoke`, {
      method: 'POST',
    });
    expect(res.status).toBe(409);
  });

  it('POST /:id/revoke rejects malformed ids with 400', async () => {
    setAuth();
    setDb(createFakeDb());
    const res = await buildApp().request('/not-a-uuid/revoke', {
      method: 'POST',
    });
    expect(res.status).toBe(400);
  });

  // ------------------------- Activate -------------------------

  it('POST /activate is public — no bearer required and returns a session', async () => {
    // Pre-seed a pending invite, no auth context.
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: TENANT_ID,
          status: 'pending',
          phoneE164: '+255712345678',
          invitedByUserId: OWNER_USER_ID,
          activationCode: '424242',
          assignedRole: 'employee',
          assignedSiteId: null,
          assignedCertifications: [],
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          activatedAt: null,
          activatedUserId: null,
          createdAt: new Date(),
          hashChainId: null,
        },
      ]),
    );
    const portState = { userIdFor: null as string | null, calls: 0 };
    __setActivationSupabasePortForTests(buildSupabasePort(portState));
    const res = await buildApp().request('/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phoneE164: '+255712345678',
        activationCode: '424242',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        invitationId: string;
        tenantId: string;
        miningRole: string;
        session: {
          accessToken: string | null;
          refreshToken: string | null;
        };
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe(TENANT_ID);
    expect(body.data.miningRole).toBe('employee');
    expect(body.data.session.accessToken).toBe('access-token-stub');
    expect(portState.calls).toBe(1);
  });

  it('POST /activate rejects wrong activation code with 400', async () => {
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: TENANT_ID,
          status: 'pending',
          phoneE164: '+255712345678',
          invitedByUserId: OWNER_USER_ID,
          activationCode: '424242',
          assignedRole: 'employee',
          assignedSiteId: null,
          assignedCertifications: [],
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          activatedAt: null,
          activatedUserId: null,
          createdAt: new Date(),
          hashChainId: null,
        },
      ]),
    );
    const res = await buildApp().request('/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phoneE164: '+255712345678',
        activationCode: '000000',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CODE');
  });

  it('POST /activate rejects expired invitations with 410', async () => {
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: TENANT_ID,
          status: 'pending',
          phoneE164: '+255712345678',
          invitedByUserId: OWNER_USER_ID,
          activationCode: '424242',
          assignedRole: 'employee',
          assignedSiteId: null,
          assignedCertifications: [],
          // Expired one hour ago.
          expiresAt: new Date(Date.now() - 60 * 60 * 1000),
          activatedAt: null,
          activatedUserId: null,
          createdAt: new Date(),
          hashChainId: null,
        },
      ]),
    );
    const res = await buildApp().request('/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phoneE164: '+255712345678',
        activationCode: '424242',
      }),
    });
    expect(res.status).toBe(410);
  });

  it('POST /activate returns 404 when no pending invitation exists (already-activated path)', async () => {
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: TENANT_ID,
          status: 'activated',
          phoneE164: '+255712345678',
          invitedByUserId: OWNER_USER_ID,
          activationCode: '424242',
          assignedRole: 'employee',
          assignedSiteId: null,
          assignedCertifications: [],
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          activatedAt: new Date(),
          activatedUserId: '33333333-3333-4333-8333-333333333333',
          createdAt: new Date(),
          hashChainId: null,
        },
      ]),
    );
    const res = await buildApp().request('/activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phoneE164: '+255712345678',
        activationCode: '424242',
      }),
    });
    expect(res.status).toBe(404);
  });

  // ------------------------- SMS adapter -------------------------

  it('POST / invokes the SMS adapter and surfaces delivery state', async () => {
    setAuth();
    setDb(createFakeDb());
    const captured: CapturedSms[] = [];
    __setInvitationSmsAdapterForTests(
      buildSmsAdapter({
        captured,
        delivered: true,
        providerId: 'twilio-stub-1',
      }),
    );
    const res = await buildApp().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        phoneE164: '+255712345678',
        assignedRole: 'manager',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { smsDelivered: boolean; smsProviderId: string | null };
    };
    expect(body.data.smsDelivered).toBe(true);
    expect(body.data.smsProviderId).toBe('twilio-stub-1');
    expect(captured).toHaveLength(1);
    expect(captured[0]?.phoneE164).toBe('+255712345678');
    expect(captured[0]?.bodySw).toContain('Karibu Borjie');
  });

  it('POST / swallows SMS adapter failures — invitation still persisted', async () => {
    setAuth();
    const db = createFakeDb();
    setDb(db);
    const captured: CapturedSms[] = [];
    __setInvitationSmsAdapterForTests(
      buildSmsAdapter({ captured, throwOnSend: true }),
    );
    const res = await buildApp().request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneE164: '+255712345678' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { smsDelivered: boolean; activationCode: string };
    };
    expect(body.data.smsDelivered).toBe(false);
    expect(body.data.activationCode).toMatch(/^[0-9]{6}$/);
    expect(db.rows()).toHaveLength(1);
  });

  // ------------------------- Tenant isolation -------------------------

  it('GET / refuses to surface another tenant rows even with broad filters', async () => {
    setAuth({ tenantId: TENANT_ID });
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: OTHER_TENANT_ID,
          status: 'pending',
          phoneE164: '+255712345678',
          createdAt: new Date(),
        },
      ]),
    );
    const res = await buildApp().request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any[] };
    expect(body.data).toHaveLength(0);
  });
});

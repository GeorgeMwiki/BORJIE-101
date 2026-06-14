/**
 * Authz-gates regression coverage — break-glass / damage-claims / tenders /
 * proposals + the proposals-decline no-op + owner-tabs optimistic concurrency.
 *
 * Before this wave several high-blast-radius mutations were gated only by
 * `authMiddleware` — ANY authenticated tenant member (incl. a field-worker or
 * buyer login mapped to MAINTENANCE_STAFF / RESIDENT) could:
 *   - consent to / deny / revoke a Borjie break-glass access grant,
 *   - file / respond / settle / approve a money-bearing damage claim,
 *   - publish / award / cancel a tender,
 *   - approve / edit / decline a brain-authored module proposal.
 * In addition `POST /proposals/:id/decline` issued an unconditional UPDATE and
 * ALWAYS returned `success:true` — a missing / cross-tenant / wrong-state
 * proposal was reported as "declined", and `owner_tabs.writeState` was a
 * whole-blob upsert with no version precondition (concurrent writes silently
 * lost). This suite locks every gate + the no-op + the CAS in place.
 *
 * The unauthorized-role assertions exercise the REAL routers mounted under a
 * stub auth middleware that injects a non-authorized role, so the load-bearing
 * `requireRole` gate fires deterministically (the route's own
 * `authMiddleware`/`databaseMiddleware` are replaced so no JWT / live PG is
 * needed — same self-contained pattern as marketplace/__tests__/rfb.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { UserRole } from '../../types/user-role';

// The role + db that the stub auth middleware injects per-test. Mutated by the
// helpers below so one mock definition serves every router. Declared via
// `vi.hoisted` so it is initialised BEFORE the hoisted `vi.mock` factories run.
const injected = vi.hoisted(() => ({
  role: 'RESIDENT',
  db: null as unknown,
  tenantId: 'tenant-a',
  userId: 'user-a',
}));

// ── Stub the shared middleware BEFORE importing any router so the fixtures are
//    fully self-contained. `requireRole` is the REAL implementation — it is the
//    gate under test; only `authMiddleware`/`databaseMiddleware` are replaced.
vi.mock('../../middleware/hono-auth', async (orig) => {
  const actual = await (orig() as Promise<
    typeof import('../../middleware/hono-auth')
  >);
  return {
    ...actual,
    authMiddleware: async (c: any, next: () => Promise<void>) => {
      c.set('auth', {
        tenantId: injected.tenantId,
        userId: injected.userId,
        role: injected.role,
        permissions: ['*'],
        propertyAccess: ['*'],
      });
      await next();
    },
  };
});

vi.mock('../../middleware/database', () => ({
  databaseMiddleware: async (c: any, next: () => Promise<void>) => {
    c.set('db', injected.db);
    await next();
  },
}));

// Provenance + security-events helpers are pure pass-throughs in these tests.
vi.mock('@borjie/observability', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    withSecurityEvents:
      (_meta: unknown, handler: (c: unknown) => unknown) => handler,
  };
});

import damageClaimsRouter from '../damage-claims.hono';
import { tendersRouter } from '../tenders.router';
import proposalsRouter from '../proposals.hono';
import { ownerBreakGlassRouter } from '../owner/break-glass.hono';
import { ownerTabsRouter } from '../owner/tabs.hono';

beforeEach(() => {
  injected.role = UserRole.RESIDENT;
  injected.db = null;
  injected.tenantId = 'tenant-a';
  injected.userId = 'user-a';
});

function mount(router: Hono): Hono {
  const app = new Hono();
  app.route('/', router);
  return app;
}

function postJson(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ───────────────────────────────────────────────────────────────────────────
// (1) break-glass — consent/deny/revoke require owner/admin
// ───────────────────────────────────────────────────────────────────────────
describe('break-glass lifecycle role gate', () => {
  const grantPaths = [
    '/grants/g1/consent',
    '/grants/g1/deny',
    '/grants/g1/revoke',
  ];

  it.each(grantPaths)('403s a non-owner role on %s', async (path) => {
    injected.role = UserRole.RESIDENT; // a buyer login must NOT consent
    const app = mount(ownerBreakGlassRouter);
    const res = await postJson(app, path, {});
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('FORBIDDEN');
  });

  it.each(grantPaths)('also 403s a field worker on %s', async (path) => {
    injected.role = UserRole.MAINTENANCE_STAFF;
    const res = await postJson(mount(ownerBreakGlassRouter), path, {});
    expect(res.status).toBe(403);
  });

  it('lets an OWNER past the gate (reaches the store, not 403)', async () => {
    injected.role = UserRole.OWNER;
    const res = await postJson(
      mount(ownerBreakGlassRouter),
      '/grants/does-not-exist/consent',
      {},
    );
    // Past the gate: the store reports the grant is not found (404), never 403.
    expect(res.status).not.toBe(403);
    expect([404, 500]).toContain(res.status);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (2) damage-claims — file/respond/settle/approve require write roles
// ───────────────────────────────────────────────────────────────────────────
describe('damage-claims write role gate', () => {
  const writePaths: ReadonlyArray<[string, unknown]> = [
    ['/', { siteId: 's1', contractorPartyId: '11111111-1111-1111-1111-111111111111', claimedAmountMinor: 100, currency: 'TZS', rationale: 'x' }],
    ['/c1/respond', { rationale: 'x' }],
    ['/c1/settle', { agreedAmountMinor: 100 }],
    ['/rehabilitation-plans/p1/action-plans/a1/approve', {}],
  ];

  it.each(writePaths)('403s a buyer/resident on %s', async (path, body) => {
    injected.role = UserRole.RESIDENT;
    const res = await postJson(mount(damageClaimsRouter), path, body);
    expect(res.status).toBe(403);
    const env = (await res.json()) as { error?: { code?: string } };
    expect(env.error?.code).toBe('FORBIDDEN');
  });

  it('TENANT_ADMIN clears the gate (no DB → 503, never 403)', async () => {
    injected.role = UserRole.TENANT_ADMIN;
    injected.db = null;
    const res = await postJson(mount(damageClaimsRouter), '/c1/settle', {
      agreedAmountMinor: 100,
    });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(503); // honest-degrade: DB not configured
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (3) tenders — publish/award/cancel gated; bid submission + reads broad
// ───────────────────────────────────────────────────────────────────────────
describe('tenders write role gate', () => {
  const writePaths: ReadonlyArray<[string, unknown]> = [
    ['/', { scope: 'haul', budgetRangeMin: 1, budgetRangeMax: 2, currency: 'TZS', closesAt: '2999-01-01T00:00:00.000Z' }],
    ['/t1/award', { bidId: 'b1' }],
    ['/t1/cancel', { reason: 'changed mind' }],
  ];

  it.each(writePaths)('403s a non-staff role on %s', async (path, body) => {
    injected.role = UserRole.RESIDENT;
    const res = await postJson(mount(tendersRouter), path, body);
    expect(res.status).toBe(403);
  });

  it('a vendor (RESIDENT) can still SUBMIT a bid — not gated', async () => {
    injected.role = UserRole.RESIDENT;
    const res = await postJson(mount(tendersRouter), '/t1/bids', {
      vendorId: 'v1',
      price: 100,
      timelineDays: 7,
    });
    // Past auth — the tender service is unwired in this fixture → 503, not 403.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(503);
  });

  it('OWNER clears the publish gate (service unwired → 503, not 403)', async () => {
    injected.role = UserRole.OWNER;
    const res = await postJson(mount(tendersRouter), '/', {
      scope: 'haul',
      budgetRangeMin: 1,
      budgetRangeMax: 2,
      currency: 'TZS',
      closesAt: '2999-01-01T00:00:00.000Z',
    });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(503);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (4) proposals — approve/edit/decline gated; decline no-op → 404/409;
//                  approver_tier clamped from the caller's actual role
// ───────────────────────────────────────────────────────────────────────────

/** Minimal db.execute stub that scripts a sequence of responses keyed by the
 *  SQL verb (UPDATE vs SELECT) so the decline handler's CAS + re-read branches
 *  are exercised deterministically. */
function makeProposalDb(opts: {
  updateRows: Array<Record<string, unknown>>;
  selectRows: Array<Record<string, unknown>>;
}) {
  const captured: Array<{ sqlText: string; params: unknown[] }> = [];
  const db = {
    execute: async (q: any) => {
      const chunks = (q?.queryChunks ?? []) as ReadonlyArray<unknown>;
      const frags: string[] = [];
      const params: unknown[] = [];
      const walk = (cs: ReadonlyArray<unknown>) => {
        for (const c of cs) {
          if (c && typeof c === 'object' && 'value' in (c as any)) {
            frags.push(String((c as any).value));
          } else if (c && typeof c === 'object' && 'queryChunks' in (c as any)) {
            walk((c as any).queryChunks ?? []);
          } else {
            params.push(c);
          }
        }
      };
      walk(chunks);
      const sqlText = frags.join(' ');
      captured.push({ sqlText, params });
      if (/^\s*UPDATE/i.test(sqlText)) return { rows: opts.updateRows };
      return { rows: opts.selectRows };
    },
  };
  return { db, captured };
}

describe('proposals write role gate', () => {
  const writePaths: ReadonlyArray<[string, unknown]> = [
    ['/p1/approve', { approver_tier: 1 }],
    ['/p1/edit', { new_payload: {}, edit_summary: 'x' }],
    ['/p1/decline', { reason: 'no' }],
  ];

  it.each(writePaths)('403s a non-staff role on %s', async (path, body) => {
    injected.role = UserRole.RESIDENT;
    injected.db = makeProposalDb({ updateRows: [], selectRows: [] }).db;
    const res = await postJson(mount(proposalsRouter), path, body);
    expect(res.status).toBe(403);
    const env = (await res.json()) as { error?: { code?: string } };
    expect(env.error?.code).toBe('FORBIDDEN');
  });
});

describe('proposals decline no-op no longer reports phantom success', () => {
  it('404s when the proposal is missing / cross-tenant (0 update, 0 select)', async () => {
    injected.role = UserRole.TENANT_ADMIN;
    injected.db = makeProposalDb({ updateRows: [], selectRows: [] }).db;
    const res = await postJson(mount(proposalsRouter), '/ghost/decline', {
      reason: 'no',
    });
    expect(res.status).toBe(404);
    const env = (await res.json()) as { success: boolean; error?: { code?: string } };
    expect(env.success).toBe(false);
    expect(env.error?.code).toBe('NOT_FOUND');
  });

  it('409s when the proposal exists but is in the wrong state (0 update, 1 select)', async () => {
    injected.role = UserRole.TENANT_ADMIN;
    injected.db = makeProposalDb({
      updateRows: [],
      selectRows: [{ id: 'p1', status: 'accepted' }],
    }).db;
    const res = await postJson(mount(proposalsRouter), '/p1/decline', {
      reason: 'no',
    });
    expect(res.status).toBe(409);
    const env = (await res.json()) as { success: boolean; error?: { code?: string } };
    expect(env.success).toBe(false);
    expect(env.error?.code).toBe('INVALID_STATE');
  });

  it('200s only when a row actually transitioned (1 update row returned)', async () => {
    injected.role = UserRole.TENANT_ADMIN;
    injected.db = makeProposalDb({
      updateRows: [{ id: 'p1' }],
      selectRows: [],
    }).db;
    const res = await postJson(mount(proposalsRouter), '/p1/decline', {
      reason: 'no',
    });
    expect(res.status).toBe(200);
    const env = (await res.json()) as { success: boolean; data?: { status?: string } };
    expect(env.success).toBe(true);
    expect(env.data?.status).toBe('declined');
  });
});

describe('proposals approve clamps approver_tier from the caller role', () => {
  it('clamps a TENANT_ADMIN body approver_tier:5 down to 3', async () => {
    injected.role = UserRole.TENANT_ADMIN;
    const harness = makeProposalDb({
      updateRows: [{ id: 'p1' }],
      // first SELECT (existence check) returns a pending proposal.
      selectRows: [{ id: 'p1', status: 'pending_hitl', module_template_id: 'm', action: 'a' }],
    });
    injected.db = harness.db;
    const res = await postJson(mount(proposalsRouter), '/p1/approve', {
      approver_tier: 5,
    });
    expect(res.status).toBe(200);
    // The UPDATE must carry the CLAMPED tier (3), never the requested 5.
    const updateCall = harness.captured.find((c) => /^\s*UPDATE/i.test(c.sqlText));
    expect(updateCall).toBeDefined();
    expect(updateCall!.params).toContain(3);
    expect(updateCall!.params).not.toContain(5);
  });

  it('a SUPER_ADMIN may certify the requested tier-5', async () => {
    injected.role = UserRole.SUPER_ADMIN;
    const harness = makeProposalDb({
      updateRows: [{ id: 'p1' }],
      selectRows: [{ id: 'p1', status: 'pending_hitl', module_template_id: 'm', action: 'a' }],
    });
    injected.db = harness.db;
    const res = await postJson(mount(proposalsRouter), '/p1/approve', {
      approver_tier: 5,
    });
    expect(res.status).toBe(200);
    const updateCall = harness.captured.find((c) => /^\s*UPDATE/i.test(c.sqlText));
    expect(updateCall!.params).toContain(5);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (5) owner-tabs — optimistic concurrency on the whole-blob write
// ───────────────────────────────────────────────────────────────────────────

/** db stub: one SELECT-shaped read returns the current row (with updatedAt),
 *  then the conditional UPDATE returns `updateRows` (0 rows = CAS lost). */
function makeTabsDb(opts: {
  existingRow: Record<string, unknown> | null;
  updateRows: Array<Record<string, unknown>>;
  insertRows?: Array<Record<string, unknown>>;
}) {
  const db = {
    // drizzle query-builder shape used by loadState: select().from().where().limit()
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (opts.existingRow ? [opts.existingRow] : []),
        }),
      }),
    }),
    execute: async (q: any) => {
      const chunks = (q?.queryChunks ?? []) as ReadonlyArray<unknown>;
      const frags: string[] = [];
      const walk = (cs: ReadonlyArray<unknown>) => {
        for (const c of cs) {
          if (c && typeof c === 'object' && 'value' in (c as any)) {
            frags.push(String((c as any).value));
          } else if (c && typeof c === 'object' && 'queryChunks' in (c as any)) {
            walk((c as any).queryChunks ?? []);
          }
        }
      };
      walk(chunks);
      const sqlText = frags.join(' ');
      if (/^\s*INSERT/i.test(sqlText)) return { rows: opts.insertRows ?? [] };
      if (/^\s*UPDATE/i.test(sqlText)) return { rows: opts.updateRows };
      return { rows: [] };
    },
  };
  return db;
}

describe('owner-tabs optimistic concurrency (CAS)', () => {
  const existing = {
    state: { tabs: [{ id: 'a', kind: 'chat', title: 'Chat' }], activeTabId: 'a' },
    updatedAt: new Date('2026-06-14T00:00:00.000Z'),
  };

  it('409 OWNER_TABS_CONFLICT when the CAS UPDATE matches 0 rows (lost update)', async () => {
    injected.role = UserRole.OWNER;
    // A concurrent writer bumped updated_at → the conditional UPDATE returns
    // no rows → the write is REFUSED rather than clobbering the other write.
    injected.db = makeTabsDb({ existingRow: existing, updateRows: [] });
    const res = await postJson(mount(ownerTabsRouter), '/sync', {
      state: { tabs: [], activeTabId: null },
    });
    expect(res.status).toBe(409);
    const env = (await res.json()) as { error?: { code?: string } };
    expect(env.error?.code).toBe('OWNER_TABS_CONFLICT');
  });

  it('200 when the CAS UPDATE matches the expected version (1 row returned)', async () => {
    injected.role = UserRole.OWNER;
    injected.db = makeTabsDb({
      existingRow: existing,
      updateRows: [{ tenant_id: 'tenant-a' }],
    });
    const res = await postJson(mount(ownerTabsRouter), '/sync', {
      state: { tabs: [], activeTabId: null },
    });
    expect(res.status).toBe(200);
    const env = (await res.json()) as { success: boolean };
    expect(env.success).toBe(true);
  });

  it('409 when the INSERT-if-absent loses to a concurrent create (no prior row)', async () => {
    injected.role = UserRole.OWNER;
    // No existing row at read time → INSERT path. A row created in the gap
    // wins (ON CONFLICT DO NOTHING → 0 rows) → conflict.
    injected.db = makeTabsDb({
      existingRow: null,
      updateRows: [],
      insertRows: [],
    });
    const res = await postJson(mount(ownerTabsRouter), '/sync', {
      state: { tabs: [], activeTabId: null },
    });
    expect(res.status).toBe(409);
    const env = (await res.json()) as { error?: { code?: string } };
    expect(env.error?.code).toBe('OWNER_TABS_CONFLICT');
  });

  it('200 on first write when the INSERT-if-absent succeeds (no prior row)', async () => {
    injected.role = UserRole.OWNER;
    injected.db = makeTabsDb({
      existingRow: null,
      updateRows: [],
      insertRows: [{ tenant_id: 'tenant-a' }],
    });
    const res = await postJson(mount(ownerTabsRouter), '/sync', {
      state: { tabs: [], activeTabId: null },
    });
    expect(res.status).toBe(200);
  });
});

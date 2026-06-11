/**
 * /api/v1/buyer/superpowers — handler tests.
 *
 * Covers the four endpoints buyer-mobile calls:
 *   POST /bulk-action              (bulk_rfb | bulk_watch)
 *   POST /undo-journal/undo-last
 *   POST /pinned-items
 *   GET  /search?q=&persona=buyer
 *
 * Asserts auth gating (503 without auth ctx), tenant scoping (the
 * tenantId/actorId from `c.get('auth')` is written into every row),
 * persona enforcement (non-buyer verbs are 400), and response shape.
 *
 * A hand-rolled Drizzle shim captures inserts/updates/selects via
 * `getTableName` so we can assert WHAT was written WHERE without a DB.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { getTableName } from 'drizzle-orm';

vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (_c: unknown, next: () => Promise<void>) => next(),
}));

import { buyerSuperpowersRouter } from '../superpowers.hono';

interface InsertCall {
  readonly table: string;
  readonly values: Record<string, unknown>;
}
interface UpdateCall {
  readonly table: string;
  readonly set: Record<string, unknown>;
}

function tableNameOf(obj: unknown): string {
  try {
    return getTableName(obj as never);
  } catch {
    return 'unknown';
  }
}

interface ShimOpts {
  /** Canned select rows keyed by table name. */
  readonly selectRows?: Record<string, ReadonlyArray<Record<string, unknown>>>;
  /** Canned returning() rows keyed by table name (insert + update). */
  readonly returnRows?: Record<string, ReadonlyArray<Record<string, unknown>>>;
}

function makeShim(opts: ShimOpts = {}) {
  const inserts: InsertCall[] = [];
  const updates: UpdateCall[] = [];
  const selects: string[] = [];
  let pinSeq = 0;
  let journalSeq = 0;

  const returnFor = (table: string, values?: Record<string, unknown>) => {
    const canned = opts.returnRows?.[table];
    if (canned) return canned.map((r) => ({ ...r }));
    if (table === 'pinned_items') {
      pinSeq += 1;
      return [{ id: `pin_${pinSeq}`, label: values?.label ?? 'label' }];
    }
    if (table === 'undo_journal') {
      journalSeq += 1;
      return [{ id: `00000000-0000-0000-0000-00000000000${journalSeq}` }];
    }
    return [{ id: `${table}_1` }];
  };

  const client = {
    insert(table: unknown) {
      const name = tableNameOf(table);
      return {
        values(v: Record<string, unknown>) {
          inserts.push({ table: name, values: v });
          return { returning: () => Promise.resolve(returnFor(name, v)) };
        },
      };
    },
    update(table: unknown) {
      const name = tableNameOf(table);
      return {
        set(s: Record<string, unknown>) {
          return {
            where() {
              updates.push({ table: name, set: s });
              return { returning: () => Promise.resolve(returnFor(name, s)) };
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          const name = tableNameOf(table);
          selects.push(name);
          const rows = opts.selectRows?.[name] ?? [];
          return {
            where() {
              return {
                limit: () => Promise.resolve(rows),
                orderBy: () => ({ limit: () => Promise.resolve(rows) }),
              };
            },
          };
        },
      };
    },
  };

  return { client, inserts, updates, selects };
}

function buildApp(stubs: {
  authResp?: { tenantId?: string; userId?: string } | null;
  db: ReturnType<typeof makeShim>['client'];
}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (stubs.authResp !== null) {
      c.set('auth', stubs.authResp ?? { tenantId: 'tnt-buyer', userId: 'buyer-1' });
    }
    c.set('db', stubs.db);
    await next();
  });
  app.route('/', buyerSuperpowersRouter);
  return app;
}

function postJson(path: string, body: unknown) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } as const;
}

describe('POST /bulk-action', () => {
  it('bulk_watch pins each id and records an undo-journal row per id', async () => {
    const { client, inserts } = makeShim();
    const app = buildApp({ db: client });
    const res = await app.request(
      '/bulk-action',
      postJson('/bulk-action', {
        entityType: 'parcel',
        ids: ['p1', 'p2'],
        action: 'bulk_watch',
        persona: 'buyer',
        reason: 'buyer-bulk-bulk_watch',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.processed).toBe(2);
    expect(body.data.failed).toBe(0);
    expect(body.data.undoJournalIds.length).toBe(2);
    // 2 pins + 2 journal rows.
    const pinInserts = inserts.filter((i) => i.table === 'pinned_items');
    const journalInserts = inserts.filter((i) => i.table === 'undo_journal');
    expect(pinInserts.length).toBe(2);
    expect(journalInserts.length).toBe(2);
    // Tenant scope: every write carries the auth tenantId/actorId.
    for (const j of journalInserts) {
      expect(j.values.tenantId).toBe('tnt-buyer');
      expect(j.values.actorId).toBe('buyer-1');
    }
    for (const p of pinInserts) {
      expect(p.values.tenantId).toBe('tnt-buyer');
      expect(p.values.ownerId).toBe('buyer-1');
    }
    // The journal row links the pin so undo can reverse it.
    expect(journalInserts[0].values.provenance).toMatchObject({
      persona: 'buyer',
      pinnedItemId: expect.any(String),
    });
  });

  it('bulk_rfb records journal rows without pinning', async () => {
    const { client, inserts } = makeShim();
    const app = buildApp({ db: client });
    const res = await app.request(
      '/bulk-action',
      postJson('/bulk-action', {
        entityType: 'rfb',
        ids: ['r1'],
        action: 'bulk_rfb',
        persona: 'buyer',
        reason: 'buyer-bulk-bulk_rfb',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.processed).toBe(1);
    expect(inserts.filter((i) => i.table === 'pinned_items').length).toBe(0);
    expect(inserts.filter((i) => i.table === 'undo_journal').length).toBe(1);
  });

  it('rejects a non-buyer action verb (persona guard)', async () => {
    const { client } = makeShim();
    const app = buildApp({ db: client });
    const res = await app.request(
      '/bulk-action',
      postJson('/bulk-action', {
        entityType: 'tasks',
        ids: ['t1'],
        action: 'complete',
        persona: 'buyer',
        reason: 'x',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a non-buyer persona literal', async () => {
    const { client } = makeShim();
    const app = buildApp({ db: client });
    const res = await app.request(
      '/bulk-action',
      postJson('/bulk-action', {
        entityType: 'parcel',
        ids: ['p1'],
        action: 'bulk_watch',
        persona: 'owner',
        reason: 'x',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 503 when no auth context is present', async () => {
    const { client } = makeShim();
    const app = buildApp({ authResp: null, db: client });
    const res = await app.request(
      '/bulk-action',
      postJson('/bulk-action', {
        entityType: 'parcel',
        ids: ['p1'],
        action: 'bulk_watch',
        persona: 'buyer',
        reason: 'x',
      }),
    );
    expect(res.status).toBe(503);
  });
});

describe('POST /undo-journal/undo-last', () => {
  it('marks journal rows undone and unpins linked watch pins', async () => {
    const journalId = '11111111-1111-1111-1111-111111111111';
    const { client, updates } = makeShim({
      returnRows: {
        undo_journal: [
          { id: journalId, provenance: { pinnedItemId: 'pin_9' } },
        ],
        pinned_items: [{ id: 'pin_9' }],
      },
    });
    const app = buildApp({ db: client });
    const res = await app.request(
      '/undo-journal/undo-last',
      postJson('/undo-journal/undo-last', {
        journalIds: [journalId],
        reason: 'user-tapped-undo-toast',
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.undone).toBe(1);
    expect(body.data.unpinned).toBe(1);
    // Both the journal update and the pin reversal were issued.
    expect(updates.some((u) => u.table === 'undo_journal')).toBe(true);
    expect(updates.some((u) => u.table === 'pinned_items')).toBe(true);
  });

  it('rejects a non-uuid journal id', async () => {
    const { client } = makeShim();
    const app = buildApp({ db: client });
    const res = await app.request(
      '/undo-journal/undo-last',
      postJson('/undo-journal/undo-last', { journalIds: ['not-a-uuid'] }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 503 without auth context', async () => {
    const { client } = makeShim();
    const app = buildApp({ authResp: null, db: client });
    const res = await app.request(
      '/undo-journal/undo-last',
      postJson('/undo-journal/undo-last', {
        journalIds: ['11111111-1111-1111-1111-111111111111'],
      }),
    );
    expect(res.status).toBe(503);
  });
});

describe('POST /pinned-items', () => {
  it('pins a parcel scoped to the buyer tenant + owner', async () => {
    const { client, inserts } = makeShim();
    const app = buildApp({ db: client });
    const res = await app.request(
      '/pinned-items',
      postJson('/pinned-items', {
        entityType: 'parcel',
        entityId: 'parcel-7',
        label: 'Au parcel',
        persona: 'buyer',
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.pinnedItemId).toBeTruthy();
    const pin = inserts.find((i) => i.table === 'pinned_items');
    expect(pin?.values.tenantId).toBe('tnt-buyer');
    expect(pin?.values.ownerId).toBe('buyer-1');
    expect(pin?.values.entityType).toBe('parcel');
  });

  it('rejects an out-of-whitelist entity type', async () => {
    const { client } = makeShim();
    const app = buildApp({ db: client });
    const res = await app.request(
      '/pinned-items',
      postJson('/pinned-items', {
        entityType: 'licence',
        entityId: 'lic-1',
        persona: 'buyer',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 503 without auth context', async () => {
    const { client } = makeShim();
    const app = buildApp({ authResp: null, db: client });
    const res = await app.request(
      '/pinned-items',
      postJson('/pinned-items', {
        entityType: 'parcel',
        entityId: 'parcel-7',
        persona: 'buyer',
      }),
    );
    expect(res.status).toBe(503);
  });
});

describe('GET /search', () => {
  it('returns navigate targets from listings + own RFBs', async () => {
    const { client, selects } = makeShim({
      selectRows: {
        marketplace_listings: [
          { id: 'L1', title: 'Gold ore lot', description: 'Au 22ct' },
        ],
        request_for_bids: [{ id: 'R1', mineralKind: 'gold', notes: 'urgent' }],
      },
    });
    const app = buildApp({ db: client });
    const res = await app.request('/search?q=gold&persona=buyer&limit=20');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.results.length).toBe(2);
    expect(body.data.results[0].route).toBe('/marketplace/L1');
    expect(body.data.results[1].route).toBe('/rfb/R1');
    // Both tenant-scoped tables were queried.
    expect(selects).toContain('marketplace_listings');
    expect(selects).toContain('request_for_bids');
  });

  it('rejects a missing query', async () => {
    const { client } = makeShim();
    const app = buildApp({ db: client });
    const res = await app.request('/search?persona=buyer');
    expect(res.status).toBe(400);
  });

  it('returns 503 without auth context', async () => {
    const { client } = makeShim();
    const app = buildApp({ authResp: null, db: client });
    const res = await app.request('/search?q=gold&persona=buyer');
    expect(res.status).toBe(503);
  });
});

// ─── Principal-role guard (FIX 1) ─────────────────────────────────────
//
// The router wires the REAL `requireRole(...)` (mirroring the admin/owner
// routers) right after `authMiddleware` so a non-buyer authenticated tenant
// principal is rejected with 403 BEFORE any handler runs — the body
// `persona: 'buyer'` literal is no longer the only gate. The file-level
// `vi.mock` stubs `requireRole` to a pass-through for the handler tests
// above; here we exercise the ACTUAL guard via `importActual` and wire it
// exactly as the router does (after a middleware that sets `auth.role`).
describe('principal-role guard', () => {
  async function buildGuardedApp(role: string) {
    const honoAuth = await vi.importActual<
      typeof import('../../../middleware/hono-auth')
    >('../../../middleware/hono-auth');
    const { UserRole } = await vi.importActual<
      typeof import('../../../types/user-role')
    >('../../../types/user-role');

    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth', { tenantId: 'tnt-buyer', userId: 'u-1', role });
      await next();
    });
    app.use(
      '*',
      honoAuth.requireRole(
        UserRole.RESIDENT,
        UserRole.OWNER,
        UserRole.TENANT_ADMIN,
        UserRole.ADMIN,
        UserRole.SUPER_ADMIN,
      ),
    );
    app.get('/probe', (c) => c.json({ success: true }));
    return app;
  }

  it('rejects a non-buyer principal with 403', async () => {
    // PROPERTY_MANAGER == mining site-manager / employee persona — NOT a buyer.
    const app = await buildGuardedApp('PROPERTY_MANAGER');
    const res = await app.request('/probe');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('rejects MAINTENANCE_STAFF (field employee) with 403', async () => {
    const app = await buildGuardedApp('MAINTENANCE_STAFF');
    const res = await app.request('/probe');
    expect(res.status).toBe(403);
  });

  it('admits the buyer principal (RESIDENT)', async () => {
    const app = await buildGuardedApp('RESIDENT');
    const res = await app.request('/probe');
    expect(res.status).toBe(200);
  });

  it('admits an owner acting on a buyer behalf (OWNER)', async () => {
    const app = await buildGuardedApp('OWNER');
    const res = await app.request('/probe');
    expect(res.status).toBe(200);
  });
});

/**
 * /api/v1/mining/driver-letter-acks — offline-field-capture sink tests.
 *
 * Closes the last degraded leg of the offline-field-capture BLOCKER: the
 * driver-letter-ack sink now persists a REAL `driver_letter_acks` row (migration
 * 0362) atomic with the hash-chained audit append, instead of the prior
 * audit-only degraded accept.
 *
 * Mounts the real `createDriverLetterAcksRouter` against a stubbed Drizzle
 * client + injected auth context (the hono-auth + database middleware are
 * mocked so the test exercises the handler in isolation — no live JWKS / RLS
 * GUC binding). Mirrors the invites.test.ts harness.
 *
 * Assertions:
 *   (a) a POST persists a driver_letter_acks row (201 + row in the store).
 *   (b) a replay with the SAME Idempotency-Key is idempotent — exactly one row,
 *       2xx on both posts (201 first, 200 idempotent short-circuit on replay).
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
import { createDriverLetterAcksRouter } from '../field-capture.hono.js';

// ---------------------------------------------------------------------------
// Fake drizzle client. Backs `driver_letter_acks` rows + an audit-chain stub:
//   - select().from().where().limit() → existsById lookup (idempotency check).
//   - insert().values().onConflictDoNothing().returning() → the domain insert.
//   - transaction(fn) → fn(self) (no real isolation needed for the assertions).
//   - execute() → the appendAuditEntry MAX/last_hash lookup + INSERT.
// The `where` predicate is supplied by the mocked drizzle eq/and below.
// ---------------------------------------------------------------------------

interface FakeDb {
  rows(): any[];
  select(): any;
  insert(table: any): any;
  transaction(fn: (tx: FakeDb) => Promise<any>): Promise<any>;
  execute(query: any): Promise<any>;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
}

function createFakeDb(initial: any[] = []): FakeDb {
  let rows: any[] = [...initial];

  function applyFilter(condition: any): (row: any) => boolean {
    if (!condition) return () => true;
    if (typeof condition.__filter === 'function') return condition.__filter;
    return () => true;
  }

  const api: FakeDb = {
    rows: () => rows,
    select() {
      return {
        from() {
          return {
            where(condition: any) {
              const filterFn = applyFilter(condition);
              return {
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
            onConflictDoNothing() {
              return {
                returning() {
                  // ON CONFLICT (id) DO NOTHING — drop rows whose id already
                  // exists so a replay inserts nothing (at-least-once dedupe).
                  const existingIds = new Set(rows.map((r) => r.id));
                  const created = next
                    .filter((row) => !existingIds.has(row.id))
                    .map((row) => ({
                      acknowledgedAt: row.acknowledgedAt ?? new Date(),
                      ...row,
                    }));
                  rows = [...rows, ...created];
                  return Promise.resolve(created);
                },
              };
            },
          };
        },
      };
    },
    async transaction(fn: (tx: FakeDb) => Promise<any>) {
      return fn(api);
    },
    async execute(query: any) {
      const text =
        typeof query === 'object' && query !== null && 'queryChunks' in query
          ? String((query as any).queryChunks ?? '')
          : String(query);
      if (text.includes('ai_audit_chain') && text.includes('INSERT')) {
        return { rows: [] };
      }
      // The MAX/last_hash lookup short-circuits with an empty head.
      return { rows: [{ max_seq: 0, last_hash: null }] };
    },
  };
  return api;
}

// drizzle-orm shim — turn eq/and into predicate fns the fake client uses, and
// stub sql`` so the audit append's tagged-template lookups don't throw.
vi.mock('drizzle-orm', async (original) => {
  const real = await original<typeof import('drizzle-orm')>();
  const readField = (col: any) => col?.name ?? col?._?.name ?? null;
  const sqlFn: any = (..._args: any[]) => ({ queryChunks: 'sql-stub' });
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
    sql: sqlFn,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const IDEMPOTENCY_KEY = 'queue-entry-abc-123';

function setAuth(
  overrides: Partial<{ userId: string; tenantId: string }> = {},
) {
  (globalThis as any).__BORJIE_TEST_AUTH__ = {
    userId: overrides.userId ?? USER_ID,
    tenantId: overrides.tenantId ?? TENANT_ID,
    role: 'EMPLOYEE',
    permissions: [],
    propertyAccess: ['*'],
  };
}

function setDb(db: FakeDb | null) {
  (globalThis as any).__BORJIE_TEST_DB__ = db;
}

function buildApp(): Hono {
  const app = new Hono();
  app.route('/api/v1/mining/driver-letter-acks', createDriverLetterAcksRouter());
  return app;
}

function postAck(app: Hono) {
  return app.request('/api/v1/mining/driver-letter-acks', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test',
      'Content-Type': 'application/json',
      'Idempotency-Key': IDEMPOTENCY_KEY,
    },
    body: JSON.stringify({
      letterId: 'ltr-7',
      driverId: 'drv-3',
      siteId: 'site-1',
      geo: '{"type":"Point","coordinates":[39.2,-6.8]}',
    }),
  });
}

// ---------------------------------------------------------------------------
// (a) persists a real driver_letter_acks row
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/driver-letter-acks — persists a real row', () => {
  beforeEach(() => setAuth());

  it('returns 201 and writes a driver_letter_acks row with auth-scoped identity', async () => {
    const db = createFakeDb();
    setDb(db);
    const res = await postAck(buildApp());
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      meta?: { degraded?: boolean };
      data: Record<string, unknown>;
    };
    expect(body.success).toBe(true);
    // The degraded flag is gone — this is a real persisted accept.
    expect(body.meta?.degraded).toBeUndefined();
    expect(db.rows().length).toBe(1);
    const row = db.rows()[0]!;
    expect(row.tenantId).toBe(TENANT_ID);
    expect(row.userId).toBe(USER_ID);
    expect(row.letterId).toBe('ltr-7');
    expect(row.driverId).toBe('drv-3');
    expect(row.siteId).toBe('site-1');
  });
});

// ---------------------------------------------------------------------------
// (b) idempotent replay on the same Idempotency-Key
// ---------------------------------------------------------------------------

describe('POST /api/v1/mining/driver-letter-acks — idempotency', () => {
  beforeEach(() => setAuth());

  it('a replay with the same Idempotency-Key is a no-op: one row, 2xx both times', async () => {
    const db = createFakeDb();
    setDb(db);
    const app = buildApp();

    const first = await postAck(app);
    expect(first.status).toBe(201);
    expect(db.rows().length).toBe(1);

    const replay = await postAck(app);
    // The existsById short-circuit returns the existing row with 200.
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as {
      success: boolean;
      meta?: { idempotent?: boolean };
    };
    expect(replayBody.success).toBe(true);
    expect(replayBody.meta?.idempotent).toBe(true);

    // No duplicate row was created.
    expect(db.rows().length).toBe(1);
  });
});

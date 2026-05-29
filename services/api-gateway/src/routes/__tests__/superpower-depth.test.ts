/**
 * Superpower SOTA-depth contract tests (2026-05-29).
 *
 * Pins the wire contract for the three depth fixes added in the
 * SOTA-depth audit. These are pure schema/route-shape tests — they
 * exercise the route via a stubbed Drizzle query builder so we get
 * end-to-end coverage of the response shape without needing a live
 * Postgres.
 *
 * Tests:
 *   1. POST /api/v1/owner/superpowers/bulk-action returns BOTH the
 *      `failedIds[]` per-row manifest AND the aggregate counters
 *      so the FE can render a per-row error list.
 *   2. POST /api/v1/owner/undo-journal/undo-by-id rejects an unknown
 *      journal id with 404 (not 500) so a stale list-view tap shows
 *      a clean error.
 *   3. POST /api/v1/owner/undo-journal/undo-by-id rejects a window-
 *      lapsed entry with 410 Gone so the FE distinguishes "already
 *      undone" (409) from "window passed" (410).
 *
 * The test mocks the `authMiddleware` and `databaseMiddleware` modules
 * so the route gets exactly the bindings it needs without minting a
 * real JWT or touching Postgres. Each test instantiates a fresh app +
 * stub so they are independent.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

// Pin env BEFORE any router import so config loaders succeed.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-superpower-depth-32-chars-long';
process.env.SUPABASE_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET || 'test-supabase-superpower-depth-32-chars-long';
process.env.BORJIE_SKIP_DOTENV = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'anon-key-aaaaaaaaaaaaaaaaaaaaaaaa';

// ─── Mock the auth + database middlewares ─────────────────────────────
//
// Both middlewares run inside the sub-router. We replace them with
// pass-throughs and inject the auth + db bindings ourselves via a
// parent middleware. The sub-router never sees the real auth chain so
// the test stays focused on the route's own depth contract.
vi.mock('../../middleware/hono-auth', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));
vi.mock('../../middleware/database', () => ({
  databaseMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

// ─── Drizzle chainable stub ───────────────────────────────────────────
//
// The routes call `db.insert(table).values(...).returning()` and
// `db.select().from(table).where(...).limit(...)`. We return a thenable
// chainable that mimics drizzle's builder for the calls each route
// makes.

type Row = Record<string, unknown>;

interface DbState {
  readonly insertRows: Row[];
  readonly selectRows: Row[];
  readonly updateRows: Row[];
  insertCalls: number;
  insertFailOn?: (id: string) => boolean;
}

function makeDbStub(state: DbState) {
  return {
    insert(_table: unknown) {
      return {
        values(input: Record<string, unknown>) {
          return {
            async returning() {
              const id = input.entityId as string | undefined;
              if (id && state.insertFailOn && state.insertFailOn(id)) {
                throw new Error(`forced-failure for id=${id}`);
              }
              state.insertCalls += 1;
              const row = {
                ...input,
                id: `journal-${state.insertCalls}`,
                performedAt: new Date(),
                windowSeconds: input.windowSeconds ?? 300,
              };
              state.insertRows.push(row);
              return [row];
            },
          };
        },
      };
    },
    select() {
      return {
        from(_table: unknown) {
          return {
            where(_w: unknown) {
              return {
                async limit(_n: number) {
                  return state.selectRows;
                },
                orderBy() {
                  return {
                    async limit(_n: number) {
                      return state.selectRows;
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    update(_table: unknown) {
      return {
        set(input: Record<string, unknown>) {
          return {
            where(_w: unknown) {
              return {
                async returning() {
                  if (state.selectRows.length === 0) return [];
                  const merged = { ...state.selectRows[0], ...input };
                  state.updateRows.push(merged);
                  return [merged];
                },
              };
            },
          };
        },
      };
    },
  };
}

// Use a lazy import so env vars + mocks above are applied first.
async function buildSuperpowersApp(state: DbState) {
  const { ownerSuperpowersRouter } = await import(
    '../owner/superpowers.hono'
  );
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set(
      'auth' as unknown as never,
      {
        tenantId: 'tn_depth_test',
        userId: 'usr_depth_test',
      } as unknown as never,
    );
    c.set('db' as unknown as never, makeDbStub(state) as unknown as never);
    await next();
  });
  app.route('/owner/superpowers', ownerSuperpowersRouter);
  return app;
}

async function buildUndoApp(state: DbState) {
  const { ownerUndoJournalRouter } = await import(
    '../owner/undo-journal.hono'
  );
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set(
      'auth' as unknown as never,
      {
        tenantId: 'tn_depth_test',
        userId: 'usr_depth_test',
      } as unknown as never,
    );
    c.set('db' as unknown as never, makeDbStub(state) as unknown as never);
    await next();
  });
  app.route('/owner/undo-journal', ownerUndoJournalRouter);
  return app;
}

describe('§1 bulk-action — per-item failure manifest', () => {
  it('returns failedIds[] with reason per failed row + processedIds[]', async () => {
    const state: DbState = {
      insertRows: [],
      selectRows: [],
      updateRows: [],
      insertCalls: 0,
      insertFailOn: (id) => id === 'r2',
    };
    const app = await buildSuperpowersApp(state);
    const res = await app.request('/owner/superpowers/bulk-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: 'reminders',
        ids: ['r1', 'r2', 'r3'],
        action: 'snooze',
        reason: 'unit-test',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        processed: number;
        failed: number;
        processedIds: string[];
        failedIds: ReadonlyArray<{ id: string; reason: string }>;
        undoJournalIds: string[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.processed).toBe(2);
    expect(body.data.failed).toBe(1);
    expect(body.data.processedIds).toEqual(['r1', 'r3']);
    expect(body.data.failedIds).toHaveLength(1);
    expect(body.data.failedIds[0]?.id).toBe('r2');
    expect(body.data.failedIds[0]?.reason).toContain('forced-failure');
    expect(body.data.undoJournalIds).toHaveLength(2);
  });

  it('returns processedIds === ids and failedIds === [] when every row lands', async () => {
    const state: DbState = {
      insertRows: [],
      selectRows: [],
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildSuperpowersApp(state);
    const res = await app.request('/owner/superpowers/bulk-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entityType: 'reminders',
        ids: ['r1', 'r2'],
        action: 'snooze',
        reason: 'unit-test',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        processed: number;
        failed: number;
        failedIds: ReadonlyArray<unknown>;
      };
    };
    expect(body.data.processed).toBe(2);
    expect(body.data.failed).toBe(0);
    expect(body.data.failedIds).toEqual([]);
  });
});

describe('§2 undo-by-id — targeted rollback', () => {
  it('returns 404 when the journal entry id is unknown', async () => {
    const state: DbState = {
      insertRows: [],
      selectRows: [], // empty → not-found path
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildUndoApp(state);
    const res = await app.request('/owner/undo-journal/undo-by-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        journalId: '00000000-0000-0000-0000-000000000123',
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 410 Gone when the undo window has lapsed', async () => {
    const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
    const state: DbState = {
      insertRows: [],
      selectRows: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          tenantId: 'tn_depth_test',
          actorId: 'usr_depth_test',
          entityType: 'reminders',
          entityId: 'r1',
          actionKind: 'snooze',
          undoneAt: null,
          performedAt: sixMinutesAgo,
          windowSeconds: 300,
        },
      ],
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildUndoApp(state);
    const res = await app.request('/owner/undo-journal/undo-by-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        journalId: '11111111-1111-1111-1111-111111111111',
      }),
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('WINDOW_LAPSED');
  });

  it('returns 409 when the entry has already been undone', async () => {
    const state: DbState = {
      insertRows: [],
      selectRows: [
        {
          id: '22222222-2222-2222-2222-222222222222',
          tenantId: 'tn_depth_test',
          actorId: 'usr_depth_test',
          entityType: 'reminders',
          entityId: 'r1',
          actionKind: 'snooze',
          undoneAt: new Date(),
          performedAt: new Date(),
          windowSeconds: 300,
        },
      ],
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildUndoApp(state);
    const res = await app.request('/owner/undo-journal/undo-by-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        journalId: '22222222-2222-2222-2222-222222222222',
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('ALREADY_UNDONE');
  });

  it('undoes the entry and returns 200 with the journal row when fresh', async () => {
    const state: DbState = {
      insertRows: [],
      selectRows: [
        {
          id: '33333333-3333-3333-3333-333333333333',
          tenantId: 'tn_depth_test',
          actorId: 'usr_depth_test',
          entityType: 'reminders',
          entityId: 'r1',
          actionKind: 'snooze',
          undoneAt: null,
          performedAt: new Date(),
          windowSeconds: 300,
        },
      ],
      updateRows: [],
      insertCalls: 0,
    };
    const app = await buildUndoApp(state);
    const res = await app.request('/owner/undo-journal/undo-by-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        journalId: '33333333-3333-3333-3333-333333333333',
        reason: 'depth-test',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        undone: boolean;
        journalId: string;
        actionKind: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.undone).toBe(true);
    expect(body.data.actionKind).toBe('snooze');
  });
});

/**
 * Pinned-items undo-journal write contract test.
 *
 * Proves the fix for the "ui_bookmark UNDO BROKEN" finding: the pin POST
 * previously wrote NO undo_journal row, so the FE's Undo chip (which
 * posts to /undo-journal/undo-last) reversed an UNRELATED recent action.
 * Now the POST appends an `actionKind:'pin'` journal row targeting the
 * pinned_items table (entityId = the pin's own id) with a
 * `beforeState.unpinned_at` snapshot so reverse-replay un-pins it, and
 * returns the `undoJournalId` the FE lights the chip from.
 *
 * RED baseline: before the fix, no `insert(undoJournal)` call happens and
 * the response carries no `undoJournalId` — both assertions fail.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-pinned-undo-32-chars-longer';
process.env.SUPABASE_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ||
  'test-supabase-pinned-undo-32-chars-longer';
process.env.BORJIE_SKIP_DOTENV = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'anon-key-cccccccccccccccccccccccc';

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

type Row = Record<string, unknown>;

interface Captured {
  readonly inserts: Array<{ table: unknown; values: Row }>;
}

/**
 * DB stub that records every insert (so the test can assert an undo row
 * was written) and returns a synthetic id from `.returning()`. Select
 * returns [] so the pin route takes the fresh-insert branch. The two
 * inserts (pinnedItems, then undoJournal) each get a distinct id.
 */
function makeDbStub(captured: Captured) {
  let insertSeq = 0;
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return [];
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return {
        values(values: Row) {
          captured.inserts.push({ table, values });
          const id = `id_${(insertSeq += 1)}`;
          return {
            async returning() {
              return [{ id, position: 0, label: values.label ?? 'x' }];
            },
          };
        },
      };
    },
  };
}

async function buildApp(captured: Captured) {
  const { ownerPinnedItemsRouter } = await import(
    '../owner/pinned-items.hono'
  );
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set(
      'auth' as unknown as never,
      { tenantId: 'tn_undo', userId: 'usr_undo' } as unknown as never,
    );
    c.set('db' as unknown as never, makeDbStub(captured) as unknown as never);
    await next();
  });
  app.route('/owner/pinned-items', ownerPinnedItemsRouter);
  return app;
}

describe('POST /owner/pinned-items — undo-journal write', () => {
  it('appends an actionKind:pin undo row and returns its id', async () => {
    const captured: Captured = { inserts: [] };
    const app = await buildApp(captured);
    const res = await app.request('/owner/pinned-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'licence', entityId: 'lic_42' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { pinnedItemId: string; undoJournalId: string | null };
    };
    expect(body.success).toBe(true);
    expect(body.data.undoJournalId).toBeTruthy();

    // Exactly TWO inserts: the pin, then its undo-journal row.
    expect(captured.inserts).toHaveLength(2);
    const undo = captured.inserts[1]!.values;
    expect(undo.actionKind).toBe('pin');
    expect(undo.entityType).toBe('pinned_items');
    // The journal row targets the pin's own id so undo un-pins it.
    expect(undo.entityId).toBe(body.data.pinnedItemId);
    // beforeState carries unpinned_at so reverse-replay soft-deletes it.
    expect((undo.beforeState as Row).unpinned_at).toBeTruthy();
  });
});

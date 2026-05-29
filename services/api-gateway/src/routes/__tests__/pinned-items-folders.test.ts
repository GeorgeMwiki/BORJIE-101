/**
 * Pinned-items folder grouping contract tests (2026-05-29).
 *
 * Pins the wire contract for the new SOTA-depth folder feature:
 *   1. PATCH /:id/folder assigns a folderId + folderLabel.
 *   2. PATCH /:id/folder with folderId:null clears the grouping.
 *   3. POST /folder/rename updates every member of a folder in one
 *      call and returns the count of touched rows.
 *
 * The test mocks `authMiddleware` and `databaseMiddleware` so the route
 * receives exactly the bindings it needs without minting a real JWT or
 * touching Postgres.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

// Pin env BEFORE any router import.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-pinned-folders-32-chars-long';
process.env.SUPABASE_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ||
  'test-supabase-pinned-folders-32-chars-long';
process.env.BORJIE_SKIP_DOTENV = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'anon-key-bbbbbbbbbbbbbbbbbbbbbbbb';

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

interface DbState {
  readonly updateRows: Row[];
  readonly selectRows: Row[];
  /** When non-empty, the next `.returning()` call resolves with this. */
  nextUpdateReturning?: Row[];
}

function makeDbStub(state: DbState) {
  return {
    update(_table: unknown) {
      return {
        set(input: Record<string, unknown>) {
          return {
            where(_w: unknown) {
              return {
                async returning() {
                  if (state.nextUpdateReturning) {
                    const rows = state.nextUpdateReturning.map((r) => ({
                      ...r,
                      ...input,
                    }));
                    state.updateRows.push(...rows);
                    return rows;
                  }
                  return [];
                },
              };
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
                orderBy(..._args: unknown[]) {
                  return Promise.resolve(state.selectRows);
                },
              };
            },
          };
        },
      };
    },
  };
}

async function buildPinnedApp(state: DbState) {
  const { ownerPinnedItemsRouter } = await import(
    '../owner/pinned-items.hono'
  );
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set(
      'auth' as unknown as never,
      {
        tenantId: 'tn_folder_test',
        userId: 'usr_folder_test',
      } as unknown as never,
    );
    c.set('db' as unknown as never, makeDbStub(state) as unknown as never);
    await next();
  });
  app.route('/owner/pinned-items', ownerPinnedItemsRouter);
  return app;
}

describe('PATCH /:id/folder — folder assignment', () => {
  it('assigns a folderId + label to an existing pinned item', async () => {
    const state: DbState = {
      updateRows: [],
      selectRows: [],
      nextUpdateReturning: [
        {
          id: 'aaa',
          tenantId: 'tn_folder_test',
          ownerId: 'usr_folder_test',
          entityType: 'licence',
          entityId: 'lic_1',
          label: 'Mining licence 12',
        },
      ],
    };
    const app = await buildPinnedApp(state);
    const res = await app.request('/owner/pinned-items/aaa/folder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderId: '11111111-1111-1111-1111-111111111111',
        folderLabel: 'Geita',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { pinnedItem: { folderId: string; folderLabel: string } };
    };
    expect(body.success).toBe(true);
    expect(body.data.pinnedItem.folderId).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
    expect(body.data.pinnedItem.folderLabel).toBe('Geita');
  });

  it('clears the folder when folderId is null', async () => {
    const state: DbState = {
      updateRows: [],
      selectRows: [],
      nextUpdateReturning: [
        {
          id: 'bbb',
          tenantId: 'tn_folder_test',
          ownerId: 'usr_folder_test',
          entityType: 'licence',
          entityId: 'lic_1',
          label: 'Mining licence 12',
        },
      ],
    };
    const app = await buildPinnedApp(state);
    const res = await app.request('/owner/pinned-items/bbb/folder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { pinnedItem: { folderId: null; folderLabel: null } };
    };
    expect(body.success).toBe(true);
    expect(body.data.pinnedItem.folderId).toBeNull();
    expect(body.data.pinnedItem.folderLabel).toBeNull();
  });

  it('returns 404 when the pinned item is not found', async () => {
    const state: DbState = {
      updateRows: [],
      selectRows: [],
      nextUpdateReturning: [],
    };
    const app = await buildPinnedApp(state);
    const res = await app.request('/owner/pinned-items/ghost/folder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderId: '22222222-2222-2222-2222-222222222222',
        folderLabel: 'Lake Zone',
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an invalid folderId (non-uuid) with 400', async () => {
    const state: DbState = {
      updateRows: [],
      selectRows: [],
      nextUpdateReturning: [],
    };
    const app = await buildPinnedApp(state);
    const res = await app.request('/owner/pinned-items/ccc/folder', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId: 'not-a-uuid', folderLabel: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /folder/rename — batch rename', () => {
  it('updates every member of a folder and reports the count', async () => {
    const state: DbState = {
      updateRows: [],
      selectRows: [],
      nextUpdateReturning: [
        { id: 'a', folderId: '11111111-1111-1111-1111-111111111111' },
        { id: 'b', folderId: '11111111-1111-1111-1111-111111111111' },
        { id: 'c', folderId: '11111111-1111-1111-1111-111111111111' },
      ],
    };
    const app = await buildPinnedApp(state);
    const res = await app.request('/owner/pinned-items/folder/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderId: '11111111-1111-1111-1111-111111111111',
        folderLabel: 'Geita Province',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        folderId: string;
        folderLabel: string;
        updatedCount: number;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.updatedCount).toBe(3);
    expect(body.data.folderLabel).toBe('Geita Province');
  });

  it('rejects a payload missing folderLabel with 400', async () => {
    const state: DbState = {
      updateRows: [],
      selectRows: [],
      nextUpdateReturning: [],
    };
    const app = await buildPinnedApp(state);
    const res = await app.request('/owner/pinned-items/folder/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        folderId: '11111111-1111-1111-1111-111111111111',
      }),
    });
    expect(res.status).toBe(400);
  });
});

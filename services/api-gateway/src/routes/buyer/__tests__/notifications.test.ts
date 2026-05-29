/**
 * /api/v1/buyer/notifications — L7 read surface tests.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
  requireRole: () => async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));
vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { buyerNotificationsRouter } from '../notifications.hono';

interface Recorded {
  fragments: ReadonlyArray<string>;
  params: ReadonlyArray<unknown>;
}

function makeDb(responder: (rec: Recorded) => unknown) {
  const calls: Recorded[] = [];
  const execute = async (q: unknown) => {
    if (q && typeof q === 'object' && 'queryChunks' in q) {
      const chunks =
        (q as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [];
      const fragments: string[] = [];
      const params: unknown[] = [];
      const flatten = (arr: ReadonlyArray<unknown>): void => {
        for (const c of arr) {
          if (c && typeof c === 'object' && 'value' in c) {
            fragments.push(String((c as { value: unknown }).value ?? ''));
          } else if (c && typeof c === 'object' && 'queryChunks' in c) {
            flatten(
              (c as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [],
            );
          } else {
            params.push(c);
          }
        }
      };
      flatten(chunks);
      const rec = { fragments, params };
      calls.push(rec);
      return responder(rec);
    }
    return { rows: [] };
  };
  return {
    db: { execute },
    calls,
  };
}

function buildApp(stubs: {
  authResp?: { tenantId?: string; userId?: string } | null;
  db: ReturnType<typeof makeDb>['db'];
}) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (stubs.authResp !== null) {
      c.set(
        'auth',
        stubs.authResp ?? {
          tenantId: 'tnt-buyer',
          userId: 'buyer-1',
        },
      );
    }
    c.set('db', stubs.db);
    await next();
  });
  app.route('/', buyerNotificationsRouter);
  return app;
}

describe('GET /api/v1/buyer/notifications — L7', () => {
  it('paginates rows in ts-desc order', async () => {
    const { db, calls } = makeDb(() => ({
      rows: [
        {
          id: 'n1',
          buyer_tenant_id: 'tnt-buyer',
          buyer_user_id: 'buyer-1',
          seller_tenant_id: 'tnt-seller',
          rfb_id: 'rfb-1',
          kind: 'rfb_fulfilled',
          title_sw: 'RFB yako imetimizwa',
          title_en: 'Your RFB has been fulfilled',
          body_sw: 'Tafadhali angalia.',
          body_en: 'Please review.',
          payload: {},
          read_at: null,
          created_at: '2026-05-29T10:00:00Z',
        },
      ],
    }));
    const app = buildApp({ db });
    const res = await app.request('/?limit=10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.notifications.length).toBe(1);
    expect(body.data.notifications[0].kind).toBe('rfb_fulfilled');
    expect(body.data.nextCursor).toBeNull();
    // Confirm we issued a SELECT against buyer_notifications.
    expect(calls[0]?.fragments.join('')).toContain(
      'FROM buyer_notifications',
    );
  });

  it('returns nextCursor when the page is full', async () => {
    // Server returns limit+1 rows; the route should slice + emit cursor.
    const rows = Array.from({ length: 11 }).map((_, i) => ({
      id: `n${i}`,
      buyer_tenant_id: 'tnt-buyer',
      buyer_user_id: 'buyer-1',
      seller_tenant_id: 'tnt-seller',
      rfb_id: `rfb-${i}`,
      kind: 'rfb_fulfilled',
      title_sw: 't',
      title_en: 't',
      body_sw: 'b',
      body_en: 'b',
      payload: {},
      read_at: null,
      created_at: `2026-05-29T10:0${i}:00Z`,
    }));
    const { db } = makeDb(() => ({ rows }));
    const app = buildApp({ db });
    const res = await app.request('/?limit=10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.notifications.length).toBe(10);
    expect(body.data.nextCursor).not.toBeNull();
  });

  it('returns 503 when no auth context is present', async () => {
    const { db } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ authResp: null, db });
    const res = await app.request('/');
    expect(res.status).toBe(503);
  });

  it('marks a notification read', async () => {
    const { db, calls } = makeDb(() => ({ rows: [] }));
    const app = buildApp({ db });
    const id = '11111111-2222-3333-4444-555555555555';
    const res = await app.request(`/${id}/read`, { method: 'POST' });
    expect(res.status).toBe(200);
    // Confirm an UPDATE on buyer_notifications was issued.
    expect(calls[0]?.fragments.join('')).toContain(
      'UPDATE buyer_notifications',
    );
  });
});

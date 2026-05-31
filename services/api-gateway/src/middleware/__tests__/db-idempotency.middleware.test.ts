/**
 * db-idempotency middleware tests — closes H2 deferral verification.
 *
 * Uses a hand-rolled in-memory shim for the DatabaseClient that mirrors
 * the Drizzle .insert/.select/.update chain shapes the middleware
 * relies on. The shim enforces the same partial-unique-index semantics
 * (collision on (tenantId, key, resourceKind)) so we can assert:
 *   - first delivery passes through and caches the response
 *   - duplicate request returns the cached response without re-running
 *     the handler
 *   - duplicate with a different request body returns 422
 *   - request without an Idempotency-Key skips caching
 *   - non-mutation methods skip caching
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';

import {
  createDbIdempotencyMiddleware,
  __internal,
} from '../db-idempotency.middleware';

interface Row {
  id: string;
  tenantId: string | null;
  key: string;
  resourceKind: string;
  requestHash: string;
  state: 'in_flight' | 'completed' | 'failed';
  responseStatus: number | null;
  responseBody: unknown;
  responseHeaders: Record<string, string> | null;
  actorId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
}

function rowKey(tenant: string | null, key: string, kind: string): string {
  return `${tenant ?? '__anon__'}|${key}|${kind}`;
}

function makeShim(): { client: any; rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const client = {
    insert(_table: any) {
      return {
        values(v: Partial<Row>): any {
          const composite = rowKey(
            v.tenantId ?? null,
            v.key ?? '',
            v.resourceKind ?? '',
          );
          return {
            onConflictDoNothing(_opts: any) {
              return {
                returning(_sel: any) {
                  if (rows.has(composite)) return Promise.resolve([]);
                  const row: Row = {
                    id: `idem_${rows.size + 1}`,
                    tenantId: v.tenantId ?? null,
                    key: v.key ?? '',
                    resourceKind: v.resourceKind ?? '',
                    requestHash: v.requestHash ?? '',
                    state: (v.state as Row['state']) ?? 'in_flight',
                    responseStatus: null,
                    responseBody: null,
                    responseHeaders: null,
                    actorId: v.actorId ?? null,
                    createdAt: new Date(),
                    completedAt: null,
                    expiresAt: v.expiresAt ?? new Date(Date.now() + 86_400_000),
                  };
                  rows.set(composite, row);
                  return Promise.resolve([{ id: row.id }]);
                },
              };
            },
          };
        },
      };
    },
    select(_sel: any) {
      return {
        from(_table: any) {
          return {
            where(_predicate: any) {
              return {
                limit(_n: number) {
                  return Promise.resolve([...rows.values()]);
                },
              };
            },
          };
        },
      };
    },
    update(_table: any) {
      return {
        set(patch: Partial<Row>): any {
          return {
            where(_predicate: any) {
              const updated: Array<{ id: string }> = [];
              for (const [, r] of rows) {
                Object.assign(r, patch);
                updated.push({ id: r.id });
              }
              return {
                returning(_sel: any) {
                  return Promise.resolve(updated);
                },
                then(resolve: (v: unknown) => void) {
                  resolve(undefined);
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, rows };
}

describe('db-idempotency.middleware', () => {
  let shim: ReturnType<typeof makeShim>;
  let handlerInvocations: number;

  beforeEach(() => {
    shim = makeShim();
    handlerInvocations = 0;
  });

  function makeApp(): Hono {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', shim.client as never);
      c.set('auth', { tenantId: 't1', userId: 'u1' } as never);
      await next();
    });
    app.use(
      '*',
      createDbIdempotencyMiddleware({ resourceKind: 'test.surface' }),
    );
    app.post('/x', async (c) => {
      handlerInvocations += 1;
      return c.json({ success: true, count: handlerInvocations });
    });
    return app;
  }

  it('passes through the first delivery and runs the handler exactly once', async () => {
    const app = makeApp();
    const res = await app.request('/x', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'key-1',
      },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(handlerInvocations).toBe(1);
    const row = [...shim.rows.values()][0]!;
    expect(row.state).toBe('completed');
    expect(row.responseStatus).toBe(200);
  });

  it('replays the cached response on a duplicate request without re-running the handler', async () => {
    const app = makeApp();
    const init = {
      method: 'POST' as const,
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'key-dup',
      },
      body: JSON.stringify({ a: 1 }),
    };
    const first = await app.request('/x', init);
    expect(first.status).toBe(200);
    expect(handlerInvocations).toBe(1);

    const second = await app.request('/x', init);
    expect(second.status).toBe(200);
    expect(handlerInvocations).toBe(1);
    expect(second.headers.get(__internal.REPLAY_MARKER_HEADER)).toBe('true');
    const bodyA = await first.clone().json();
    const bodyB = await second.json();
    expect(bodyB).toEqual(bodyA);
  });

  it('returns 422 when the same key is reused with a different body', async () => {
    const app = makeApp();
    await app.request('/x', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'key-mismatch',
      },
      body: JSON.stringify({ a: 1 }),
    });
    const second = await app.request('/x', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'key-mismatch',
      },
      body: JSON.stringify({ a: 2 }),
    });
    expect(second.status).toBe(422);
    const body = await second.json();
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('skips caching when no Idempotency-Key header is sent', async () => {
    const app = makeApp();
    const res1 = await app.request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    const res2 = await app.request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(handlerInvocations).toBe(2);
    expect(shim.rows.size).toBe(0);
  });

  it('skips caching for non-mutation methods', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('db', shim.client as never);
      c.set('auth', { tenantId: 't1', userId: 'u1' } as never);
      await next();
    });
    app.use(
      '*',
      createDbIdempotencyMiddleware({ resourceKind: 'test.read' }),
    );
    app.get('/r', (c) => c.json({ ok: true }));
    const res = await app.request('/r', {
      method: 'GET',
      headers: { 'idempotency-key': 'k-get' },
    });
    expect(res.status).toBe(200);
    expect(shim.rows.size).toBe(0);
  });

  it('returns 503 when db is unavailable on context', async () => {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth', { tenantId: 't1', userId: 'u1' } as never);
      await next();
    });
    app.use(
      '*',
      createDbIdempotencyMiddleware({ resourceKind: 'test.surface' }),
    );
    app.post('/x', (c) => c.json({ ok: true }));
    const res = await app.request('/x', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'k-nodb',
      },
      body: '{}',
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('IDEMPOTENCY_DB_UNAVAILABLE');
  });
});

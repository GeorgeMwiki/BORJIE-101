/**
 * P36 wiring-gap regression — persistent stores on Hono context.
 *
 * Closes the silent no-op bug surfaced by the P36 audit
 * (Docs/WIRING_GAPS_2026-05-24.md chain 3): the 5 persistent stores
 * (lessonStore / wormAuditStore / skillRegistryWriter / aopRegistryStore /
 * getA2aTaskStore) are constructed by `createPersistentStores` and held
 * on `registry.persistentStores`, but until this fix none of them were
 * bound onto the Hono request context via `c.set(...)`. Every route that
 * read `c.get('lessonStore')` etc. silently received `undefined` and
 * fell through to its no-op fallback — the most visible symptom being
 * dropped 1-star feedback writes on `POST /v1/ask/feedback`.
 *
 * This suite drives a request through `createServiceContextMiddleware`
 * and asserts that all 5 store keys resolve to real stores (and not
 * `undefined`) inside a downstream handler.
 *
 * Scope: middleware-level wiring only. Per-port persistent vs in-memory
 * mode-selection is covered in
 * `composition/__tests__/persistent-stores-registry-integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createServiceContextMiddleware } from '../composition/service-context.middleware.js';
import { buildServices } from '../composition/service-registry.js';

describe('service-context middleware — persistent stores binding (P36)', () => {
  it('binds all 5 persistent stores onto the Hono context', async () => {
    // Degraded registry (db=null) → every store goes to in-memory
    // mode. The wiring-binding under test runs identically in live
    // mode; we use degraded here so the test has zero infra dependency.
    const registry = buildServices({ db: null });

    const app = new Hono();
    app.use('*', createServiceContextMiddleware(registry));
    app.get('/probe', (c) => {
      const lessonStore = c.get('lessonStore');
      const wormAuditStore = c.get('wormAuditStore');
      const skillRegistryWriter = c.get('skillRegistryWriter');
      const aopRegistryStore = c.get('aopRegistryStore');
      const getA2aTaskStore = c.get('getA2aTaskStore');
      return c.json({
        lessonStore: typeof lessonStore,
        wormAuditStore: typeof wormAuditStore,
        skillRegistryWriter: typeof skillRegistryWriter,
        aopRegistryStore: typeof aopRegistryStore,
        getA2aTaskStore: typeof getA2aTaskStore,
      });
    });

    const res = await app.request('/probe');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    // Each store is an object / the A2A factory is a function. None
    // should be 'undefined' — that was the bug.
    expect(body.lessonStore).toBe('object');
    expect(body.wormAuditStore).toBe('object');
    expect(body.skillRegistryWriter).toBe('object');
    expect(body.aopRegistryStore).toBe('object');
    expect(body.getA2aTaskStore).toBe('function');
  });

  it('lessonStore on context is the SAME instance as registry.persistentStores.lessonStore', async () => {
    const registry = buildServices({ db: null });

    let captured: unknown = null;
    const app = new Hono();
    app.use('*', createServiceContextMiddleware(registry));
    app.get('/probe', (c) => {
      captured = c.get('lessonStore');
      return c.json({ ok: true });
    });

    await app.request('/probe');
    // Identity check — proves the middleware bound the same instance,
    // not a different fallback shim.
    expect(captured).toBe(registry.persistentStores.lessonStore);
  });

  it('wormAuditStore on context is the SAME instance as registry.persistentStores.wormAuditStore', async () => {
    const registry = buildServices({ db: null });

    let captured: unknown = null;
    const app = new Hono();
    app.use('*', createServiceContextMiddleware(registry));
    app.get('/probe', (c) => {
      captured = c.get('wormAuditStore');
      return c.json({ ok: true });
    });

    await app.request('/probe');
    expect(captured).toBe(registry.persistentStores.wormAuditStore);
  });

  it('getA2aTaskStore on context is the factory that returns tenant-pinned stores', async () => {
    const registry = buildServices({ db: null });

    let factory: ((tenantId: string) => unknown) | null = null;
    const app = new Hono();
    app.use('*', createServiceContextMiddleware(registry));
    app.get('/probe', (c) => {
      factory = c.get('getA2aTaskStore') as (tenantId: string) => unknown;
      return c.json({ ok: true });
    });

    await app.request('/probe');
    expect(factory).toBeTypeOf('function');
    const store = factory!('tenant-alpha');
    expect(store).toBeDefined();
    // Cached per tenant — same instance on repeat lookup.
    expect(factory!('tenant-alpha')).toBe(store);
    // Distinct per tenant.
    expect(factory!('tenant-beta')).not.toBe(store);
  });

  it('skillRegistryWriter and aopRegistryStore are bound (non-undefined)', async () => {
    const registry = buildServices({ db: null });

    let skill: unknown = 'sentinel';
    let aop: unknown = 'sentinel';
    const app = new Hono();
    app.use('*', createServiceContextMiddleware(registry));
    app.get('/probe', (c) => {
      skill = c.get('skillRegistryWriter');
      aop = c.get('aopRegistryStore');
      return c.json({ ok: true });
    });

    await app.request('/probe');
    expect(skill).toBeDefined();
    expect(skill).not.toBeUndefined();
    expect(skill).toBe(registry.persistentStores.skillRegistryWriter);
    expect(aop).toBeDefined();
    expect(aop).not.toBeUndefined();
    expect(aop).toBe(registry.persistentStores.aopRegistryStore);
  });

  it('feedback-route smoke: lessonStore.put receives the low-rating write (closes the silent no-op bug)', async () => {
    // This mirrors the exact shape of `ask.router.ts:230` — the
    // handler reads `c.get('lessonStore')` and calls `.put()` only on
    // ratings ≤ 2. Pre-fix that get returned undefined and the put
    // never happened. Now we route through the middleware and prove
    // the put lands on the live in-memory store, which we then read
    // back via `recent(...)`.
    const registry = buildServices({ db: null });

    const app = new Hono();
    app.use('*', createServiceContextMiddleware(registry));
    app.post('/ask/feedback', async (c) => {
      const store = c.get('lessonStore') as
        | {
            put: (lesson: unknown) => Promise<unknown>;
          }
        | undefined;
      if (store?.put) {
        await store.put({
          id: 'lsn_probe_1',
          tenantId: 't-probe',
          taskTag: 'role-aware-advisor',
          lesson: 'probe-lesson',
          evidence: 'answer:probe session:probe',
          createdAt: '2026-05-24T00:00:00.000Z',
          recencyScore: 1,
        });
      }
      return c.json({ success: true, storeWasBound: !!store?.put });
    });

    const res = await app.request('/ask/feedback', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { storeWasBound: boolean };
    // Pre-fix this was false — the get returned undefined. Now true.
    expect(body.storeWasBound).toBe(true);

    // Round-trip check: the lesson is recoverable via the same store
    // instance held by the registry (proving the middleware bound the
    // live store, not a one-off shim).
    const lessonStore = registry.persistentStores.lessonStore as {
      recent: (
        tenantId: string,
        taskTag: string,
        limit: number,
      ) => Promise<readonly unknown[]>;
    };
    const recent = await lessonStore.recent('t-probe', 'role-aware-advisor', 10);
    expect(recent.length).toBeGreaterThan(0);
  });
});

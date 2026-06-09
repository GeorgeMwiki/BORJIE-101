/**
 * Regression guard — the five persistent stores must be bound into the
 * Hono request context by `createServiceContextMiddleware`.
 *
 * Background (P36 wiring-gap chain 3): the persistent stores are
 * constructed in `createPersistentStores(...)` but for a window every
 * route that read `c.get('lessonStore')` etc. received `undefined` and
 * silently fell through to a no-op (e.g. a 1-star feedback on `/v1/ask`
 * wrote to `c.get('lessonStore')` which was undefined — tenants thought
 * feedback was recorded; it wasn't). The middleware now binds the five
 * ports; this test fails the moment any binding regresses to undefined.
 *
 * `getA2aTaskStore` is intentionally bound as the per-tenant FACTORY
 * (A2A is tenant-pinned: routes call `getA2aTaskStore(tenantId)` for a
 * per-tenant store) — so the assertion checks it is a callable factory
 * that yields a store, not a pre-built store.
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createServiceContextMiddleware } from '../service-context.middleware.js';
import { createPersistentStores } from '../persistent-stores-wiring.js';
import type { ServiceRegistry } from '../service-registry.js';

/**
 * Build the smallest registry shape the middleware reads for the five
 * persistent-store bindings. Degraded (`db: null`) is sufficient — the
 * binding contract is identical to the persistent path, only the backing
 * store differs (in-memory vs Drizzle), and the middleware binds the same
 * keys in both modes.
 */
function registryWithPersistentStores(): ServiceRegistry {
  const persistentStores = createPersistentStores({ db: null });
  return {
    isLive: false,
    persistentStores,
  } as unknown as ServiceRegistry;
}

describe('createServiceContextMiddleware — persistent-store bindings', () => {
  it('binds all five persistent-store keys as non-undefined context values', async () => {
    const app = new Hono();
    app.use('*', createServiceContextMiddleware(registryWithPersistentStores()));
    app.get('/probe', (c) => {
      const lessonStore = c.get('lessonStore' as never);
      const wormAuditStore = c.get('wormAuditStore' as never);
      const skillRegistryWriter = c.get('skillRegistryWriter' as never);
      const aopRegistryStore = c.get('aopRegistryStore' as never);
      const getA2aTaskStore = c.get('getA2aTaskStore' as never);
      return c.json({
        lessonStore: lessonStore !== undefined,
        wormAuditStore: wormAuditStore !== undefined,
        skillRegistryWriter: skillRegistryWriter !== undefined,
        aopRegistryStore: aopRegistryStore !== undefined,
        // A2A is exposed as a factory — assert it is callable AND yields a
        // store, not undefined.
        a2aFactoryCallable: typeof getA2aTaskStore === 'function',
        a2aStoreResolves:
          typeof getA2aTaskStore === 'function' &&
          (getA2aTaskStore as (t: string) => unknown)('tenant-guard') !==
            undefined,
      });
    });

    const res = await app.request('/probe');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, boolean>;

    expect(body.lessonStore).toBe(true);
    expect(body.wormAuditStore).toBe(true);
    expect(body.skillRegistryWriter).toBe(true);
    expect(body.aopRegistryStore).toBe(true);
    expect(body.a2aFactoryCallable).toBe(true);
    expect(body.a2aStoreResolves).toBe(true);
  });
});

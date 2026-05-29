/**
 * requireService middleware tests — KI-003 closure.
 *
 * Covers:
 *   1. Missing service → 503 SERVICE_UNAVAILABLE (single key)
 *   2. Missing service → 503 SERVICE_UNAVAILABLE (array, partial miss)
 *   3. Present service via direct `c.set('xxxService', svc)` → handler runs
 *   4. Present service via `c.set('services', { xxxService })` → handler runs
 *   5. `hasService` predicate returns expected boolean
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requireService, hasService } from '../require-service.js';

function bindDirect(key: string, value: unknown) {
  return async (c: any, next: any) => {
    if (value !== undefined) c.set(key, value);
    await next();
  };
}

function bindBag(bag: Record<string, unknown> | null) {
  return async (c: any, next: any) => {
    if (bag !== null) c.set('services', bag);
    await next();
  };
}

describe('requireService — single key', () => {
  it('returns 503 SERVICE_UNAVAILABLE when the service is missing', async () => {
    const app = new Hono();
    app.use('*', requireService('renewalService'));
    app.get('/', (c) => c.json({ ok: true }));

    const res = await app.request('/');
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; details: { missing: string[] } };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.error.details.missing).toEqual(['renewalService']);
  });

  it('lets the handler run when the service is bound directly on the context', async () => {
    const app = new Hono();
    app.use('*', bindDirect('renewalService', { propose: async () => null }));
    app.use('*', requireService('renewalService'));
    app.get('/', (c) => c.json({ ok: true }));

    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('lets the handler run when the service is bound via the `services` bag', async () => {
    const app = new Hono();
    app.use('*', bindBag({ renewalService: { propose: async () => null } }));
    app.use('*', requireService('renewalService'));
    app.get('/', (c) => c.json({ ok: true }));

    const res = await app.request('/');
    expect(res.status).toBe(200);
  });
});

describe('requireService — multiple keys', () => {
  it('reports every missing key in the envelope when several are absent', async () => {
    const app = new Hono();
    app.use('*', bindDirect('ledgerService', { post: async () => null }));
    app.use('*', requireService(['renewalService', 'ledgerService', 'inspectorService']));
    app.get('/', (c) => c.json({ ok: true }));

    const res = await app.request('/');
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: { details: { missing: string[] } };
    };
    expect(body.error.details.missing).toEqual(['renewalService', 'inspectorService']);
  });

  it('runs the handler when every required service is present', async () => {
    const app = new Hono();
    app.use('*', bindBag({
      renewalService: { propose: async () => null },
      ledgerService: { post: async () => null },
    }));
    app.use('*', requireService(['renewalService', 'ledgerService']));
    app.get('/', (c) => c.json({ ok: true }));

    const res = await app.request('/');
    expect(res.status).toBe(200);
  });
});

describe('hasService — predicate variant', () => {
  it('returns false when the service is absent', async () => {
    const app = new Hono();
    let saw = true;
    app.get('/', (c) => {
      saw = hasService(c, 'renewalService');
      return c.json({ ok: true });
    });
    await app.request('/');
    expect(saw).toBe(false);
  });

  it('returns true when the service is bound via the bag', async () => {
    const app = new Hono();
    let saw = false;
    app.use('*', bindBag({ renewalService: { propose: async () => null } }));
    app.get('/', (c) => {
      saw = hasService(c, 'renewalService');
      return c.json({ ok: true });
    });
    await app.request('/');
    expect(saw).toBe(true);
  });

  it('returns true when the service is bound directly', async () => {
    const app = new Hono();
    let saw = false;
    app.use('*', bindDirect('renewalService', { propose: async () => null }));
    app.get('/', (c) => {
      saw = hasService(c, 'renewalService');
      return c.json({ ok: true });
    });
    await app.request('/');
    expect(saw).toBe(true);
  });

  it('returns false when the bag is bound but the key is missing', async () => {
    const app = new Hono();
    let saw = true;
    app.use('*', bindBag({}));
    app.get('/', (c) => {
      saw = hasService(c, 'renewalService');
      return c.json({ ok: true });
    });
    await app.request('/');
    expect(saw).toBe(false);
  });
});
